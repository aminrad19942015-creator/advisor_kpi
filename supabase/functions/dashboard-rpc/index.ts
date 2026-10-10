import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { getMeta, getTeamSummary, getTeamFilterOptions, getOpenFilterOptions, getOpenSummary, getOpenNearDeadlineDetails } from './dashboard.ts';
import { getFilteredPeriodSummary, getActivityDetails, getPeriodKpiDetails, getDimensionDetails, getRepeatedCallDetails, getAdvisorTrend, getPeriodCampaignOptions, getLeadStatusKpiDetails } from './period.ts';
import { getDashboardBootstrap, getDashboardInitialPayload } from './bootstrap.ts';
import { getOpenLeadDetails } from './open-detail.ts';

type Handler=(args:any[])=>Promise<any>;

const handlers:Record<string,Handler>={
  getDashboardBootstrap: async ()=>getDashboardBootstrap(),
  getDashboardInitialPayload: async ([openFilters])=>getDashboardInitialPayload(openFilters||{}),
  getPeriodInitialPayload: async ([period,filters])=>{
    const [campaignOptions,summary]=await Promise.all([
      getPeriodCampaignOptions(period),
      getFilteredPeriodSummary(period,filters||{})
    ]);
    return {campaignOptions,summary};
  },
  getTeamFilteredSummary: async ([filters])=>getTeamSummary(filters||{}),
  getTeamFilterOptions: async ()=>getTeamFilterOptions(),
  getOpenFilteredSummary: async ([filters])=>getOpenSummary(filters||{}),
  getOpenFilterOptions: async ()=>getOpenFilterOptions(),
  getOpenLeadDetails: async ([field,value])=>getOpenLeadDetails(field,value),
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
};

const responseCache=new Map<string,{expires:number,value:any}>();

function stable(value:any):string{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}

function ttlFor(method:string){
  if(method==='getDashboardInitialPayload'||method==='getDashboardBootstrap')return 30000;
  if(method==='getTeamFilterOptions'||method==='getOpenFilterOptions')return 120000;
  if(method==='getPeriodInitialPayload')return 20000;
  if(method==='getFilteredPeriodSummary')return 12000;
  if(method==='getDashboardMeta')return 20000;
  return 0;
}

function json(body:any,status=200,requestId=''){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
      ...(requestId?{'x-request-id':requestId}:{})
    }
  });
}

Deno.serve(async (req:Request)=>{
  const requestId=req.headers.get('x-request-id')||crypto.randomUUID();

  if(req.method==='GET'){
    return json({
      ok:true,
      service:'dashboard-rpc',
      provider:'Supabase',
      version:2,
      methods:Object.keys(handlers).length
    },200,requestId);
  }

  if(req.method!=='POST')return json({ok:false,error:'Method not allowed.'},405,requestId);

  try{
    const body=await req.json();
    const method=String(body?.method||'');
    const args=Array.isArray(body?.args)?body.args:[];
    const fn=handlers[method];

    if(!fn)return json({ok:false,error:`Unknown dashboard RPC method: ${method}`},404,requestId);

    const ttl=ttlFor(method);
    const cacheKey=ttl?method+':'+stable(args):'';
    const cached=cacheKey?responseCache.get(cacheKey):undefined;
    if(cached&&cached.expires>Date.now()){
      return json({ok:true,result:cached.value,meta:{method,durationMs:0,cache:'edge-hit'}},200,requestId);
    }

    const started=Date.now();
    const result=await Promise.race([
      fn(args),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('RPC timeout: '+method)),28000))
    ]);

    if(cacheKey){
      responseCache.set(cacheKey,{expires:Date.now()+ttl,value:result});
      if(responseCache.size>120){
        const now=Date.now();
        for(const [k,v] of responseCache)if(v.expires<=now)responseCache.delete(k);
        while(responseCache.size>100){
          const firstKey=responseCache.keys().next().value;
          if(firstKey===undefined)break;
          responseCache.delete(firstKey);
        }
      }
    }

    return json({
      ok:true,
      result,
      meta:{method,durationMs:Date.now()-started,cache:'miss'}
    },200,requestId);
  }catch(error:any){
    console.error('[dashboard-rpc]',requestId,error);
    return json({ok:false,error:error?.message||String(error),requestId},500,requestId);
  }
});
