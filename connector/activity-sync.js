const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const CRM_ORIGIN = 'https://mxrm.emofid.com';
const shadowUrl = process.env.DASHBOARD_API_URL || 'https://advisor-kpi.vercel.app/api/crm-shadow';
const API_URL = process.env.DASHBOARD_ACTIVITY_API_URL || shadowUrl.replace(/\/crm-shadow\/?$/,'/crm-activity');
const username = (process.env.CRM_USERNAME || '').trim();
const password = process.env.CRM_PASSWORD || '';
const connectorToken = process.env.CRM_CONNECTOR_TOKEN;
const syncScope = String(process.argv[2] || 'all').trim().toLowerCase();

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
function cleanNumber(v){
  if(v===null||v===undefined||v==='') return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function iranActivityRanges(){
  const offsetMs=3.5*3600*1000;
  const nowUtc=Date.now();
  const nowIran=new Date(nowUtc+offsetMs);
  const y=nowIran.getUTCFullYear(),m=nowIran.getUTCMonth(),d=nowIran.getUTCDate();
  const hh=nowIran.getUTCHours(),mm=nowIran.getUTCMinutes(),ss=nowIran.getUTCSeconds(),ms=nowIran.getUTCMilliseconds();
  const todayIranMidnightUtc=Date.UTC(y,m,d)-offsetMs;
  return {
    daily:{
      start:new Date(todayIranMidnightUtc-24*3600*1000).toISOString(),
      end:new Date(todayIranMidnightUtc).toISOString()
    },
    weekly:{
      start:new Date(nowUtc-7*24*3600*1000).toISOString(),
      end:new Date(nowUtc).toISOString()
    },
    monthly:{
      start:new Date(Date.UTC(y,m-1,d,hh,mm,ss,ms)-offsetMs).toISOString(),
      end:new Date(nowUtc).toISOString()
    }
  };
}

async function authenticate(page) {
  console.log('Checking CRM session...');
  await page.goto(CRM_ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (page.url().includes('adfs.emofid.com')) {
    console.log('CRM session expired. ADFS login required.');
    const userInput=page.locator('#userNameInput');
    await userInput.waitFor({state:'visible',timeout:30000});
    await userInput.fill(username);
    const submit=page.locator('#submitButton');
    if(await submit.isVisible().catch(()=>false)) await submit.click(); else await userInput.press('Enter');
    const passwordInput=page.locator('#passwordInput');
    await passwordInput.waitFor({state:'visible',timeout:30000});
    await passwordInput.fill(password);
    await Promise.all([
      page.waitForURL(url=>url.hostname==='mxrm.emofid.com',{timeout:120000}),
      (async()=>{
  const startedAt=new Date().toISOString(),ranges=iranActivityRanges(),range=ranges.daily;
  console.log('Sync scope:',syncScope);
  console.log('Iran daily UTC range:',ranges.daily.start,'->',ranges.daily.end);
  console.log('Iran weekly UTC range:',ranges.weekly.start,'->',ranges.weekly.end);
  console.log('Iran monthly UTC range:',ranges.monthly.start,'->',ranges.monthly.end);
  const context=await chromium.launchPersistentContext(profileDir,{channel:'msedge',headless:true});
  const page=context.pages()[0]||await context.newPage();
  try{
    await authenticate(page);

    let datasets={};
    if(syncScope==='calls'){
      const calls=await fetchCallActivity(page,ranges.daily,'Daily calls');
      const weeklyCalls=await fetchCallActivity(page,ranges.weekly,'Weekly calls');
      const monthlyCalls=await fetchCallActivity(page,ranges.monthly,'Monthly calls');
      datasets={calls,weekly_calls:weeklyCalls,monthly_calls:monthlyCalls};
      console.log('Raw CRM call rows:',{
        calls:calls.length,
        weekly_calls:weeklyCalls.length,
        monthly_calls:monthlyCalls.length
      });
    }else{
      const leads=await fetchLeadActivity(page,ranges.daily,'Daily leads');
      const weeklyLeads=await fetchLeadActivity(page,ranges.weekly,'Weekly leads');
      const monthlyLeads=await fetchLeadActivity(page,ranges.monthly,'Monthly leads');
      const opportunities=await fetchOpportunityActivity(page,ranges.daily,'Daily opportunities');
      const weeklyOpportunities=await fetchOpportunityActivity(page,ranges.weekly,'Weekly opportunities');
      const monthlyOpportunities=await fetchOpportunityActivity(page,ranges.monthly,'Monthly opportunities');
      const calls=await fetchCallActivity(page,ranges.daily,'Daily calls');
      const weeklyCalls=await fetchCallActivity(page,ranges.weekly,'Weekly calls');
      const monthlyCalls=await fetchCallActivity(page,ranges.monthly,'Monthly calls');
      const tickets=await fetchDailyTickets(page,range);
      datasets={
        leads,
        weekly_leads:weeklyLeads,
        monthly_leads:monthlyLeads,
        opportunities,
        weekly_opportunities:weeklyOpportunities,
        monthly_opportunities:monthlyOpportunities,
        calls,
        weekly_calls:weeklyCalls,
        monthly_calls:monthlyCalls,
        tickets
      };
      console.log('Raw CRM rows:',Object.fromEntries(Object.entries(datasets).map(([k,v])=>[k,v.length])));
    }

    const result=await upload(datasets,range);
    const raw=Object.fromEntries(Object.entries(datasets).map(([k,v])=>[k,v.length]));
    const status={status:'success',scope:syncScope,startedAt,finishedAt:new Date().toISOString(),ranges,raw,stored:result.counts};
    fs.writeFileSync(path.join(runtimeDir,'last-activity-sync.json'),JSON.stringify(status,null,2),'utf8');
    console.log('');
    console.log('=== CRM ACTIVITY SYNC SUCCESS ===');
    console.log('Stored rows:',result.counts);
  }catch(error){
    fs.writeFileSync(path.join(runtimeDir,'last-activity-sync.json'),JSON.stringify({status:'failed',scope:syncScope,startedAt,finishedAt:new Date().toISOString(),ranges,error:String(error?.message||error)},null,2),'utf8');
    console.error('CRM activity sync failed:',error.message);
    process.exitCode=1;
  }finally{ await context.close(); }
})();