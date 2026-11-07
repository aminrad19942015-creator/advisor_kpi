import { NextRequest,NextResponse } from 'next/server';
import { assertDashboardBridgeToken } from '../../../lib/bridge-auth';
import { tursoBatch,tursoSelect } from '../../../lib/turso';
import { getCrmAdminConfig,saveCrmAdminConfig,validateCrmAdminConfig } from '../../../lib/crm-config';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const TEAM_FIELDS=['name','personnel_code','email','team_lead','senior_lead','team','gender','role','business_unit'];
function cleanMember(input:any){
 const out:any={};
 for(const f of TEAM_FIELDS) out[f]=String(input?.[f]??'').trim();
 if(!out.name) throw new Error('نام و نام خانوادگی الزامی است.');
 if(!out.personnel_code) throw new Error('کد پرسنلی الزامی است.');
 return out;
}
async function touchAdminRevision(){
 const now=new Date().toISOString();
 await tursoBatch([{sql:"INSERT INTO dashboard_meta(key,value) VALUES('admin_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[now]}]);
 return now;
}
async function getOverview(){
 const tables=['team_members','open_leads_crm_shadow','daily_leads','weekly_leads','monthly_leads','daily_opportunities','weekly_opportunities','monthly_opportunities','daily_calls','weekly_calls','monthly_calls','daily_tickets','weekly_tickets','monthly_tickets'];
 const [sets,meta,commands]=await Promise.all([
  tursoBatch(tables.map(t=>({sql:`SELECT COUNT(*) count FROM "${t}"` }))),
  tursoSelect("SELECT key,value FROM dashboard_meta WHERE key LIKE 'crm_%' OR key IN ('data_version','admin_revision')"),
  tursoSelect("SELECT id,command,status,created_at,started_at,completed_at,result FROM connector_commands ORDER BY id DESC LIMIT 10").catch(()=>[])
 ]);
 const counts=Object.fromEntries(tables.map((t,i)=>[t,Number(sets[i]?.[0]?.count||0)]));
 const m=Object.fromEntries(meta.map((r:any)=>[String(r.key),String(r.value||'')]));
 const consistency={leads:counts.daily_leads<=counts.weekly_leads&&counts.weekly_leads<=counts.monthly_leads,opportunities:counts.daily_opportunities<=counts.weekly_opportunities&&counts.weekly_opportunities<=counts.monthly_opportunities,calls:counts.daily_calls<=counts.weekly_calls&&counts.weekly_calls<=counts.monthly_calls,tickets:counts.daily_tickets<=counts.weekly_tickets&&counts.weekly_tickets<=counts.monthly_tickets};
 return {counts,meta:m,consistency,commands,checkedAt:new Date().toISOString()};
}
async function listTeamMembers(){return tursoSelect('SELECT name,personnel_code,email,team_lead,senior_lead,team,gender,role,business_unit FROM team_members ORDER BY name');}
async function addTeamMember(input:any){const m=cleanMember(input);await tursoBatch([{sql:`INSERT INTO team_members(name,personnel_code,email,team_lead,senior_lead,team,gender,role,business_unit) VALUES(?,?,?,?,?,?,?,?,?)`,args:TEAM_FIELDS.map(f=>m[f])}]);await touchAdminRevision();return {ok:true};}
async function updateTeamMembers(input:any){
 const rows=Array.isArray(input)?input:[]; if(!rows.length)return {updated:0};
 const tx:any[]=[{sql:'BEGIN'}];
 for(const row of rows){const original=String(row?.original_personnel_code||'').trim();if(!original)throw new Error('کد پرسنلی رکورد اصلی مشخص نیست.');const m=cleanMember(row);tx.push({sql:`UPDATE team_members SET name=?,personnel_code=?,email=?,team_lead=?,senior_lead=?,team=?,gender=?,role=?,business_unit=? WHERE personnel_code=?`,args:[...TEAM_FIELDS.map(f=>m[f]),original]});}
 tx.push({sql:"INSERT INTO dashboard_meta(key,value) VALUES('admin_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[new Date().toISOString()]}),tx.push({sql:'COMMIT'});await tursoBatch(tx);return {updated:rows.length};
}
async function deleteTeamMember(code:any){const value=String(code||'').trim();if(!value)throw new Error('کد پرسنلی الزامی است.');await tursoBatch([{sql:'BEGIN'},{sql:'DELETE FROM team_members WHERE personnel_code=?',args:[value]},{sql:"INSERT INTO dashboard_meta(key,value) VALUES('admin_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[new Date().toISOString()]},{sql:'COMMIT'}]);return {ok:true};}
async function saveConfig(incoming:any){
 const current:any=await getCrmAdminConfig();
 const protectedConfig={...(incoming||{}),crmOrigin:current.crmOrigin,apiVersion:current.apiVersion,schedules:current.schedules,openLeads:{...(incoming?.openLeads||{}),entity:current.openLeads.entity},lead:{...(incoming?.lead||{}),entity:current.lead.entity,dateField:current.lead.dateField},opportunity:{...(incoming?.opportunity||{}),entity:current.opportunity.entity,dateField:current.opportunity.dateField,businessUnitSource:current.opportunity.businessUnitSource},calls:{...(incoming?.calls||{}),entity:current.calls.entity,dateField:current.calls.dateField,businessUnitSource:current.calls.businessUnitSource},ticket:{...(incoming?.ticket||{}),queueEntity:current.ticket.queueEntity,caseEntity:current.ticket.caseEntity,dateField:current.ticket.dateField}};
 const saved=await saveCrmAdminConfig(validateCrmAdminConfig(protectedConfig));await touchAdminRevision();return saved;
}
const handlers:Record<string,(args:any[])=>Promise<any>>={
 getOverview:async()=>getOverview(),listTeamMembers:async()=>listTeamMembers(),addTeamMember:async([m])=>addTeamMember(m),updateTeamMembers:async([rows])=>updateTeamMembers(rows),deleteTeamMember:async([code])=>deleteTeamMember(code),getCrmConfig:async()=>getCrmAdminConfig(),saveCrmConfig:async([config])=>saveConfig(config),requestRecovery:async()=>{await tursoBatch([{sql:"INSERT INTO connector_commands(command,payload,status) VALUES(?,?::jsonb,'pending')",args:['restore_local_snapshots',JSON.stringify({scope:'all'})]}]);return {ok:true,message:'درخواست بازیابی ثبت شد و در اجرای بعدی Connector انجام می‌شود.'};},runQa:async()=>{const overview=await getOverview();const failed=Object.entries(overview.consistency).filter(([,ok])=>!ok).map(([k])=>k);return {ok:overview.counts.team_members>0&&overview.counts.open_leads_crm_shadow>0&&failed.length===0,failed,overview};}
};
export async function GET(){return NextResponse.json({ok:true,service:'admin-rpc',provider:'PostgreSQL',version:1});}
export async function POST(req:NextRequest){
 try{assertDashboardBridgeToken(req.headers.get('x-dashboard-token'));const body=await req.json();const fn=handlers[String(body?.method||'')];if(!fn)return NextResponse.json({ok:false,error:'Unknown admin method.'},{status:404});return NextResponse.json({ok:true,result:await fn(Array.isArray(body?.args)?body.args:[])},{headers:{'cache-control':'no-store'}});}
 catch(e:any){const status=Number(e?.status)||400;const msg=String(e?.message||e);return NextResponse.json({ok:false,error:msg.includes('unique')?'کد پرسنلی تکراری است.':msg},{status});}
}
