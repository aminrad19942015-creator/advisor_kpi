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
if(!username||!password||!connectorToken){console.error('Missing connector config in .env.local');process.exit(1);}

const runtimeDir=path.join(__dirname,'runtime');
const profileDir=path.join(runtimeDir,'browser-profile');
fs.mkdirSync(runtimeDir,{recursive:true});

function formatted(row,field){return row[field+'@OData.Community.Display.V1.FormattedValue']??row[field]??null;}
function normalizeFa(v){return String(v??'').replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\s+/g,' ').trim();}
function cleanNumber(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function ranges(){
 const offset=3.5*3600*1000,now=Date.now(),iran=new Date(now+offset);
 const y=iran.getUTCFullYear(),m=iran.getUTCMonth(),d=iran.getUTCDate(),hh=iran.getUTCHours(),mm=iran.getUTCMinutes(),ss=iran.getUTCSeconds(),ms=iran.getUTCMilliseconds();
 const midnight=Date.UTC(y,m,d)-offset;
 return {daily:{start:new Date(midnight-86400000).toISOString(),end:new Date(midnight).toISOString()},weekly:{start:new Date(now-7*86400000).toISOString(),end:new Date(now).toISOString()},monthly:{start:new Date(Date.UTC(y,m-1,d,hh,mm,ss,ms)-offset).toISOString(),end:new Date(now).toISOString()}};
}

async function authenticate(page){
 console.log('Checking CRM session...');
 await page.goto(CRM_ORIGIN+'/',{waitUntil:'domcontentloaded',timeout:60000});
 if(page.url().includes('adfs.emofid.com')){
  console.log('CRM session expired. ADFS login required.');
  const u=page.locator('#userNameInput');await u.waitFor({state:'visible',timeout:30000});await u.fill(username);
  const submit=page.locator('#submitButton');if(await submit.isVisible().catch(()=>false))await submit.click();else await u.press('Enter');
  const p=page.locator('#passwordInput');await p.waitFor({state:'visible',timeout:30000});await p.fill(password);
  await Promise.all([page.waitForURL(url=>url.hostname==='mxrm.emofid.com',{timeout:120000}),(async()=>{if(await submit.isVisible().catch(()=>false))await submit.click();else await p.press('Enter');})()]);
  console.log('ADFS login completed.');
 }
 await page.waitForTimeout(2500);
 const status=await page.evaluate(async()=>{const r=await fetch(CRM_API_PREFIX+'/WhoAmI',{credentials:'include',headers:{Accept:'application/json'}});return r.status;});
 if(status!==200)throw new Error('WhoAmI failed HTTP '+status);
 console.log('CRM authentication validated.');
}

async function fetchPaged(page,label,url){
 const all=[];let n=0;
 while(url){
  const result=await page.evaluate(async requestUrl=>{const r=await fetch(requestUrl,{credentials:'include',headers:{Accept:'application/json',Prefer:'odata.include-annotations="OData.Community.Display.V1.FormattedValue"'}});return {status:r.status,text:await r.text()};},url);
  if(result.status!==200)throw new Error(label+' CRM read failed HTTP '+result.status+': '+result.text.slice(0,700));
  const data=JSON.parse(result.text),rows=data.value||[];all.push(...rows);n++;console.log(label+' page '+n+': '+rows.length+' - total '+all.length);
  if(data['@odata.nextLink']){const u=new URL(data['@odata.nextLink']);url=u.pathname+u.search;}else url=null;
 }
 return all;
}

async function fetchLeads(page,range,label,cfg){
 const select=['leadid','ms_leadnumber','createdon','modifiedon','statecode','statuscode','ms_nextcallreasontypecode','ms_followupby','fullname','firstname','middlename','lastname','_createdby_value','_modifiedby_value','_ownerid_value','_owninguser_value','ms_leadtypeleadtype','leadsourcecode','_campaignid_value','_ms_applicationid_value','ms_nationalnumber','mobilephone','_ms_consultantuserid_value','_ms_marketeruserid_value','ms_trafficsource'].join(',');
 const dateField=String(cfg.dateField||'modifiedon'),entity=String(cfg.entity||'leads');
 const filter=`statecode ne 0 and ${dateField} ge ${range.start} and ${dateField} lt ${range.end}`;
 const url=CRM_API_PREFIX+'/'+entity+'?$select='+select+'&$filter='+encodeURIComponent(filter)+'&$expand=owningbusinessunit($select=name),customerid_contact($select=fullname,customertypecode,_ms_advisorid_value,_ms_marketeruserid_value)';
 const rows=await fetchPaged(page,label,url),statuses=new Set((cfg.statuses||[]).map(normalizeFa)),units=new Set((cfg.businessUnits||[]).map(normalizeFa));
 return rows.filter(r=>statuses.has(normalizeFa(formatted(r,'statuscode')))&&units.has(normalizeFa(r.owningbusinessunit?.name))).map(r=>({lead_number:r.ms_leadnumber??null,created_date:r.createdon??null,customer_rank:r.customerid_contact?.['customertypecode@OData.Community.Display.V1.FormattedValue']??null,last_modified_date:r.modifiedon??null,last_status:formatted(r,'statuscode'),next_call_reason:formatted(r,'ms_nextcallreasontypecode'),next_followup_at:r.ms_followupby??null,customer_name:r.customerid_contact?.fullname??r.fullname??null,first_name:r.firstname??null,middle_name:r.middlename??null,last_name:r.lastname??null,last_modified_by:formatted(r,'_modifiedby_value'),creator:formatted(r,'_createdby_value'),owner:formatted(r,'_ownerid_value'),lead_type:formatted(r,'ms_leadtypeleadtype'),source:formatted(r,'leadsourcecode'),campaign:formatted(r,'_campaignid_value'),source_software:formatted(r,'_ms_applicationid_value'),identity_id:r.ms_nationalnumber??null,mobile:r.mobilephone??null,advisor:r.customerid_contact?.['_ms_advisorid_value@OData.Community.Display.V1.FormattedValue']??formatted(r,'_ms_consultantuserid_value'),referrer:r.customerid_contact?.['_ms_marketeruserid_value@OData.Community.Display.V1.FormattedValue']??formatted(r,'_ms_marketeruserid_value'),business_unit:r._owninguser_value?(r.owningbusinessunit?.name??null):null,traffic_source:r.ms_trafficsource??null}));
}

async function fetchOpps(page,range,label,cfg){
 const select=['opportunityid','ms_opportunitynumber','name','createdon','statecode','statuscode','_customerid_value','ms_opportunitysourcecode','_createdby_value','_ownerid_value','_campaignid_value','_originatingleadid_value','_ms_sourcecaseid_value','ms_documenttypecode','ms_typeofinvest','ms_totalestimateinvestment','ms_totalrealinvestment','_ms_advisorid_value','_ms_marketeruserid_value','ms_nationalnumber'].join(',');
 const dateField=String(cfg.dateField||'createdon'),entity=String(cfg.entity||'opportunities'),filter=`${dateField} ge ${range.start} and ${dateField} lt ${range.end}`;
 const raw=await fetchPaged(page,label,CRM_API_PREFIX+'/'+entity+'?$select='+select+'&$filter='+encodeURIComponent(filter)+'&$expand=createdby($select=fullname,_businessunitid_value)');
 const units=new Set((cfg.businessUnits||[]).map(normalizeFa));
 return raw.filter(r=>units.has(normalizeFa(r.createdby?.['_businessunitid_value@OData.Community.Display.V1.FormattedValue']))).map(r=>{const title=r.name??'',upper=String(title).toUpperCase(),leadMatch=String(title).match(/LEAD-\d+/i),registration_type=/(^|-)OPP-/i.test(upper)?'OPP':/(^|-)LEAD-/i.test(upper)?'LEAD':(leadMatch?'LEAD':'');return {opportunity_id:r.ms_opportunitynumber??r.opportunityid??null,title,created_date:r.createdon??null,last_status:formatted(r,'statuscode'),status:formatted(r,'statecode'),potential_customer:formatted(r,'_customerid_value'),source:formatted(r,'ms_opportunitysourcecode'),creator:r.createdby?.fullname??formatted(r,'_createdby_value'),owner:formatted(r,'_ownerid_value'),business_unit:r.createdby?.['_businessunitid_value@OData.Community.Display.V1.FormattedValue']??null,campaign_reference:formatted(r,'_campaignid_value'),ticket_source:formatted(r,'_ms_sourcecaseid_value'),sales_case_type:formatted(r,'ms_documenttypecode'),investment_type:formatted(r,'ms_typeofinvest'),expected_investment:cleanNumber(r.ms_totalestimateinvestment),actual_investment:cleanNumber(r.ms_totalrealinvestment),advisor:formatted(r,'_ms_advisorid_value'),referrer:formatted(r,'_ms_marketeruserid_value'),registration_type,lead_number:leadMatch?leadMatch[0].toUpperCase():null};});
}

async function api(body){
 let last;
 for(let a=1;a<=4;a++)try{const r=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','x-crm-connector-token':connectorToken},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const t=await r.text();if(!r.ok)throw new Error('Dashboard activity API HTTP '+r.status+': '+t);return JSON.parse(t);}catch(e){last=e;console.log('Dashboard API attempt '+a+' failed: '+(e?.message||e));if(a<4)await new Promise(res=>setTimeout(res,1500*a));}
 throw last;
}
async function upload(datasets,range){
 const s=await api({action:'start'}),expected={},size=s.maxChunkRows||300;
 for(const [dataset,rows] of Object.entries(datasets)){expected[dataset]=rows.length;let seq=0;for(let i=0;i<rows.length;i+=size){const part=rows.slice(i,i+size);await api({action:'chunk',batchId:s.batchId,dataset,seq,rows:part});console.log('Uploaded '+dataset+' chunk '+(seq+1)+': '+part.length);seq++;}}
 return api({action:'finalize',batchId:s.batchId,expected,sourceCheckedAt:new Date().toISOString(),range});
}

(async()=>{
 const startedAt=new Date().toISOString(),r=ranges(),context=await chromium.launchPersistentContext(profileDir,{channel:'msedge',headless:true}),page=context.pages()[0]||await context.newPage();
 try{
  const cfg=await loadCrmConfig(connectorToken);CRM_ORIGIN=String(cfg.crmOrigin||CRM_ORIGIN).replace(/\/$/,'');CRM_API_PREFIX='/api/data/'+String(cfg.apiVersion||'v9.0').replace(/^\/+|\/+$/g,'');
  const leadCfg=cfg.lead||{},oppCfg=cfg.opportunity||{};
  const leadOn=leadCfg.enabled!==false&&String(leadCfg.sourceMode||'crm').toLowerCase()==='crm';
  const oppOn=oppCfg.enabled!==false&&String(oppCfg.sourceMode||'crm').toLowerCase()==='crm';
  if(!leadOn&&!oppOn){console.log('Lead/Opportunity CRM sync skipped by admin configuration.');return;}
  await authenticate(page);
  const datasets={};
  if(leadOn){datasets.leads=await fetchLeads(page,r.daily,'Daily leads',leadCfg);datasets.weekly_leads=await fetchLeads(page,r.weekly,'Weekly leads',leadCfg);datasets.monthly_leads=await fetchLeads(page,r.monthly,'Monthly leads',leadCfg);}
  if(oppOn){datasets.opportunities=await fetchOpps(page,r.daily,'Daily opportunities',oppCfg);datasets.weekly_opportunities=await fetchOpps(page,r.weekly,'Weekly opportunities',oppCfg);datasets.monthly_opportunities=await fetchOpps(page,r.monthly,'Monthly opportunities',oppCfg);}
  const result=await upload(datasets,r.daily);
  fs.writeFileSync(path.join(runtimeDir,'last-lead-opp-sync.json'),JSON.stringify({status:'success',startedAt,finishedAt:new Date().toISOString(),stored:result.counts},null,2),'utf8');
  console.log('=== CRM LEAD/OPPORTUNITY SYNC SUCCESS ===');console.log('Stored rows:',result.counts);
 }catch(error){fs.writeFileSync(path.join(runtimeDir,'last-lead-opp-sync.json'),JSON.stringify({status:'failed',startedAt,finishedAt:new Date().toISOString(),error:String(error?.message||error)},null,2),'utf8');console.error('CRM lead/opportunity sync failed:',error.message);process.exitCode=1;}
 finally{await context.close();}
})();