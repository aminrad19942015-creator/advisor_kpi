const fs=require('fs');
const path=require('path');
const {chromium}=require('playwright');
const {loadCrmConfig}=require('./config-client');
require('dotenv').config({path:path.join(__dirname,'.env.local')});

let CRM_ORIGIN='https://mxrm.emofid.com';
let CRM_API_PREFIX='/api/data/v9.0';
const shadowUrl=process.env.DASHBOARD_API_URL||'https://advisor-kpi.vercel.app/api/crm-shadow';
const API_URL=process.env.DASHBOARD_ACTIVITY_API_URL||shadowUrl.replace(/\/crm-shadow\/?$/,'/crm-activity');
const username=(process.env.CRM_USERNAME||'').trim();
const password=process.env.CRM_PASSWORD||'';
const connectorToken=process.env.CRM_CONNECTOR_TOKEN;
if(!username||!password||!connectorToken){console.error('Missing connector credentials/config in .env.local');process.exit(1);}

const runtimeDir=path.join(__dirname,'runtime');
const profileDir=path.join(runtimeDir,'browser-profile');
fs.mkdirSync(runtimeDir,{recursive:true});

function formatted(row,field){return row[field+'@OData.Community.Display.V1.FormattedValue']??row[field]??null;}
function normalizeFa(v){return String(v??'').replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/\s+/g,' ').trim();}
function iranActivityRanges(){
  const offsetMs=3.5*3600*1000,nowUtc=Date.now(),nowIran=new Date(nowUtc+offsetMs);
  const y=nowIran.getUTCFullYear(),m=nowIran.getUTCMonth(),d=nowIran.getUTCDate();
  const hh=nowIran.getUTCHours(),mm=nowIran.getUTCMinutes(),ss=nowIran.getUTCSeconds(),ms=nowIran.getUTCMilliseconds();
  const todayMidnight=Date.UTC(y,m,d)-offsetMs;
  return {
    daily:{start:new Date(todayMidnight-86400000).toISOString(),end:new Date(todayMidnight).toISOString()},
    weekly:{start:new Date(nowUtc-7*86400000).toISOString(),end:new Date(nowUtc).toISOString()},
    monthly:{start:new Date(Date.UTC(y,m-1,d,hh,mm,ss,ms)-offsetMs).toISOString(),end:new Date(nowUtc).toISOString()}
  };
}

async function authenticate(page){
  console.log('Checking CRM session...');
  await page.goto(CRM_ORIGIN+'/',{waitUntil:'domcontentloaded',timeout:60000});
  if(page.url().includes('adfs.emofid.com')){
    console.log('CRM session expired. ADFS login required.');
    const u=page.locator('#userNameInput');await u.waitFor({state:'visible',timeout:30000});await u.fill(username);
    const submit=page.locator('#submitButton');
    if(await submit.isVisible().catch(()=>false)) await submit.click(); else await u.press('Enter');
    const p=page.locator('#passwordInput');await p.waitFor({state:'visible',timeout:30000});await p.fill(password);
    await Promise.all([
      page.waitForURL(url=>url.hostname==='mxrm.emofid.com',{timeout:120000}),
      (async()=>{if(await submit.isVisible().catch(()=>false)) await submit.click(); else await p.press('Enter');})()
    ]);
    console.log('ADFS login completed.');
  }else console.log('Existing CRM session found.');
  await page.waitForTimeout(2500);
  const probe=await page.evaluate(async()=>{const r=await fetch(CRM_API_PREFIX+'/WhoAmI',{credentials:'include',headers:{Accept:'application/json'}});return r.status;});
  if(probe!==200) throw new Error('WhoAmI failed HTTP '+probe);
  console.log('CRM authentication validated.');
}

async function fetchPaged(page,label,url){
  const all=[];let n=0;
  while(url){
    const result=await page.evaluate(async requestUrl=>{
      const r=await fetch(requestUrl,{credentials:'include',headers:{Accept:'application/json',Prefer:'odata.include-annotations="OData.Community.Display.V1.FormattedValue"'}});
      return {status:r.status,text:await r.text()};
    },url);
    if(result.status!==200) throw new Error(label+' CRM read failed HTTP '+result.status+': '+result.text.slice(0,700));
    const data=JSON.parse(result.text),rows=data.value||[];all.push(...rows);n++;
    console.log(label+' page '+n+': '+rows.length+' - total '+all.length);
    if(data['@odata.nextLink']){const u=new URL(data['@odata.nextLink']);url=u.pathname+u.search;}else url=null;
  }
  return all;
}


async function fetchIncidentMap(page,ids,label,caseEntity='incidents'){
  const map=new Map();
  const unique=[...new Set(ids.filter(Boolean).map(x=>String(x).toLowerCase()))];
  for(let i=0;i<unique.length;i+=35){
    const part=unique.slice(i,i+35);
    const filter=part.map(id=>'incidentid eq '+id).join(' or ');
    const select=[
      'incidentid','title','_ms_contactreasonid_value','_ms_actualcontactreasonid_value','_ownerid_value',
      'resolveby','statuscode','ms_customertypecode','description','caseorigincode','ticketnumber',
      'ms_nationalnumber','modifiedon','_modifiedby_value','createdon','_createdby_value'
    ].join(',');
    const rows=await fetchPaged(page,label+' cases '+(Math.floor(i/35)+1),
      CRM_API_PREFIX+'/'+caseEntity+'?$select='+select+'&$filter='+encodeURIComponent(filter));
    for(const row of rows) map.set(String(row.incidentid||'').toLowerCase(),row);
  }
  return map;
}

async function fetchTickets(page,range,label,ticketConfig){
  const qSelect=['queueitemid','title','_queueid_value','_objectid_value','_workerid_value','enteredon','modifiedon'].join(',');
  const dateField=String(ticketConfig?.dateField||'modifiedon');
  const queueEntity=String(ticketConfig?.queueEntity||'queueitems');
  const caseEntity=String(ticketConfig?.caseEntity||'incidents');
  const allowedQueues=new Set((ticketConfig?.queues||[]).map(normalizeFa));
  const allowedTopics=new Set((ticketConfig?.topics||[]).map(normalizeFa));
  const excludedStatuses=new Set((ticketConfig?.excludedStatuses||[]).map(normalizeFa));
  const allowedRanks=new Set((ticketConfig?.customerRanks||[]).map(normalizeFa));
  const qFilter=`${dateField} ge ${range.start} and ${dateField} lt ${range.end}`;
  const queueRows=await fetchPaged(page,label+' queue items',
    CRM_API_PREFIX+'/'+queueEntity+'?$select='+qSelect+'&$filter='+encodeURIComponent(qFilter));

  const queueFiltered=queueRows.filter(r=>allowedQueues.has(normalizeFa(formatted(r,'_queueid_value'))));
  console.log(label+' allowed queue rows:',queueFiltered.length);

  const incidentMap=await fetchIncidentMap(page,queueFiltered.map(r=>r._objectid_value),label,caseEntity);
  const out=[];

  for(const q of queueFiltered){
    const incident=incidentMap.get(String(q._objectid_value||'').toLowerCase());
    if(!incident) continue;

    const contactTopic=formatted(incident,'_ms_contactreasonid_value');
    const mainSubject=formatted(incident,'_ms_actualcontactreasonid_value');
    const status=formatted(incident,'statuscode');
    const rank=formatted(incident,'ms_customertypecode');

    if(!(allowedTopics.has(normalizeFa(contactTopic))||allowedTopics.has(normalizeFa(mainSubject)))) continue;
    if(excludedStatuses.has(normalizeFa(status))) continue;
    if(!allowedRanks.has(normalizeFa(rank))) continue;

    out.push({
      queue_item_id:q.queueitemid??null,
      title:q.title??incident.title??null,
      contact_topic:contactTopic,
      main_subject:mainSubject,
      owner:formatted(incident,'_ownerid_value'),
      worked_by:formatted(q,'_workerid_value'),
      resolve_by:incident.resolveby??null,
      entered_queue:q.enteredon??null,
      status_reason:status,
      customer_rank:rank,
      description:incident.description??null,
      origin:formatted(incident,'caseorigincode'),
      case_number:incident.ticketnumber??null,
      national_id:incident.ms_nationalnumber??null,
      type:'Case',
      closed_at:q.modifiedon??null,
      modified_on:q.modifiedon??null,
      modified_by:formatted(incident,'_modifiedby_value'),
      created_on:incident.createdon??null,
      created_by:formatted(incident,'_createdby_value')
    });
  }
  console.log(label+' filtered tickets:',out.length);
  return out;
}

async function api(body){
  let lastError;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      const r=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','x-crm-connector-token':connectorToken},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
      const txt=await r.text();if(!r.ok) throw new Error('Dashboard activity API HTTP '+r.status+': '+txt);
      return JSON.parse(txt);
    }catch(e){lastError=e;console.log('Dashboard API attempt '+attempt+' failed: '+(e?.message||e));if(attempt<4) await new Promise(res=>setTimeout(res,1500*attempt));}
  }
  throw lastError;
}

async function upload(datasets,range){
  const start=await api({action:'start'}),batchId=start.batchId,chunkSize=start.maxChunkRows||300,expected={};
  for(const [dataset,rows] of Object.entries(datasets)){
    expected[dataset]=rows.length;let seq=0;
    for(let i=0;i<rows.length;i+=chunkSize){
      const chunk=rows.slice(i,i+chunkSize);
      await api({action:'chunk',batchId,dataset,seq,rows:chunk});
      console.log('Uploaded '+dataset+' chunk '+(seq+1)+': '+chunk.length);seq++;
    }
  }
  return api({action:'finalize',batchId,expected,sourceCheckedAt:new Date().toISOString(),range});
}

(async()=>{
  const startedAt=new Date().toISOString(),ranges=iranActivityRanges();
  console.log('Tickets-only CRM sync');
  const context=await chromium.launchPersistentContext(profileDir,{channel:'msedge',headless:true});
  const page=context.pages()[0]||await context.newPage();
  try{
    const crmConfig=await loadCrmConfig(connectorToken);
    CRM_ORIGIN=String(crmConfig.crmOrigin||CRM_ORIGIN).replace(/\/$/,'');
    CRM_API_PREFIX='/api/data/'+String(crmConfig.apiVersion||'v9.0').replace(/^\/+|\/+$/g,'');
    const ticketConfig=crmConfig.ticket||{};
    if(ticketConfig.enabled===false||String(ticketConfig.sourceMode||'crm').toLowerCase()!=='crm'){
      console.log('Ticket CRM sync skipped by admin configuration.');
      return;
    }
    await authenticate(page);
    const tickets=await fetchTickets(page,ranges.daily,'Daily tickets',ticketConfig);
    const weeklyTickets=await fetchTickets(page,ranges.weekly,'Weekly tickets',ticketConfig);
    const monthlyTickets=await fetchTickets(page,ranges.monthly,'Monthly tickets',ticketConfig);
    const result=await upload({tickets,weekly_tickets:weeklyTickets,monthly_tickets:monthlyTickets},ranges.daily);
    fs.writeFileSync(path.join(runtimeDir,'last-tickets-sync.json'),JSON.stringify({status:'success',startedAt,finishedAt:new Date().toISOString(),stored:result.counts},null,2),'utf8');
    console.log('');
    console.log('=== CRM TICKETS SYNC SUCCESS ===');
    console.log('Stored rows:',result.counts);
  }catch(error){
    fs.writeFileSync(path.join(runtimeDir,'last-tickets-sync.json'),JSON.stringify({status:'failed',startedAt,finishedAt:new Date().toISOString(),error:String(error?.message||error)},null,2),'utf8');
    console.error('CRM tickets sync failed:',error.message);process.exitCode=1;
  }finally{await context.close();}
})();