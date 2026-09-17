import { NextRequest, NextResponse } from 'next/server';
import { getMeta, getTeamSummary, getTeamFilterOptions, getOpenFilterOptions, getOpenSummary, getOpenNearDeadlineDetails } from '../../../lib/dashboard';
import { getFilteredPeriodSummary, getActivityDetails, getDimensionDetails, getRepeatedCallDetails, getAdvisorTrend } from '../../../lib/period';
import { getOpenLeadDetails } from '../../../lib/open-details';
import { getDashboardBootstrap } from '../../../lib/bootstrap';

export const runtime='nodejs';

const handlers:Record<string,(args:any[])=>Promise<any>>={
 getDashboardBootstrap: async ()=>getDashboardBootstrap(),
 getTeamFilteredSummary: async ([filters])=>getTeamSummary(filters||{}),
 getTeamFilterOptions: async ()=>getTeamFilterOptions(),
 getOpenFilteredSummary: async ([filters])=>getOpenSummary(filters||{}),
 getOpenFilterOptions: async ()=>getOpenFilterOptions(),
 getOpenLeadDetails: async ([field,value])=>getOpenLeadDetails(field,value),
 getOpenNearDeadlineDetails: async ([leadType,owner,filters])=>getOpenNearDeadlineDetails(leadType,owner||'',filters||{}),
 getFilteredPeriodSummary: async ([period,filters])=>getFilteredPeriodSummary(period,filters||{}),
 getActivityDetails: async ([period,type,user])=>getActivityDetails(period,type,user),
 getDimensionDetails: async ([period,source,field,value])=>getDimensionDetails(period,source,field,value),
 getRepeatedCallDetails: async ([period])=>getRepeatedCallDetails(period),
 getAdvisorTrend: async ([period,advisor])=>getAdvisorTrend(period,advisor),
 getDashboardMeta: async ()=>getMeta(),
};

export async function POST(req:NextRequest){
 try{
  const body=await req.json();
  const method=String(body?.method||'');
  const fn=handlers[method];
  if(!fn)return NextResponse.json({ok:false,error:`RPC method not migrated yet: ${method}`},{status:501});
  const result=await fn(Array.isArray(body?.args)?body.args:[]);
  return NextResponse.json({ok:true,result},{headers:{'cache-control':'no-store'}});
 }catch(error:any){
  return NextResponse.json({ok:false,error:error?.message||String(error)},{status:500});
 }
}
