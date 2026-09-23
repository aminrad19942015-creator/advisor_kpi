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
      (async()=>{ if(await submit.isVisible().catch(()=>false)) await submit.click(); else await passwordInput.press('Enter'); })()
    ]);
    console.log('ADFS login completed.');
  } else console.log('Existing CRM session found.');

  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  await page.waitForTimeout(3000);
  const probe=await page.evaluate(async()=>{
    const r=await fetch('/api/data/v9.0/WhoAmI',{credentials:'include',headers:{Accept:'application/json'}});
    return {status:r.status,text:await r.text()};
  });
  if(probe.status!==200) throw new Error('WhoAmI failed with HTTP '+probe.status);
  console.log('CRM authentication validated.');
}

async function fetchPaged(page,label,url){
  const all=[]; let n=0;
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
    const data=JSON.parse(result.text),rows=data.value||[];
    all.push(...rows); n++;
    console.log(label+' page '+n+': '+rows.length+' - total '+all.length);
    if(data['@odata.nextLink']){
      const u=new URL(data['@odata.nextLink']);
      url=u.pathname+u.search;
    } else url=null;
  }
  return all;
}

let callUserDirectoryPromise=null;
async function getCallUserDirectory(page){
  if(!callUserDirectoryPromise){
    callUserDirectoryPromise=(async()=>{
      const users=await fetchPaged(
        page,
        'Call users',
        '/api/data/v9.0/systemusers?$select=systemuserid,fullname,_businessunitid_value'
      );
      const map=new Map();
      for(const u of users){
        map.set(String(u.systemuserid||'').toLowerCase(),{
          fullname:u.fullname??null,
          businessUnit:formatted(u,'_businessunitid_value')
        });
      }
      return map;
    })();
  }
  return callUserDirectoryPromise;
}

async function fetchLeadActivity(page,range,label='Leads'){
  const select=[
    'leadid','ms_leadnumber','createdon','modifiedon','statecode','statuscode',
    'ms_nextcallreasontypecode','ms_followupby','fullname','firstname','middlename','lastname',
    '_createdby_value','_modifiedby_value','_ownerid_value','_owninguser_value',
    'ms_leadtypeleadtype','leadsourcecode','_campaignid_value','_ms_applicationid_value',
    'ms_nationalnumber','mobilephone','_ms_consultantuserid_value','_ms_marketeruserid_value',
    'ms_trafficsource'
  ].join(',');
  const filter=`statecode ne 0 and modifiedon ge ${range.start} and modifiedon lt ${range.end}`;
  const url='/api/data/v9.0/leads?$select='+select+'&$filter='+encodeURIComponent(filter)+
    '&$expand=owningbusinessunit($select=name),customerid_contact($select=fullname,customertypecode,_ms_advisorid_value,_ms_marketeruserid_value)';
  const rows=await fetchPaged(page,label,url);

  // Business rules for "daily leads" (فعالیت دیروز / سرنخ‌ها):
  // 1) modified yesterday (already enforced in the CRM query)
  // 2) owner must be in team_members (enforced server-side at finalize)
  // 3) status must be one of the approved final statuses below
  // 4) owning business unit must be one of the three approved units
  const normalizeFa=v=>String(v??'')
    .replace(/ي/g,'ی').replace(/ك/g,'ک')
    .replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/\\s+/g,' ').trim();

  const allowedLeadStatuses=new Set([
    'تبدیل به فرصت فروش',
    'دریافت پشتیبانی',
    'عدم پاسخ (2 بار )',
    'سرمایه گذاری برای دیگران',
    'تیکت اشتباه',
    'مشتری بلاک لیست',
    'منصرف شده اند',
    'تماس تکراری',
    'بررسی مجدد در آینده',
    'ارجاع به شعبه',
    'تمایلی ندارند',
    'شماره تماس اشخاص دیگر',
    'BM - عدم نیاز به ارتباط گیری',
    'عدم تعیین وضعیت در زمان مقرر'
  ].map(normalizeFa));

  const allowedBusinessUnits=new Set([
    'واحد شبکه فروش',
    'شعبه مشاوره سرمایه گذاری',
    'شعبه مشتریان ویژه'
  ].map(normalizeFa));

  return rows.filter(r=>{
    const status=normalizeFa(formatted(r,'statuscode'));
    const businessUnit=normalizeFa(r.owningbusinessunit?.name);
    return allowedLeadStatuses.has(status) && allowedBusinessUnits.has(businessUnit);
  }).map(r=>({
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
    traffic_source:r.ms_trafficsource??null
  }));
}

async function fetchOpportunityActivity(page,range,label='Opportunities'){
  const select=[
    'opportunityid','ms_opportunitynumber','name','createdon','statecode','statuscode',
    '_customerid_value','ms_opportunitysourcecode','_createdby_value','_ownerid_value',
    '_campaignid_value','_originatingleadid_value','_ms_sourcecaseid_value',
    'ms_documenttypecode','ms_typeofinvest','ms_totalestimateinvestment','ms_totalrealinvestment',
    '_ms_advisorid_value','_ms_marketeruserid_value','ms_nationalnumber'
  ].join(',');
  const filter=`createdon ge ${range.start} and createdon lt ${range.end}`;
  const oppUrl='/api/data/v9.0/opportunities?$select='+select+
    '&$filter='+encodeURIComponent(filter)+
    '&$expand=createdby($select=fullname,_businessunitid_value)';
  const rawRows=await fetchPaged(page,label,oppUrl);

  const normalizeFa=v=>String(v??'')
    .replace(/ي/g,'ی').replace(/ك/g,'ک')
    .replace(/\\s+/g,' ').trim();
  const allowedCreatorBusinessUnits=new Set([
    'شعبه مشتریان ویژه',
    'واحد شبکه فروش',
    'شعبه مشاوره سرمایه گذاری'
  ].map(normalizeFa));

  const rows=rawRows.filter(r=>{
    const creatorBu=normalizeFa(
      r.createdby?.['_businessunitid_value@OData.Community.Display.V1.FormattedValue']
    );
    return allowedCreatorBusinessUnits.has(creatorBu);
  });
  return rows.map(r=>{
    const title=r.name??'',upper=String(title).toUpperCase();
    const leadMatch=String(title).match(/LEAD-\d+/i);
    const registration_type=/(^|-)OPP-/i.test(upper)?'OPP':/(^|-)LEAD-/i.test(upper)?'LEAD':(leadMatch?'LEAD':'');
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

async function fetchCallActivity(page,range,label='Calls'){
  const select=[
    'activityid','subject','_ms_partyuserid_value','_ms_callqueueid_value','scheduledstart','actualstart',
    '_ms_partycontactid_value','ms_tophonenumber','phonenumber','ms_parameters','ms_callduration','actualdurationminutes'
  ].join(',');
  const filter=`scheduledstart ge ${range.start} and scheduledstart lt ${range.end}`;
  const callUrl='/api/data/v9.0/phonecalls?$select='+select+
    '&$filter='+encodeURIComponent(filter);
  const rawRows=await fetchPaged(page,label,callUrl);
  const userDirectory=await getCallUserDirectory(page);

  const normalizeFa=v=>String(v??'')
    .replace(/ي/g,'ی').replace(/ك/g,'ک')
    .replace(/\\s+/g,' ').trim();

  const allowedUserBusinessUnits=new Set([
    'شعبه مشتریان ویژه',
    'واحد شبکه فروش',
    'شعبه مشاوره سرمایه گذاری'
  ].map(normalizeFa));

  const rows=rawRows.filter(r=>{
    const userId=String(r._ms_partyuserid_value||'').toLowerCase();
    const userInfo=userDirectory.get(userId);
    return allowedUserBusinessUnits.has(normalizeFa(userInfo?.businessUnit));
  });

  return rows.map(r=>{
    const subject=r.subject??'',m=String(subject).match(/(?:LEAD|OPP)-\d+/i);
    const userId=String(r._ms_partyuserid_value||'').toLowerCase();
    const userInfo=userDirectory.get(userId);
    return {
      call_id:r.activityid??null,
      subject,
      user:userInfo?.fullname??formatted(r,'_ms_partyuserid_value'),
      queue:formatted(r,'_ms_callqueueid_value'),
      planned_start:r.scheduledstart??null,
      start_date:r.scheduledstart??null,
      customer:formatted(r,'_ms_partycontactid_value'),
      destination_number:r.ms_tophonenumber??null,
      phone_number:r.phonenumber??null,
      parameters:r.ms_parameters??null,
      duration:cleanNumber(r.actualdurationminutes)??cleanNumber(r.ms_callduration),
      business_unit:userInfo?.businessUnit??null,
      lead_number:m?m[0].toUpperCase():null
    };
  });
}

async function fetchDailyTickets(page,range){
  const select=[
    'incidentid','title','_ms_contactreasonid_value','_ms_actualcontactreasonid_value','_ownerid_value',
    'resolveby','statuscode','ms_customertypecode','description','caseorigincode','ticketnumber',
    'ms_nationalnumber','ms_resolvedatetime','modifiedon','_modifiedby_value','createdon','_createdby_value'
  ].join(',');
  const filter=`ms_resolvedatetime ge ${range.start} and ms_resolvedatetime lt ${range.end}`;
  const rows=await fetchPaged(page,'Tickets','/api/data/v9.0/incidents?$select='+select+'&$filter='+encodeURIComponent(filter));
  return rows.map(r=>({
    queue_item_id:r.incidentid??null,
    title:r.title??null,
    contact_topic:formatted(r,'_ms_contactreasonid_value'),
    main_subject:formatted(r,'_ms_actualcontactreasonid_value'),
    owner:formatted(r,'_ownerid_value'),
    resolve_by:r.resolveby??null,
    status_reason:formatted(r,'statuscode'),
    customer_rank:formatted(r,'ms_customertypecode'),
    description:r.description??null,
    origin:formatted(r,'caseorigincode'),
    case_number:r.ticketnumber??null,
    national_id:r.ms_nationalnumber??null,
    type:'incident',
    closed_at:r.ms_resolvedatetime??r.modifiedon??null,
    modified_on:r.modifiedon??null,
    modified_by:formatted(r,'_modifiedby_value'),
    created_on:r.createdon??null,
    created_by:formatted(r,'_createdby_value')
  }));
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
      const txt=await response.text();
      if(!response.ok) throw new Error('Dashboard activity API HTTP '+response.status+': '+txt);
      return JSON.parse(txt);
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
  const batchId=start.batchId,chunkSize=start.maxChunkRows||300;
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
  const startedAt=new Date().toISOString(),ranges=iranActivityRanges(),range=ranges.daily;
  console.log('Sync scope:',syncScope);
  console.log('Iran daily UTC range:',ranges.daily.start,'->',ranges.daily.end);
  console.log('Iran weekly UTC range:',ranges.weekly.start,'->',ranges.weekly.end);
  console.log('Iran monthly UTC range:',ranges.monthly.start,'->',ranges.monthly.end);

  const context=await chromium.launchPersistentContext(profileDir,{channel:'msedge',headless:true});
  const page=context.pages()[0]||await context.newPage();

  try{
    await authenticate(page);

    let datasets;
    if(syncScope==='calls'){
      const calls=await fetchCallActivity(page,ranges.daily,'Daily calls');
      const weeklyCalls=await fetchCallActivity(page,ranges.weekly,'Weekly calls');
      const monthlyCalls=await fetchCallActivity(page,ranges.monthly,'Monthly calls');

      datasets={
        calls,
        weekly_calls:weeklyCalls,
        monthly_calls:monthlyCalls
      };

      console.log('Raw CRM call rows:',{
        calls:calls.length,
        weekly_calls:weeklyCalls.length,
        monthly_calls:monthlyCalls.length
      });
    }else{
      const [
        leads,
        weeklyLeads,
        monthlyLeads,
        opportunities,
        weeklyOpportunities,
        monthlyOpportunities,
        calls,
        weeklyCalls,
        monthlyCalls,
        tickets
      ]=await Promise.all([
        fetchLeadActivity(page,ranges.daily,'Daily leads'),
        fetchLeadActivity(page,ranges.weekly,'Weekly leads'),
        fetchLeadActivity(page,ranges.monthly,'Monthly leads'),
        fetchOpportunityActivity(page,ranges.daily,'Daily opportunities'),
        fetchOpportunityActivity(page,ranges.weekly,'Weekly opportunities'),
        fetchOpportunityActivity(page,ranges.monthly,'Monthly opportunities'),
        fetchCallActivity(page,ranges.daily,'Daily calls'),
        fetchCallActivity(page,ranges.weekly,'Weekly calls'),
        fetchCallActivity(page,ranges.monthly,'Monthly calls'),
        fetchDailyTickets(page,range)
      ]);

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

      console.log('Raw CRM rows:',Object.fromEntries(
        Object.entries(datasets).map(([k,v])=>[k,v.length])
      ));
    }

    const result=await upload(datasets,range);
    const raw=Object.fromEntries(
      Object.entries(datasets).map(([k,v])=>[k,v.length])
    );

    const status={
      status:'success',
      scope:syncScope,
      startedAt,
      finishedAt:new Date().toISOString(),
      ranges,
      raw,
      stored:result.counts
    };

    fs.writeFileSync(
      path.join(runtimeDir,'last-activity-sync.json'),
      JSON.stringify(status,null,2),
      'utf8'
    );

    console.log('');
    console.log('=== CRM ACTIVITY SYNC SUCCESS ===');
    console.log('Stored rows:',result.counts);
  }catch(error){
    fs.writeFileSync(
      path.join(runtimeDir,'last-activity-sync.json'),
      JSON.stringify({
        status:'failed',
        scope:syncScope,
        startedAt,
        finishedAt:new Date().toISOString(),
        ranges,
        error:String(error?.message||error)
      },null,2),
      'utf8'
    );
    console.error('CRM activity sync failed:',error.message);
    process.exitCode=1;
  }finally{
    await context.close();
  }
})();
