const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const CRM_ORIGIN = 'https://mxrm.emofid.com';
const username = (process.env.CRM_USERNAME || '').trim();
const password = process.env.CRM_PASSWORD || '';
const runtimeDir = path.join(__dirname, 'runtime');
const profileDir = path.join(runtimeDir, 'browser-profile');
fs.mkdirSync(runtimeDir, { recursive: true });

if (!username || !password) {
  console.error('Missing CRM_USERNAME or CRM_PASSWORD in connector/.env.local');
  process.exit(1);
}

async function authenticate(page) {
  console.log('Checking CRM session...');
  await page.goto(CRM_ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (page.url().includes('adfs.emofid.com')) {
    const userInput = page.locator('#userNameInput');
    await userInput.waitFor({ state: 'visible', timeout: 30000 });
    await userInput.fill(username);
    const submitButton = page.locator('#submitButton');
    if (await submitButton.isVisible().catch(() => false)) await submitButton.click();
    else await userInput.press('Enter');

    const passwordInput = page.locator('#passwordInput');
    await passwordInput.waitFor({ state: 'visible', timeout: 30000 });
    await passwordInput.fill(password);

    await Promise.all([
      page.waitForURL(url => url.hostname === 'mxrm.emofid.com', { timeout: 120000 }),
      (async () => {
        if (await submitButton.isVisible().catch(() => false)) await submitButton.click();
        else await passwordInput.press('Enter');
      })()
    ]);
  }

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(3000);
  const probe = await page.evaluate(async () => {
    const r = await fetch('/api/data/v9.0/WhoAmI', { credentials: 'include', headers: { Accept: 'application/json' } });
    return { status: r.status, text: await r.text() };
  });
  if (probe.status !== 200) throw new Error('WhoAmI failed with HTTP ' + probe.status);
  console.log('CRM authentication validated.');
}

async function fetchJson(page, url) {
  const result = await page.evaluate(async requestUrl => {
    const r = await fetch(requestUrl, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"'
      }
    });
    return { status: r.status, text: await r.text() };
  }, url);
  if (result.status !== 200) throw new Error(url + ' -> HTTP ' + result.status + ': ' + result.text.slice(0, 500));
  return JSON.parse(result.text);
}

function displayLabels(attr) {
  const labels = attr?.DisplayName?.LocalizedLabels || [];
  return labels.map(x => x?.Label).filter(Boolean);
}

function isInteresting(attr) {
  const text = [attr.LogicalName, ...displayLabels(attr)].join(' ').toLowerCase();
  const keys = [
    'owner','created','modified','status','state','subject','regarding','lead','campaign',
    'advisor','consultant','marketer','referrer','actual','investment','register','registration',
    'queue','start','duration','phone','case','ticket','contact','topic','close','resolve',
    'customer','rank','source','origin','title','amount','potential','کاربر','مالک','ثبت',
    'وضعیت','سرنخ','کمپین','مشاور','معرف','سرمایه','تماس','صف','موضوع','تیکت','مشتری',
    'بسته','منشا','منشأ','تاریخ'
  ];
  return keys.some(k => text.includes(k));
}

async function discoverEntity(page, logicalName) {
  const def = await fetchJson(
    page,
    "/api/data/v9.0/EntityDefinitions(LogicalName='" + logicalName + "')?$select=LogicalName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute"
  );
  const attrs = await fetchJson(
    page,
    "/api/data/v9.0/EntityDefinitions(LogicalName='" + logicalName + "')/Attributes?$select=LogicalName,AttributeType,DisplayName"
  );
  const all = (attrs.value || []).map(a => ({
    logicalName: a.LogicalName,
    attributeType: a.AttributeType,
    labels: displayLabels(a)
  }));
  return {
    logicalName,
    entitySetName: def.EntitySetName,
    primaryIdAttribute: def.PrimaryIdAttribute,
    primaryNameAttribute: def.PrimaryNameAttribute,
    interestingAttributes: all.filter(isInteresting),
    allAttributes: all
  };
}

(async () => {
  const context = await chromium.launchPersistentContext(profileDir, { channel: 'msedge', headless: true });
  const page = context.pages()[0] || await context.newPage();

  try {
    await authenticate(page);
    const entities = ['lead', 'opportunity', 'phonecall', 'incident', 'queueitem'];
    const output = { checkedAt: new Date().toISOString(), entities: {} };

    for (const entity of entities) {
      console.log('Discovering ' + entity + '...');
      output.entities[entity] = await discoverEntity(page, entity);
      const e = output.entities[entity];
      console.log('  EntitySet:', e.entitySetName);
      console.log('  Candidate fields:', e.interestingAttributes.length);
    }

    const outPath = path.join(runtimeDir, 'activity-metadata.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
    console.log('');
    console.log('=== ACTIVITY METADATA DISCOVERY SUCCESS ===');
    console.log('Saved:', outPath);
  } catch (error) {
    console.error('Activity metadata discovery failed:', error.message);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
})();