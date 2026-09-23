const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadCrmConfig } = require('./config-client');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

let CRM_ORIGIN = 'https://mxrm.emofid.com';
let CRM_API_PREFIX = '/api/data/v9.0';
const shadowUrl = process.env.DASHBOARD_API_URL || 'https://advisor-kpi.vercel.app/api/crm-shadow';
const API_URL = process.env.DASHBOARD_ACTIVITY_API_URL || shadowUrl.replace(/\/crm-shadow\/?$/,'/crm-activity');
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
function cleanNumber(v){
  if(v===null||v===undefined||v==='') return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function normalizeFa(v){
  return String(v??'').replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/\s+/g,' ').trim();
}
function iranActivityRanges(){
  const offsetMs=3.5*3600*1000;
  const nowUtc=Date.now();
  const nowIran=new Date(nowUtc+offsetMs);
  const y=nowIran.getUTCFullYear(),m=nowIran.getUTCMonth(),d=nowIran.getUTCDate();
  const hh=nowIran.getUTCHours(),mm=nowIran.getUTCMinutes(),ss=nowIran.getUTCSeconds(),ms=nowIran.getUTCMilliseconds();
  const todayIranMidnightUtc=Date.UTC(y,m,d)-offsetMs;
  return {
    daily:{start:new Date(todayIranMidnightUtc-24*3600*1000).toISOString(),end:new Date(todayIranMidnightUtc).toISOString()},
    weekly:{start:new Date(nowUtc-7*24*3600*1000).toISOString(),end:new Date(nowUtc).toISOString()},
    monthly:{start:new Date(Date.UTC(y,m-1,d,hh,mm,ss,ms)-offsetMs).toISOString(),end:new Date(nowUtc).toISOString()}
  };
}

async function authenticate(page){
  console.log('Checking CRM session...');
  await page.goto(CRM_ORIGIN+'/',{waitUntil:'domcontentloaded',timeout:60000});
  if(page.url().includes('adfs.emofid.com')){
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
      (async()=>{ if(await submit.isVisible().catch(()=>false)) await submit.click(); else await passwordInput.press('Enter'); })()
    ]);
    console.log('ADFS login completed.');
  }else{
    console.log('Existing CRM session found.');
  }

  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  await page.waitForTimeout(2500);
  const probe=await page.evaluate(async()=>{
    const r=await fetch(CRM_API_PREFIX+'/WhoAmI',{credentials:'include',headers:{Accept:'application/json'}});
    return {status:r.status,text:await r.text()};
  });
  if(probe.status!==200) throw new Error('WhoAmI failed with HTTP '+probe.status);
  console.log('CRM authentication validated.');
}

async function fetchPaged(page,label,url){
  const all=[];
  let pageNo=0;
  while(url){
    const result=await page.evaluate(async requestUrl=>{
      const r=await fetch(requestUrl,{
        credentials:'include',
        headers:{
          Accept:'application/json',
          Prefer:'odata.include-annotations="OData.Community.Display.V1.FormattedValue"'
        }
      });
      return {status:r.status,text:await r.text()};
    },url);

    if(result.status!==200) throw new Error(label+' CRM read failed HTTP '+result.status+': '+result.text.slice(0,700));
    const data=JSON.parse(result.text);
    const rows=data.value||[];
    all.push(...rows);
    pageNo++;
    console.log(label+' page '+pageNo+': '+rows.length+' - total '+all.length);

    if(data['@odata.nextLink']){
      const u=new URL(data['@odata.nextLink']);
      url=u.pathname+u.search;
    }else{
      url=null;
    }
  }
  return all;
}

async function getUserDirectory(page){
  const users=await fetchPaged(page,'Call users',CRM_API_PREFIX+'/systemusers?$select=systemuserid,fullname,_businessunitid_value');
  const map=new Map();
  for(const u of users){
    map.set(String(u.systemuserid||'').toLowerCase(),{
      fullname:u.fullname??null,
      businessUnit:formatted(u,'_businessunitid_value')
    });
  }
  return map;
}

async function fetchCalls(page,range,label,userDirectory,callConfig){
  const select=[
    'activityid','subject','_ms_partyuserid_value','_ms_callqueueid_value','scheduledstart','actualstart',
    '_ms_partycontactid_value','ms_tophonenumber','phonenumber','ms_parameters','ms_callduration','actualdurationminutes'
  ].join(',');

  const dateField=String(callConfig?.dateField||'scheduledstart');
  const entity=String(callConfig?.entity||'phonecalls');
  const filter=`${dateField} ge ${range.start} and ${dateField} lt ${range.end}`;
  const url=CRM_API_PREFIX+'/'+entity+'?$select='+select+'&$filter='+encodeURIComponent(filter);
  const raw=await fetchPaged(page,label,url);

  const allowedUnits=new Set((callConfig?.businessUnits||[]).map(normalizeFa));

  return raw.filter(row=>{
    const userId=String(row._ms_partyuserid_value||'').toLowerCase();
    const info=userDirectory.get(userId);
    return allowedUnits.has(normalizeFa(info?.businessUnit));
  }).map(row=>{
    const subject=row.subject??'';
    const leadMatch=String(subject).match(/(?:LEAD|OPP)-\d+/i);
    const userId=String(row._ms_partyuserid_value||'').toLowerCase();
    const info=userDirectory.get(userId);

    return {
      call_id:row.activityid??null,
      subject,
      user:info?.fullname??formatted(row,'_ms_partyuserid_value'),
      queue:formatted(row,'_ms_callqueueid_value'),
      planned_start:row.scheduledstart??null,
      start_date:row.scheduledstart??null,
      customer:formatted(row,'_ms_partycontactid_value'),
      destination_number:row.ms_tophonenumber??null,
      phone_number:row.phonenumber??null,
      parameters:row.ms_parameters??null,
      duration:cleanNumber(row.actualdurationminutes)??cleanNumber(row.ms_callduration),
      business_unit:info?.businessUnit??null,
      lead_number:leadMatch?leadMatch[0].toUpperCase():null
    };
  });
}

async function api(body){
  let lastError;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      const response=await fetch(API_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json','x-crm-connector-token':connectorToken},
        body:JSON.stringify(body),
        signal:AbortSignal.timeout(60000)
      });
      const text=await response.text();
      if(!response.ok) throw new Error('Dashboard activity API HTTP '+response.status+': '+text);
      return JSON.parse(text);
    }catch(error){
      lastError=error;
      console.log('Dashboard API attempt '+attempt+' failed: '+(error?.message||error));
      if(attempt<4) await new Promise(resolve=>setTimeout(resolve,1500*attempt));
    }
  }
  throw lastError;
}

async function upload(datasets,range){
  const start=await api({action:'start'});
  const batchId=start.batchId;
  const chunkSize=start.maxChunkRows||300;
  const expected={};

  for(const [dataset,rows] of Object.entries(datasets)){
    expected[dataset]=rows.length;
    let seq=0;
    for(let i=0;i<rows.length;i+=chunkSize){
      const chunk=rows.slice(i,i+chunkSize);
      await api({action:'chunk',batchId,dataset,seq,rows:chunk});
      console.log('Uploaded '+dataset+' chunk '+(seq+1)+': '+chunk.length);
      seq++;
    }
  }

  return api({action:'finalize',batchId,expected,sourceCheckedAt:new Date().toISOString(),range});
}

(async()=>{
  const startedAt=new Date().toISOString();
  const ranges=iranActivityRanges();
  console.log('Calls-only CRM sync');
  console.log('Daily:',ranges.daily.start,'->',ranges.daily.end);
  console.log('Weekly:',ranges.weekly.start,'->',ranges.weekly.end);
  console.log('Monthly:',ranges.monthly.start,'->',ranges.monthly.end);

  const context=await chromium.launchPersistentContext(profileDir,{channel:'msedge',headless:true});
  const page=context.pages()[0]||await context.newPage();

  try{
    const crmConfig=await loadCrmConfig(connectorToken);
    CRM_ORIGIN=String(crmConfig.crmOrigin||CRM_ORIGIN).replace(/\/$/,'');
    CRM_API_PREFIX='/api/data/'+String(crmConfig.apiVersion||'v9.0').replace(/^\/+|\/+$/g,'');
    const callConfig=crmConfig.calls||{};
    if(callConfig.enabled===false||String(callConfig.sourceMode||'crm').toLowerCase()!=='crm'){
      console.log('Calls CRM sync skipped by admin configuration.');
      return;
    }
    await authenticate(page);
    const users=await getUserDirectory(page);

    const calls=await fetchCalls(page,ranges.daily,'Daily calls',users,callConfig);
    const weeklyCalls=await fetchCalls(page,ranges.weekly,'Weekly calls',users,callConfig);
    const monthlyCalls=await fetchCalls(page,ranges.monthly,'Monthly calls',users,callConfig);

    console.log('Filtered call rows:',{
      calls:calls.length,
      weekly_calls:weeklyCalls.length,
      monthly_calls:monthlyCalls.length
    });

    const result=await upload({
      calls,
      weekly_calls:weeklyCalls,
      monthly_calls:monthlyCalls
    },ranges.daily);

    const status={
      status:'success',
      startedAt,
      finishedAt:new Date().toISOString(),
      ranges,
      stored:result.counts
    };
    fs.writeFileSync(path.join(runtimeDir,'last-calls-sync.json'),JSON.stringify(status,null,2),'utf8');

    console.log('');
    console.log('=== CRM CALLS SYNC SUCCESS ===');
    console.log('Stored rows:',result.counts);
  }catch(error){
    const status={
      status:'failed',
      startedAt,
      finishedAt:new Date().toISOString(),
      error:String(error?.message||error)
    };
    fs.writeFileSync(path.join(runtimeDir,'last-calls-sync.json'),JSON.stringify(status,null,2),'utf8');
    console.error('CRM calls sync failed:',error.message);
    process.exitCode=1;
  }finally{
    await context.close();
  }
})();