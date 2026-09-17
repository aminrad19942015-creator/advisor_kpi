import { NextRequest, NextResponse } from 'next/server';
import { getMeta, getTeamSummary, getTeamFilterOptions, getOpenFilterOptions, getOpenNearDeadlineDetails } from '../../../lib/dashboard';

export const runtime='nodejs';

const handlers:Record<string,(args:any[])=>Promise<any>>={
 getTeamFilteredSummary: async ([filters])=>getTeamSummary(filters||{}),
 getTeamFilterOptions: async ()=>getTeamFilterOptions(),
 getOpenFilterOptions: async ()=>getOpenFilterOptions(),
 getOpenNearDeadlineDetails: async ([leadType,owner,filters])=>getOpenNearDeadlineDetails(leadType,owner||'',filters||{}),
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
