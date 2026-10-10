import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { tursoBatch, tursoSelect } from './turso.ts';
import { getCrmAdminConfig, saveCrmAdminConfig, validateCrmAdminConfig } from './crm-config.ts';

const TEAM_FIELDS=['name','personnel_code','email','team_lead','senior_lead','team','gender','role','business_unit'];

async function hashText(value:string){
  const bytes=new TextEncoder().encode(value);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(digest).map(x=>x.toString(16).padStart(2,'0')).join('');
}

async function bridgeTokenOk(req:Request){
  const supplied=String(req.headers.get('x-dashboard-token')||'');
  if(!supplied)return false;
  const rows=await tursoSelect(
    "SELECT token_sha256 FROM private.dashboard_rpc_auth WHERE id='gas-bridge' LIMIT 1"
  ).catch(()=>[]);
  const expected=String(rows?.[0]?.token_sha256||'');
  if(!expected)return false;
  const got=await hashText(supplied);
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',enc.encode(expected)),
    crypto.subtle.digest('SHA-256',enc.encode(got))
  ]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);
  if(aa.length!==bb.length)return false;
  let diff=0;
  for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];
  return diff===0;
}

function json(body:any,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
  });
}

function cleanMember(input:any){
  const out:any={};
  for(const f of TEAM_FIELDS)out[f]=String(input?.[f]??'').trim();
  if(!out.name)throw new Error('نام و نام خانوادگی الزامی است.');
  if(!out.personnel_code)throw new Error('کد پرسنلی الزامی است.');
  return out;
}

async function touchAdminRevision(){
  const now=new Date().toISOString();
  await tursoBatch([{
    sql:"INSERT INTO dashboard_meta(key,value) VALUES('admin_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    args:[now]
  }]);
  return now;
}

async function getOverview(){
  const tables=[
    'team_members','open_leads_crm_shadow',
    'daily_leads','weekly_leads','monthly_leads',
    'daily_opportunities','weekly_opportunities','monthly_opportunities',
    'daily_calls','weekly_calls','monthly_calls',
    'daily_tickets','weekly_tickets','monthly_tickets'
  ];
  const [sets,meta,commands]=await Promise.all([
    tursoBatch(tables.map(t=>({sql:`SELECT COUNT(*) count FROM "${t}"`}))),
    tursoSelect("SELECT key,value FROM dashboard_meta WHERE key LIKE 'crm_%' OR key IN ('data_version','admin_revision')"),
    tursoSelect("SELECT id,command,status,created_at,started_at,completed_at,result FROM connector_commands ORDER BY id DESC LIMIT 10").catch(()=>[])
  ]);
  const counts=Object.fromEntries(tables.map((t,i)=>[t,Number(sets[i]?.[0]?.count||0)]));
  const m=Object.fromEntries(meta.map((r:any)=>[String(r.key),String(r.value||'')]));
  const consistency={
    leads:counts.daily_leads<=counts.weekly_leads&&counts.weekly_leads<=counts.monthly_leads,
    opportunities:counts.daily_opportunities<=counts.weekly_opportunities&&counts.weekly_opportunities<=counts.monthly_opportunities,
    calls:counts.daily_calls<=counts.weekly_calls&&counts.weekly_calls<=counts.monthly_calls,
    tickets:counts.daily_tickets<=counts.weekly_tickets&&counts.weekly_tickets<=counts.monthly_tickets
  };
  return {counts,meta:m,consistency,commands,checkedAt:new Date().toISOString()};
}

async function listTeamMembers(){
  return tursoSelect(`
    SELECT name,personnel_code,email,team_lead,senior_lead,team,gender,role,business_unit
    FROM team_members ORDER BY name
  `);
}

async function addTeamMember(input:any){
  const m=cleanMember(input);
  await tursoBatch([{
    sql:`INSERT INTO team_members(name,personnel_code,email,team_lead,senior_lead,team,gender,role,business_unit)
         VALUES(?,?,?,?,?,?,?,?,?)`,
    args:TEAM_FIELDS.map(f=>m[f])
  }]);
  await touchAdminRevision();
  return {ok:true};
}

async function updateTeamMembers(input:any){
  const rows=Array.isArray(input)?input:[];
  if(!rows.length)return {updated:0};
  const tx:any[]=[{sql:'BEGIN IMMEDIATE'}];
  for(const row of rows){
    const original=String(row?.original_personnel_code||'').trim();
    if(!original)throw new Error('کد پرسنلی رکورد اصلی مشخص نیست.');
    const m=cleanMember(row);
    tx.push({
      sql:`UPDATE team_members
           SET name=?,personnel_code=?,email=?,team_lead=?,senior_lead=?,team=?,gender=?,role=?,business_unit=?
           WHERE personnel_code=?`,
      args:[...TEAM_FIELDS.map(f=>m[f]),original]
    });
  }
  tx.push({sql:"INSERT INTO dashboard_meta(key,value) VALUES('admin_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[new Date().toISOString()]});
  tx.push({sql:'COMMIT'});
  await tursoBatch(tx);
  return {updated:rows.length};
}

async function deleteTeamMember(code:any){
  const value=String(code||'').trim();
  if(!value)throw new Error('کد پرسنلی الزامی است.');
  await tursoBatch([
    {sql:'BEGIN IMMEDIATE'},
    {sql:'DELETE FROM team_members WHERE personnel_code=?',args:[value]},
    {sql:"INSERT INTO dashboard_meta(key,value) VALUES('admin_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[new Date().toISOString()]},
    {sql:'COMMIT'}
  ]);
  return {ok:true};
}

async function saveConfig(incoming:any){
  const current:any=await getCrmAdminConfig();
  const protectedConfig={
    ...(incoming||{}),
    crmOrigin:current.crmOrigin,
    apiVersion:current.apiVersion,
    schedules:current.schedules,
    openLeads:{...(incoming?.openLeads||{}),entity:current.openLeads.entity},
    lead:{...(incoming?.lead||{}),entity:current.lead.entity,dateField:current.lead.dateField},
    opportunity:{...(incoming?.opportunity||{}),entity:current.opportunity.entity,dateField:current.opportunity.dateField,businessUnitSource:current.opportunity.businessUnitSource},
    calls:{...(incoming?.calls||{}),entity:current.calls.entity,dateField:current.calls.dateField,businessUnitSource:current.calls.businessUnitSource},
    ticket:{...(incoming?.ticket||{}),queueEntity:current.ticket.queueEntity,caseEntity:current.ticket.caseEntity,dateField:current.ticket.dateField}
  };
  const config=validateCrmAdminConfig(protectedConfig);
  const saved=await saveCrmAdminConfig(config);
  await touchAdminRevision();
  return saved;
}

async function requestRecovery(){
  await tursoBatch([{
    sql:"INSERT INTO connector_commands(command,payload,status) VALUES(?,?::jsonb,'pending')",
    args:['restore_local_snapshots',JSON.stringify({scope:'all'})]
  }]);
  return {ok:true,message:'درخواست بازیابی ثبت شد و در اجرای بعدی Connector انجام می‌شود.'};
}

async function runQa(){
  const x=await getOverview();
  const failed=Object.entries(x.consistency).filter(([,ok])=>!ok).map(([k])=>k);
  const ok=x.counts.team_members>0&&x.counts.open_leads_crm_shadow>0&&failed.length===0;
  return {ok,failed,overview:x};
}

const handlers:Record<string,(args:any[])=>Promise<any>>={
  getOverview:async()=>getOverview(),
  listTeamMembers:async()=>listTeamMembers(),
  addTeamMember:async([m])=>addTeamMember(m),
  updateTeamMembers:async([rows])=>updateTeamMembers(rows),
  deleteTeamMember:async([code])=>deleteTeamMember(code),
  getCrmConfig:async()=>getCrmAdminConfig(),
  saveCrmConfig:async([config])=>saveConfig(config),
  requestRecovery:async()=>requestRecovery(),
  runQa:async()=>runQa()
};

Deno.serve(async(req:Request)=>{
  if(req.method==='GET')return json({ok:true,service:'admin-rpc',version:1});
  if(req.method!=='POST')return json({ok:false,error:'Method not allowed.'},405);
  if(!(await bridgeTokenOk(req)))return json({ok:false,error:'Unauthorized admin bridge.'},401);
  try{
    const body=await req.json();
    const method=String(body?.method||'');
    const fn=handlers[method];
    if(!fn)return json({ok:false,error:'Unknown admin method.'},404);
    const result=await fn(Array.isArray(body?.args)?body.args:[]);
    return json({ok:true,result});
  }catch(e:any){
    console.error('[admin-rpc]',e);
    const msg=String(e?.message||e);
    return json({ok:false,error:msg.includes('unique')?'کد پرسنلی تکراری است.':msg},400);
  }
});
