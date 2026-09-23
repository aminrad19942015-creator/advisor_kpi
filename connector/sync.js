const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadCrmConfig } = require('./config-client');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

let CRM_ORIGIN = 'https://mxrm.emofid.com';
let CRM_API_PREFIX = '/api/data/v9.0';
const API_URL = process.env.DASHBOARD_API_URL || 'https://advisor-kpi.vercel.app/api/crm-shadow';
const username = (process.env.CRM_USERNAME || '').trim();
const password = process.env.CRM_PASSWORD || '';
const connectorToken = process.env.CRM_CONNECTOR_TOKEN;

if (!username || !password || !connectorToken) {
  console.error('Missing CRM_USERNAME, CRM_PASSWORD, or CRM_CONNECTOR_TOKEN in connector/.env.local');
  process.exit(1);
}

const runtimeDir = path.join(__dirname, 'runtime');
const profileDir = path.join(runtimeDir, 'browser-profile');
fs.mkdirSync(runtimeDir, { recursive: true });

function formatted(row, field) {
  return row[field + '@OData.Community.Display.V1.FormattedValue'] ?? row[field] ?? null;
}

async function authenticate(page) {
  console.log('Checking CRM session...');
  await page.goto(CRM_ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (page.url().includes('adfs.emofid.com')) {
    console.log('CRM session expired. ADFS login required.');

    const userInput = page.locator('#userNameInput');
    await userInput.waitFor({ state: 'visible', timeout: 30000 });
    await userInput.fill(username);

    const submitButton = page.locator('#submitButton');
    if (await submitButton.isVisible().catch(() => false)) {
      await submitButton.click();
    } else {
      await userInput.press('Enter');
    }

    const passwordInput = page.locator('#passwordInput');
    try {
      await passwordInput.waitFor({ state: 'visible', timeout: 30000 });
    } catch {
      const authError = await page.locator('#errorText, .error, [role="alert"]').filter({ visible: true }).first().textContent().catch(() => '');
      throw new Error('ADFS password step did not appear.' + (authError ? ' ' + authError.trim() : ''));
    }

    await passwordInput.fill(password);

    await Promise.all([
      page.waitForURL(url => url.hostname === 'mxrm.emofid.com', { timeout: 120000 }),
      (async () => {
        if (await submitButton.isVisible().catch(() => false)) await submitButton.click();
        else await passwordInput.press('Enter');
      })()
    ]);

    console.log('ADFS login completed.');
  } else {
    console.log('Existing CRM session found.');
  }

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(4000);

  let probe;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      probe = await page.evaluate(async () => {
        const r = await fetch(CRM_API_PREFIX+'/WhoAmI', {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        return { status: r.status, text: await r.text() };
      });
      break;
    } catch {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(2500);
    }
  }

  if (!probe || probe.status !== 200) {
    throw new Error('WhoAmI failed with HTTP ' + (probe?.status ?? 'unknown'));
  }

  console.log('CRM authentication validated.');
}

async function fetchOpenLeads(page,entity='leads') {
  const select = [
    'leadid','ms_leadnumber','createdon','modifiedon','statecode','statuscode',
    'ms_nextcallreasontypecode','ms_followupby','ms_leadtypeleadtype','leadsourcecode',
    'ms_leadsourceadditionalinfocode','ms_trafficsource','_ownerid_value','_owninguser_value','_createdby_value',
    '_modifiedby_value','_campaignid_value','_ms_applicationid_value','_customerid_value'
  ].join(',');

  let url = CRM_API_PREFIX + '/' + entity + '?' +
    '$select=' + select +
    '&$filter=statecode eq 0' +
    '&$expand=owningbusinessunit($select=name),customerid_contact($select=fullname,customertypecode,_ms_advisorid_value,_ms_marketeruserid_value)';

  const all = [];
  let pageNo = 0;

  while (url) {
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

    if (result.status !== 200) throw new Error('CRM read failed with HTTP ' + result.status);

    const data = JSON.parse(result.text);
    const rows = data.value || [];
    all.push(...rows);
    pageNo++;
    console.log('CRM page ' + pageNo + ': ' + rows.length + ' rows - total ' + all.length);

    if (data['@odata.nextLink']) {
      const u = new URL(data['@odata.nextLink']);
      url = u.pathname + u.search;
    } else {
      url = null;
    }
  }

  return all;
}

function normalize(rows) {
  return rows.map(row => ({
    leadNumber: row.ms_leadnumber ?? null,
    createdOn: row.createdon ?? null,
    customerRank: row.customerid_contact?.['customertypecode@OData.Community.Display.V1.FormattedValue'] ?? null,
    modifiedOn: row.modifiedon ?? null,
    status: formatted(row, 'statuscode'),
    nextCallReason: formatted(row, 'ms_nextcallreasontypecode'),
    followUpBy: row.ms_followupby ?? null,
    customerName: row.customerid_contact?.fullname ?? formatted(row, '_customerid_value'),
    modifiedBy: formatted(row, '_modifiedby_value'),
    createdBy: formatted(row, '_createdby_value'),
    owner: formatted(row, '_ownerid_value'),
    leadType: formatted(row, 'ms_leadtypeleadtype'),
    leadSource: formatted(row, 'leadsourcecode'),
    campaign: formatted(row, '_campaignid_value'),
    application: formatted(row, '_ms_applicationid_value'),
    customerAdvisor: row.customerid_contact?.['_ms_advisorid_value@OData.Community.Display.V1.FormattedValue'] ?? null,
    customerMarketer: row.customerid_contact?.['_ms_marketeruserid_value@OData.Community.Display.V1.FormattedValue'] ?? null,
    businessUnit: row._owninguser_value ? (row.owningbusinessunit?.name ?? null) : null,
    trafficSource: row.ms_trafficsource ?? null
  }));
}

async function api(body) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-crm-connector-token': connectorToken
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error('Dashboard API HTTP ' + response.status + ': ' + text);
  return JSON.parse(text);
}

async function pushShadow(rows, sourceCheckedAt) {
  const start = await api({ action: 'start' });
  const batchId = start.batchId;
  const chunkSize = start.maxChunkRows || 400;

  let seq = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await api({ action: 'chunk', batchId, seq, rows: chunk });
    console.log('Uploaded chunk ' + (seq + 1) + ': ' + chunk.length + ' rows');
    seq++;
  }

  return api({
    action: 'finalize',
    batchId,
    expectedRows: rows.length,
    sourceCheckedAt
  });
}

(async () => {
  const startedAt = new Date().toISOString();
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge',
    headless: true
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    const crmConfig=await loadCrmConfig(connectorToken);
    CRM_ORIGIN=String(crmConfig.crmOrigin||CRM_ORIGIN).replace(/\/$/,'');
    CRM_API_PREFIX='/api/data/'+String(crmConfig.apiVersion||'v9.0').replace(/^\/+|\/+$/g,'');
    if(crmConfig.openLeads?.enabled===false||String(crmConfig.openLeads?.sourceMode||'crm').toLowerCase()!=='crm'){
      console.log('Open Leads CRM sync skipped by admin configuration.');
      return;
    }
    await authenticate(page);
    const crmRows = await fetchOpenLeads(page,String(crmConfig.openLeads?.entity||'leads'));
    const rows = normalize(crmRows);
    const result = await pushShadow(rows, new Date().toISOString());

    const status = {
      status: 'success',
      startedAt,
      finishedAt: new Date().toISOString(),
      rows: result.rows,
      table: result.table
    };
    fs.writeFileSync(path.join(runtimeDir, 'last-sync.json'), JSON.stringify(status, null, 2), 'utf8');

    console.log('');
    console.log('=== CRM OPERATIONAL SYNC SUCCESS ===');
    console.log('Rows:', result.rows);
    console.log('Table:', result.table);
  } catch (error) {
    const status = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      error: String(error?.message || error)
    };
    fs.writeFileSync(path.join(runtimeDir, 'last-sync.json'), JSON.stringify(status, null, 2), 'utf8');
    console.error('CRM operational sync failed:', error.message);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
})();
