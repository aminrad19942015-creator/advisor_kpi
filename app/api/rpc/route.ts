import { NextRequest, NextResponse } from 'next/server';
import { getMeta, getTeamSummary, getTeamFilterOptions, getOpenFilterOptions, getOpenSummary, getOpenNearDeadlineDetails, getOpenExportRows } from '../../../lib/dashboard';
import { getFilteredPeriodSummary, getActivityDetails, getPeriodKpiDetails, getDimensionDetails, getRepeatedCallDetails, getAdvisorTrend, getPeriodCampaignOptions, getLeadStatusKpiDetails, getPeriodExportChunk } from '../../../lib/period';
import { getDashboardBootstrap } from '../../../lib/bootstrap';
import { getOpenLeadDetails } from '../../../lib/open-detail';
import { tursoSelect } from '../../../lib/turso';
import { assertDashboardBridgeToken } from '../../../lib/bridge-auth';
import { buildInitialPeriods } from '../../../lib/initial-periods';
import {getInteractiveData,getDashboardRevision} from '../../../lib/report-facts';

export const runtime='nodejs';
export const dynamic='force-dynamic';

async function dashboardDiagnostics(){
 const [metaRows,countRows,stagingRows]=await Promise.all([
  tursoSelect("SELECT key,value FROM dashboard_meta WHERE key LIKE 'data_%' OR key LIKE 'last_%' OR key LIKE 'crm_%'").catch(()=>[]),
  tursoSelect(`SELECT
   (SELECT COUNT(*) FROM team_members) AS team_members,
   (SELECT COUNT(*) FROM open_leads_crm_shadow) AS open_leads,
   (SELECT COUNT(*) FROM daily_leads) AS daily_leads,
   (SELECT COUNT(*) FROM weekly_leads) AS weekly_leads,
   (SELECT COUNT(*) FROM monthly_leads) AS monthly_leads,
   (SELECT COUNT(*) FROM daily_opportunities) AS daily_opportunities,
   (SELECT COUNT(*) FROM weekly_opportunities) AS weekly_opportunities,
   (SELECT COUNT(*) FROM monthly_opportunities) AS monthly_opportunities,
   (SELECT COUNT(*) FROM daily_calls) AS daily_calls,
   (SELECT COUNT(*) FROM weekly_calls) AS weekly_calls,
   (SELECT COUNT(*) FROM monthly_calls) AS monthly_calls,
   (SELECT COUNT(*) FROM daily_tickets) AS daily_tickets,
   (SELECT COUNT(*) FROM weekly_tickets) AS weekly_tickets,
   (SELECT COUNT(*) FROM monthly_tickets) AS monthly_tickets`).catch(()=>[{}]),
  tursoSelect('SELECT COUNT(*) AS chunks,MIN(created_at) AS oldest,MAX(created_at) AS newest FROM crm_daily_activity_chunks').catch(()=>[])
 ]);
 const meta:any=Object.fromEntries(metaRows.map((r:any)=>[String(r.key),String(r.value||'')]));
 const raw:any=countRows[0]||{};
 const counts:any=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,Number(v||0)]));
 const consistency={
  leads:counts.daily_leads<=counts.weekly_leads&&counts.weekly_leads<=counts.monthly_leads,
  opportunities:counts.daily_opportunities<=counts.weekly_opportunities&&counts.weekly_opportunities<=counts.monthly_opportunities,
  calls:counts.daily_calls<=counts.weekly_calls&&counts.weekly_calls<=counts.monthly_calls,
  tickets:counts.daily_tickets<=counts.weekly_tickets&&counts.weekly_tickets<=counts.monthly_tickets
 };
 let activityCounts:any={};try{activityCounts=JSON.parse(meta.crm_activity_counts||'{}')}catch{}
 return {ok:counts.team_members>0&&counts.open_leads>0&&Object.values(consistency).every(Boolean),provider:'PostgreSQL',checkedAt:new Date().toISOString(),meta:{dataVersion:meta.data_version||'',lastSyncAt:meta.last_sync_at||'',openLastSyncAt:meta.crm_shadow_last_sync_at||'',activityLastSyncAt:meta.crm_activity_last_sync_at||'',activityRange:{start:meta.crm_activity_range_start||'',end:meta.crm_activity_range_end||''},activityCounts},counts,consistency,staging:{chunks:Number(stagingRows[0]?.chunks||0),oldest:stagingRows[0]?.oldest||null,newest:stagingRows[0]?.newest||null}};
}

async function exportChunk(tab:string,dataset:string,filters:any,offset:number,limit:number){
 if(tab==='open') return getOpenExportRows(filters||{},offset,limit);
 if(!['daily','weekly','monthly','reportMonth'].includes(tab)) throw new Error('تب خروجی نامعتبر است.');
 return getPeriodExportChunk(tab,dataset,filters,offset,limit);
}

const detailMethods:Record<string,{arity:number,fn:Function}>={
 getActivityDetails:{arity:4,fn:getActivityDetails},getPeriodKpiDetails:{arity:3,fn:getPeriodKpiDetails},getLeadStatusKpiDetails:{arity:3,fn:getLeadStatusKpiDetails},
 getDimensionDetails:{arity:5,fn:getDimensionDetails},getRepeatedCallDetails:{arity:2,fn:getRepeatedCallDetails},getOpenLeadDetails:{arity:3,fn:getOpenLeadDetails},getOpenNearDeadlineDetails:{arity:3,fn:getOpenNearDeadlineDetails}
};
async function detailPage(method:string,args:any[],offset:any,limit:any,expectedRevision:string){
 const definition=detailMethods[method];if(!definition||!Array.isArray(args)||args.length>definition.arity)throw new Error('Invalid detail request');
 const revision=await getDashboardRevision();if(expectedRevision&&expectedRevision!==revision)return {stale:true,rows:[],hasMore:false,revision};
 if(Number(offset)>200000)throw new Error('Detail page offset exceeds the supported range.');
 const page={offset:Math.max(0,Math.floor(Number(offset))||0),limit:Math.max(1,Math.min(200,Math.floor(Number(limit))||100))};
 const parameters=args.slice();while(parameters.length<definition.arity)parameters.push(undefined);
 const rows=await definition.fn(...parameters,page);
 if(revision!==await getDashboardRevision())return {stale:true,rows:[],hasMore:false,revision:await getDashboardRevision()};
 return {rows:rows.slice(0,page.limit),hasMore:rows.length>page.limit,nextOffset:page.offset+page.limit,revision};
}

async function periodInitialPayload(period:string,filters:any={}){
 const [campaignOptions,summary,meta]=await Promise.all([
  getPeriodCampaignOptions(period),getFilteredPeriodSummary(period,filters),getMeta()
 ]);
 return {campaignOptions,summary,meta};
}

const handlers:Record<string,(args:any[])=>Promise<any>>={
 getDetailWarmupPages:async()=>{
  const revision=await getDashboardRevision(),pages:Record<string,any>={};
  for(const period of ['daily','weekly','monthly','reportMonth']){
   for(const type of ['closed','talked','oppLead','opp','calls','aml','t8','tickets','noStatus','noResponse']){
    const rows=await (['noStatus','noResponse'].includes(type)?getLeadStatusKpiDetails(period,type,{}, {offset:0,limit:100}):getPeriodKpiDetails(period,type,{}, {offset:0,limit:100}));
    pages[period+'|'+type]={rows:rows.slice(0,100),hasMore:rows.length>100,nextOffset:100,revision};
   }
  }
  if(revision!==await getDashboardRevision())throw new Error('Detail data changed; retry.');
  return {revision,pages};
 },
 getDetailPage: async([method,args,offset,limit,revision])=>detailPage(String(method),args,offset,limit,String(revision||'')),
 getDashboardRevision: async()=>getDashboardRevision(),
 getInteractiveDashboardPayload: async([openFilters])=>{
  const before=await getDashboardRevision();
  const [base,interactive]=await Promise.all([handlers.getDashboardInitialPayload([openFilters]),getInteractiveData()]);
  if(before!==interactive.revision||before!==await getDashboardRevision())throw new Error('Snapshot changed; retry.');
  return {...base,interactive};
 },
 getDashboardBootstrap: async ()=>getDashboardBootstrap(),
 getDashboardInitialPayload: async ([openFilters])=>{
  const started=Date.now();
  const [meta,team,teamFilters,openFiltersOptions,open,periods]=await Promise.all([
   getMeta(),getTeamSummary({}),getTeamFilterOptions(),getOpenFilterOptions(),getOpenSummary(openFilters||{}),
   buildInitialPeriods(period=>periodInitialPayload(period))
  ]);
  return {meta:{...meta,durationSeconds:Math.round((Date.now()-started)/100)/10},team,open,teamFilters,openFilters:openFiltersOptions,periods,daily:null,weekly:null,monthly:null};
 },
 getPeriodInitialPayload: async ([period,filters])=>periodInitialPayload(String(period||''),filters||{}),
 getTeamFilteredSummary: async ([filters])=>getTeamSummary(filters||{}),
 getTeamFilterOptions: async ()=>getTeamFilterOptions(),
 getOpenFilteredSummary: async ([filters])=>getOpenSummary(filters||{}),
 getOpenFilterOptions: async ()=>getOpenFilterOptions(),
 getOpenLeadDetails: async ([field,value,filters])=>getOpenLeadDetails(field,value,filters||{}),
 getOpenNearDeadlineDetails: async ([leadType,owner,filters])=>getOpenNearDeadlineDetails(leadType,owner||'',filters||{}),
 getFilteredPeriodSummary: async ([period,filters])=>getFilteredPeriodSummary(period,filters||{}),
 getPeriodCampaignOptions: async ([period])=>getPeriodCampaignOptions(period),
 getActivityDetails: async ([period,type,user,filters])=>getActivityDetails(period,type,user,filters||{}),
 getPeriodKpiDetails: async ([period,type,filters])=>getPeriodKpiDetails(period,type,filters||{}),
 getLeadStatusKpiDetails: async ([period,type,filters])=>getLeadStatusKpiDetails(period,type,filters||{}),
 getDimensionDetails: async ([period,source,field,value,filters])=>getDimensionDetails(period,source,field,value,filters||{}),
 getRepeatedCallDetails: async ([period,filters])=>getRepeatedCallDetails(period,filters||{}),
 getAdvisorTrend: async ([period,advisor])=>getAdvisorTrend(period,advisor),
 getDashboardMeta: async ()=>getMeta(),
 getDashboardDiagnostics: async ()=>dashboardDiagnostics(),
 getExportChunk: async ([tab,dataset,filters,offset,limit])=>exportChunk(String(tab||''),String(dataset||''),filters||{},Math.max(0,Number(offset||0)),Math.max(1,Math.min(10000,Number(limit||10000)))),
};

export async function POST(req:NextRequest){
 try{
  assertDashboardBridgeToken(req.headers.get('x-dashboard-token'));
  const body=await req.json();
  const method=String(body?.method||'');
  const fn=handlers[method];
  if(!fn)return NextResponse.json({ok:false,error:`RPC method not migrated yet: ${method}`},{status:501});
  const started=Date.now();
  console.log('[rpc:start]',method);
  const result=await Promise.race([
    fn(Array.isArray(body?.args)?body.args:[]),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('RPC timeout: '+method)),15000))
  ]);
  console.log('[rpc:end]',method,Date.now()-started);
  return NextResponse.json({ok:true,result},{headers:{'cache-control':'no-store'}});
 }catch(error:any){
  return NextResponse.json({ok:false,error:error?.message||String(error)},{status:500});
 }
}
