'use strict';

const fs=require('fs');
const path=require('path');
const {chromium}=require('playwright');
const {loadCrmConfig}=require('./config-client');
const {writeSnapshot}=require('./local-backup');
const {dashboardRequest}=require('./dashboard-http');
const {previousPersianMonthRange}=require('./persian-month');
require('dotenv').config({path:path.join(__dirname,'.env.local')});

let CRM_ORIGIN='https://mxrm.emofid.com';
let CRM_API_PREFIX='/api/data/v9.0';
const shadowUrl=process.env.DASHBOARD_API_URL||'https://tdsqkxyqmebyufcmskkm.supabase.co/functions/v1/connector-api/crm-shadow';
const activityUrl=process.env.DASHBOARD_ACTIVITY_API_URL||shadowUrl.replace(/\/crm-shadow\/?$/,'/crm-activity');
const API_URL=activityUrl.replace(/\/crm-activity\/?$/,'/crm-month-report');
const username=(process.env.CRM_USERNAME||'').trim();
const password=process.env.CRM_PASSWORD||'';
const connectorToken=process.env.CRM_CONNECTOR_TOKEN;
const force=process.argv.includes('--force');

if(!username||!password||!connectorToken){
  console.error('Missing connector credentials/config in .env.local');
  process.exit(1);
}

const runtimeDir=path.join(__dirname,'runtime');
const profileDir=path.join(runtimeDir,'browser-profile-activity');
const statusFile=path.join(runtimeDir,'last-month-report-sync.json');
fs.mkdirSync(runtimeDir,{recursive:true});

function formatted(row,field){
  return row[field+'@OData.Community.Display.V1.FormattedValue']??row[field]??null;
}
function normalizeFa(v){
  return String(v??'').replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\s+/g,' ').trim();
}
function cleanNumber(v){
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}

async function authenticate(page){
  console.log('Checking CRM session...');
  await page.goto(CRM_ORIGIN+'/',{waitUntil:'domcontentloaded',timeout:60000});
  if(page.url().includes('adfs.emofid.com')){
    console.log('CRM session expired. ADFS login required.');
    const u=page.locator('#userNameInput');
    await u.waitFor({state:'visible',timeout:30000});
    await u.fill(username);
    const submit=page.locator('#submitButton');
    if(await submit.isVisible().catch(()=>false))await submit.click();else await u.press('Enter');
    const p=page.locator('#passwordInput');
    await p.waitFor({state:'visible',timeout:30000});
    await p.fill(password);
    await Promise.all([
      page.waitForURL(url=>url.hostname==='mxrm.emofid.com',{timeout:120000}),
      (async()=>{if(await submit.isVisible().catch(()=>false))await submit.click();else await p.press('Enter');})()
    ]);
    console.log('ADFS login completed.');
  }else{
    console.log('Existing CRM session found.');
  }
  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  await page.waitForTimeout(2500);
  const status=await page.evaluate(async apiPrefix=>{
    const r=await fetch(apiPrefix+'/WhoAmI',{credentials:'include',headers:{Accept:'application/json'}});
    return r.status;
  },CRM_API_PREFIX);
  if(status!==200)throw new Error('WhoAmI failed HTTP '+status);
  console.log('CRM authentication validated.');
}

async function fetchPaged(page,label,url){
  const all=[];
  let n=0;
  while(url){
    const result=await page.evaluate(async requestUrl=>{
      const r=await fetch(requestUrl,{
        credentials:'include',
        headers:{
          Accept:'application/json',
          Prefer:'odata.include-annotations="OData.Community.Display.V1.FormattedValue,Microsoft.Dynamics.CRM.lookuplogicalname"'
        }
      });
      return {status:r.status,text:await r.text()};
    },url);
    if(result.status!==200){
      throw new Error(label+' CRM read failed HTTP '+result.status+': '+result.text.slice(0,700));
    }
    const data=JSON.parse(result.text),rows=data.value||[];
    all.push(...rows);
    n++;
    console.log(label+' page '+n+': '+rows.length+' - total '+all.length);
    if(data['@odata.nextLink']){
      const u=new URL(data['@odata.nextLink']);
      url=u.pathname+u.search;
    }else{
      url=null;
    }
  }
  return all;
}

async function getLeadSourceCaseDirectory(page,rows,label){
  const ids=[...new Set(rows.map(r=>String(r._ms_sourcecaseid_value||'').toLowerCase()).filter(Boolean))];
  const map=new Map();
  for(let i=0;i<ids.length;i+=35){
    const part=ids.slice(i,i+35);
    const filter=part.map(id=>'incidentid eq '+id).join(' or ');
    const cases=await fetchPaged(
      page,
      label+' source cases '+(Math.floor(i/35)+1),
      CRM_API_PREFIX+'/incidents?$select=incidentid,title,_ms_contactreasonid_value&$filter='+encodeURIComponent(filter)
    );
    for(const x of cases){
      map.set(String(x.incidentid||'').toLowerCase(),{
        subject:x.title??null,
        contactTopic:formatted(x,'_ms_contactreasonid_value')
      });
    }
  }
  return map;
}

async function fetchLeads(page,range,label,cfg){
  const select=[
    'leadid','ms_leadnumber','createdon','modifiedon','statecode','statuscode',
    'ms_nextcallreasontypecode','ms_followupby','fullname','firstname','middlename','lastname',
    '_createdby_value','_modifiedby_value','_ownerid_value','_owninguser_value',
    'ms_leadtypeleadtype','leadsourcecode','_campaignid_value','_ms_applicationid_value',
    'ms_nationalnumber','mobilephone','_ms_consultantuserid_value','_ms_marketeruserid_value',
    '_ms_sourcecaseid_value','ms_trafficsource'
  ].join(',');
  const dateField=String(cfg.dateField||'modifiedon');
  const entity=String(cfg.entity||'leads');
  const filter=`statecode ne 0 and ${dateField} ge ${range.start} and ${dateField} lt ${range.end}`;
  const url=CRM_API_PREFIX+'/'+entity+'?$select='+select+
    '&$filter='+encodeURIComponent(filter)+
    '&$expand=owningbusinessunit($select=name),customerid_contact($select=fullname,customertypecode,_ms_advisorid_value,_ms_marketeruserid_value)';
  const rows=await fetchPaged(page,label,url);
  const statuses=new Set((cfg.statuses||[]).map(normalizeFa));
  const units=new Set((cfg.businessUnits||[]).map(normalizeFa));
  const filtered=rows.filter(r=>
    statuses.has(normalizeFa(formatted(r,'statuscode'))) &&
    units.has(normalizeFa(r.owningbusinessunit?.name))
  );
  const sourceCases=await getLeadSourceCaseDirectory(page,filtered,label);

  return filtered.map(r=>{
    const sourceCase=sourceCases.get(String(r._ms_sourcecaseid_value||'').toLowerCase());
    return {
      lead_number:r.ms_leadnumber??null,
      created_date:r.createdon??null,
      customer_rank:r.customerid_contact?.['customertypecode@OData.Community.Display.V1.FormattedValue']??null,
      last_modified_date:r.modifiedon??null,
      last_status:formatted(r,'statuscode'),
      next_call_reason:formatted(r,'ms_nextcallreasontypecode'),
      next_followup_at:r.ms_followupby??null,
      customer_name:r.customerid_contact?.fullname??r.fullname??null,
      first_name:r.firstname??null,
      middle_name:r.middlename??null,
      last_name:r.lastname??null,
      last_modified_by:formatted(r,'_modifiedby_value'),
      creator:formatted(r,'_createdby_value'),
      owner:formatted(r,'_ownerid_value'),
      lead_type:formatted(r,'ms_leadtypeleadtype'),
      source:formatted(r,'leadsourcecode'),
      campaign:formatted(r,'_campaignid_value'),
      source_software:formatted(r,'_ms_applicationid_value'),
      identity_id:r.ms_nationalnumber??null,
      mobile:r.mobilephone??null,
      advisor:r.customerid_contact?.['_ms_advisorid_value@OData.Community.Display.V1.FormattedValue']??formatted(r,'_ms_consultantuserid_value'),
      referrer:r.customerid_contact?.['_ms_marketeruserid_value@OData.Community.Display.V1.FormattedValue']??formatted(r,'_ms_marketeruserid_value'),
      business_unit:r._owninguser_value?(r.owningbusinessunit?.name??null):null,
      source_ticket_subject:sourceCase?.subject??null,
      source_ticket_contact_topic:sourceCase?.contactTopic??null,
      traffic_source:r.ms_trafficsource??null
    };
  });
}

async function fetchOpportunities(page,range,label,cfg){
  const select=[
    'opportunityid','ms_opportunitynumber','name','createdon','statecode','statuscode',
    '_customerid_value','ms_opportunitysourcecode','_createdby_value','_ownerid_value',
    '_campaignid_value','_originatingleadid_value','_ms_sourcecaseid_value',
    'ms_documenttypecode','ms_typeofinvest','ms_totalestimateinvestment','ms_totalrealinvestment',
    '_ms_advisorid_value','_ms_marketeruserid_value','ms_nationalnumber'
  ].join(',');
  const dateField=String(cfg.dateField||'createdon');
  const entity=String(cfg.entity||'opportunities');
  const filter=`${dateField} ge ${range.start} and ${dateField} lt ${range.end}`;
  const raw=await fetchPaged(
    page,
    label,
    CRM_API_PREFIX+'/'+entity+'?$select='+select+
      '&$filter='+encodeURIComponent(filter)+
      '&$expand=createdby($select=fullname,_businessunitid_value)'
  );
  const units=new Set((cfg.businessUnits||[]).map(normalizeFa));

  return raw
    .filter(r=>units.has(normalizeFa(
      r.createdby?.['_businessunitid_value@OData.Community.Display.V1.FormattedValue']
    )))
    .map(r=>{
      const title=r.name??'';
      const upper=String(title).toUpperCase();
      const leadMatch=String(title).match(/LEAD-\d+/i);
      const registration_type=/(^|-)OPP-/i.test(upper)
        ?'OPP'
        :/(^|-)LEAD-/i.test(upper)
          ?'LEAD'
          :(leadMatch?'LEAD':'');
      return {
        opportunity_id:r.ms_opportunitynumber??r.opportunityid??null,
        title,
        created_date:r.createdon??null,
        last_status:formatted(r,'statuscode'),
        status:formatted(r,'statecode'),
        potential_customer:formatted(r,'_customerid_value'),
        source:formatted(r,'ms_opportunitysourcecode'),
        creator:r.createdby?.fullname??formatted(r,'_createdby_value'),
        owner:formatted(r,'_ownerid_value'),
        business_unit:r.createdby?.['_businessunitid_value@OData.Community.Display.V1.FormattedValue']??null,
        campaign_reference:formatted(r,'_campaignid_value'),
        ticket_source:formatted(r,'_ms_sourcecaseid_value'),
        sales_case_type:formatted(r,'ms_documenttypecode'),
        investment_type:formatted(r,'ms_typeofinvest'),
        expected_investment:cleanNumber(r.ms_totalestimateinvestment),
        actual_investment:cleanNumber(r.ms_totalrealinvestment),
        advisor:formatted(r,'_ms_advisorid_value'),
        referrer:formatted(r,'_ms_marketeruserid_value'),
        registration_type,
        lead_number:leadMatch?leadMatch[0].toUpperCase():null
      };
    });
}

async function getCallUserDirectory(page){
  const users=await fetchPaged(
    page,
    'Call users',
    CRM_API_PREFIX+'/systemusers?$select=systemuserid,fullname,_businessunitid_value'
  );
  const map=new Map();
  for(const u of users){
    map.set(String(u.systemuserid||'').toLowerCase(),{
      fullname:u.fullname??null,
      businessUnit:formatted(u,'_businessunitid_value')
    });
  }
  return map;
}

async function getRegardingLeadDirectory(page,rows,label){
  const ids=[...new Set(rows
    .filter(r=>String(
      r['_regardingobjectid_value@Microsoft.Dynamics.CRM.lookuplogicalname']||''
    ).toLowerCase()==='lead')
    .map(r=>String(r._regardingobjectid_value||'').toLowerCase())
    .filter(Boolean))];
  const map=new Map();
  for(let i=0;i<ids.length;i+=35){
    const part=ids.slice(i,i+35);
    const filter=part.map(id=>'leadid eq '+id).join(' or ');
    const leads=await fetchPaged(
      page,
      label+' regarding leads '+(Math.floor(i/35)+1),
      CRM_API_PREFIX+'/leads?$select=leadid,ms_leadnumber&$filter='+encodeURIComponent(filter)
    );
    for(const lead of leads){
      map.set(String(lead.leadid||'').toLowerCase(),lead.ms_leadnumber??null);
    }
  }
  return map;
}

async function fetchCalls(page,range,label,userDirectory,callConfig){
  const select=[
    'activityid','subject','_ms_partyuserid_value','_ms_callqueueid_value','scheduledstart','actualstart',
    '_ms_partycontactid_value','_regardingobjectid_value','ms_tophonenumber','phonenumber',
    'ms_parameters','ms_callduration','actualdurationminutes'
  ].join(',');
  const dateField=String(callConfig?.dateField||'scheduledstart');
  const entity=String(callConfig?.entity||'phonecalls');
  const filter=`${dateField} ge ${range.start} and ${dateField} lt ${range.end}`;
  const raw=await fetchPaged(
    page,
    label,
    CRM_API_PREFIX+'/'+entity+'?$select='+select+'&$filter='+encodeURIComponent(filter)
  );
  const regardingLeadDirectory=await getRegardingLeadDirectory(page,raw,label);
  const allowedUnits=new Set((callConfig?.businessUnits||[]).map(normalizeFa));

  return raw
    .filter(row=>{
      const userId=String(row._ms_partyuserid_value||'').toLowerCase();
      const info=userDirectory.get(userId);
      return allowedUnits.has(normalizeFa(info?.businessUnit));
    })
    .map(row=>{
      const subject=row.subject??'';
      const leadMatch=String(subject).match(/(?:LEAD|OPP)-\d+/i);
      const regardingType=String(
        row['_regardingobjectid_value@Microsoft.Dynamics.CRM.lookuplogicalname']||''
      ).toLowerCase();
      const regardingId=String(row._regardingobjectid_value||'').toLowerCase();
      const regardingLead=regardingType==='lead'
        ?regardingLeadDirectory.get(regardingId)
        :null;
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
        lead_number:regardingLead||(leadMatch?leadMatch[0].toUpperCase():null)
      };
    });
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
    const rows=await fetchPaged(
      page,
      label+' cases '+(Math.floor(i/35)+1),
      CRM_API_PREFIX+'/'+caseEntity+'?$select='+select+'&$filter='+encodeURIComponent(filter)
    );
    for(const row of rows)map.set(String(row.incidentid||'').toLowerCase(),row);
  }
  return map;
}

async function fetchTickets(page,range,label,ticketConfig){
  const qSelect=[
    'queueitemid','title','_queueid_value','_objectid_value','_workerid_value','enteredon','modifiedon'
  ].join(',');
  const dateField=String(ticketConfig?.dateField||'modifiedon');
  const queueEntity=String(ticketConfig?.queueEntity||'queueitems');
  const caseEntity=String(ticketConfig?.caseEntity||'incidents');
  const allowedQueues=new Set((ticketConfig?.queues||[]).map(normalizeFa));
  const allowedTopics=new Set((ticketConfig?.topics||[]).map(normalizeFa));
  const excludedStatuses=new Set((ticketConfig?.excludedStatuses||[]).map(normalizeFa));
  const allowedRanks=new Set((ticketConfig?.customerRanks||[]).map(normalizeFa));
  const qFilter=`${dateField} ge ${range.start} and ${dateField} lt ${range.end}`;
  const queueRows=await fetchPaged(
    page,
    label+' queue items',
    CRM_API_PREFIX+'/'+queueEntity+'?$select='+qSelect+'&$filter='+encodeURIComponent(qFilter)
  );
  const queueFiltered=queueRows.filter(r=>
    allowedQueues.has(normalizeFa(formatted(r,'_queueid_value')))
  );
  console.log(label+' allowed queue rows:',queueFiltered.length);

  const incidentMap=await fetchIncidentMap(
    page,
    queueFiltered.map(r=>r._objectid_value),
    label,
    caseEntity
  );
  const out=[];
  for(const q of queueFiltered){
    const incident=incidentMap.get(String(q._objectid_value||'').toLowerCase());
    if(!incident)continue;

    const contactTopic=formatted(incident,'_ms_contactreasonid_value');
    const mainSubject=formatted(incident,'_ms_actualcontactreasonid_value');
    const status=formatted(incident,'statuscode');
    const rank=formatted(incident,'ms_customertypecode');

    if(!(allowedTopics.has(normalizeFa(contactTopic))||allowedTopics.has(normalizeFa(mainSubject))))continue;
    if(excludedStatuses.has(normalizeFa(status)))continue;
    if(!allowedRanks.has(normalizeFa(rank)))continue;

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
      const r=await dashboardRequest(API_URL,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'x-crm-connector-token':connectorToken
        },
        body:JSON.stringify(body),
        timeoutMs:60000
      });
      if(!r.ok)throw new Error('Month-report API HTTP '+r.status+': '+r.text);
      return JSON.parse(r.text);
    }catch(e){
      lastError=e;
      console.log('Month-report API attempt '+attempt+' failed: '+(e?.message||e));
      if(attempt<4)await new Promise(resolve=>setTimeout(resolve,1500*attempt));
    }
  }
  throw lastError;
}

async function remoteStatus(){
  const r=await dashboardRequest(API_URL,{
    method:'GET',
    headers:{'x-crm-connector-token':connectorToken},
    timeoutMs:60000
  });
  if(!r.ok)throw new Error('Month-report status HTTP '+r.status+': '+r.text);
  const body=JSON.parse(r.text);
  return body?.status||{};
}

async function upload(datasets,range){
  const start=await api({action:'start'});
  const expected={};
  const size=start.maxChunkRows||300;
  for(const [dataset,rows] of Object.entries(datasets)){
    expected[dataset]=rows.length;
    let seq=0;
    for(let i=0;i<rows.length;i+=size){
      const part=rows.slice(i,i+size);
      await api({
        action:'chunk',
        batchId:start.batchId,
        dataset,
        seq,
        rows:part
      });
      console.log('Uploaded '+dataset+' chunk '+(seq+1)+': '+part.length);
      seq++;
    }
  }
  return api({
    action:'finalize',
    batchId:start.batchId,
    expected,
    sourceCheckedAt:new Date().toISOString(),
    range
  });
}

function writeStatus(status){
  fs.writeFileSync(statusFile,JSON.stringify(status,null,2),'utf8');
}

(async()=>{
  const startedAt=new Date().toISOString();
  const range=previousPersianMonthRange();

  console.log('CRM previous Persian-month report sync');
  console.log('Target:',range.label,'['+range.reportKey+']');
  console.log('UTC range:',range.start,'->',range.end);

  try{
    if(!force&&range.currentPersianDay<20){
      console.log('MONTH_REPORT_NOT_DUE: Persian day is '+range.currentPersianDay+'; first eligible day is 20.');
      process.exitCode=0;
      return;
    }

    const status=await remoteStatus().catch(()=>({}));
    if(!force&&status?.period===range.reportKey&&status?.lastSyncAt){
      console.log('MONTH_REPORT_ALREADY_CURRENT:',range.reportKey,status.lastSyncAt);
      writeStatus({
        status:'success',
        skipped:'already-current',
        reportKey:range.reportKey,
        label:range.label,
        range:{start:range.start,end:range.end},
        startedAt,
        finishedAt:new Date().toISOString(),
        stored:status.counts||{}
      });
      return;
    }

    const crmConfig=await loadCrmConfig(connectorToken);
    CRM_ORIGIN=String(crmConfig.crmOrigin||CRM_ORIGIN).replace(/\/$/,'');
    CRM_API_PREFIX='/api/data/'+String(crmConfig.apiVersion||'v9.0').replace(/^\/+|\/+$/g,'');

    const leadConfig=crmConfig.lead||{};
    const oppConfig=crmConfig.opportunity||{};
    const callConfig=crmConfig.calls||{};
    const ticketConfig=crmConfig.ticket||{};
    const enabled=[
      ['Lead',leadConfig],
      ['Opportunity',oppConfig],
      ['Calls',callConfig],
      ['Tickets',ticketConfig]
    ].filter(([,cfg])=>cfg.enabled===false||String(cfg.sourceMode||'crm').toLowerCase()!=='crm');
    if(enabled.length){
      throw new Error(
        'Month report requires all four CRM sources enabled. Disabled: '+
        enabled.map(([name])=>name).join(', ')
      );
    }

    const context=await chromium.launchPersistentContext(
      profileDir,
      {channel:'msedge',headless:true}
    );
    const page=context.pages()[0]||await context.newPage();

    try{
      await authenticate(page);
      const users=await getCallUserDirectory(page);

      const leads=await fetchLeads(page,range,'Previous-month leads',leadConfig);
      const opportunities=await fetchOpportunities(
        page,range,'Previous-month opportunities',oppConfig
      );
      const calls=await fetchCalls(
        page,range,'Previous-month calls',users,callConfig
      );
      const tickets=await fetchTickets(
        page,range,'Previous-month tickets',ticketConfig
      );

      const datasets={
        report_month_leads:leads,
        report_month_opportunities:opportunities,
        report_month_calls:calls,
        report_month_tickets:tickets
      };

      console.log('Previous-month filtered rows:',
        Object.fromEntries(Object.entries(datasets).map(([k,v])=>[k,v.length]))
      );

      for(const [dataset,rows] of Object.entries(datasets)){
        writeSnapshot(dataset,rows,{
          source:'crm',
          reportKey:range.reportKey,
          label:range.label,
          range:{start:range.start,end:range.end}
        });
      }

      const result=await upload(datasets,{
        reportKey:range.reportKey,
        label:range.label,
        start:range.start,
        end:range.end
      });

      writeStatus({
        status:'success',
        reportKey:range.reportKey,
        label:range.label,
        range:{start:range.start,end:range.end},
        startedAt,
        finishedAt:new Date().toISOString(),
        stored:result.counts
      });

      console.log('');
      console.log('=== CRM PREVIOUS MONTH REPORT SYNC SUCCESS ===');
      console.log('Report:',range.label,'['+range.reportKey+']');
      console.log('Stored rows:',result.counts);
    }finally{
      await context.close();
    }
  }catch(error){
    writeStatus({
      status:'failed',
      reportKey:range.reportKey,
      label:range.label,
      range:{start:range.start,end:range.end},
      startedAt,
      finishedAt:new Date().toISOString(),
      error:String(error?.message||error)
    });
    console.error('CRM previous-month report sync failed:',error?.message||error);
    process.exitCode=1;
  }
})();
