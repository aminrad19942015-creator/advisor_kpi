import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { getMeta, getTeamSummary, getTeamFilterOptions, getOpenFilterOptions, getOpenSummary, getOpenNearDeadlineDetails, getOpenExportRows } from './dashboard.ts';
import { getFilteredPeriodSummary, getActivityDetails, getPeriodKpiDetails, getDimensionDetails, getRepeatedCallDetails, getAdvisorTrend, getPeriodCampaignOptions, getLeadStatusKpiDetails, getPeriodExportChunk } from './period.ts';
import { getDashboardBootstrap, getDashboardInitialPayload } from './bootstrap.ts';
import { getOpenLeadDetails } from './open-detail.ts';
import { tursoBatch, tursoSelect } from './turso.ts';

type Handler=(args:any[])=>Promise<any>;

async function hashText(value:string){
  const bytes=new TextEncoder().encode(value);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(digest).map(x=>x.toString(16).padStart(2,'0')).join('');
}

async function versionValue(keys:string[]){
  const placeholders=keys.map(()=>'?').join(',');
  const rows=await tursoSelect(
    `SELECT key,value FROM dashboard_meta WHERE key IN (${placeholders})`,
    keys
  );
  const map=Object.fromEntries(rows.map((r:any)=>[String(r.key),String(r.value||'')]));
  return keys.map(k=>map[k]||'').join('|');
}

async function persistentCached(cacheKey:string,sourceVersion:string,ttlSeconds:number,compute:()=>Promise<any>){
  const hit=await tursoSelect(
    `SELECT payload FROM private.dashboard_rpc_cache
     WHERE cache_key=? AND source_version=? AND expires_at>now()
     LIMIT 1`,
    [cacheKey,sourceVersion]
  ).catch(()=>[]);

  if(hit?.length){
    return {value:hit[0].payload,cache:'postgres-hit'};
  }

  const value=await compute();
  const expiresAt=new Date(Date.now()+ttlSeconds*1000).toISOString();

  await tursoBatch([{
    sql:`INSERT INTO private.dashboard_rpc_cache(cache_key,payload,source_version,created_at,expires_at)
         VALUES(?,?::jsonb,?,now(),?::timestamptz)
         ON CONFLICT(cache_key) DO UPDATE SET
           payload=excluded.payload,
           source_version=excluded.source_version,
           created_at=excluded.created_at,
           expires_at=excluded.expires_at`,
    args:[cacheKey,JSON.stringify(value),sourceVersion,expiresAt]
  }]).catch(()=>{});

  // Opportunistic bounded cleanup; it is never on the critical correctness path.
  tursoBatch([{sql:`DELETE FROM private.dashboard_rpc_cache WHERE expires_at<now()-interval '1 day'`}]).catch(()=>{});

  return {value,cache:'postgres-miss'};
}

function periodFiltersAreInitial(filters:any){
  for(const value of Object.values(filters||{})){
    if(Array.isArray(value) && value.filter(Boolean).length)return false;
    if(!Array.isArray(value) && value!==null && value!==undefined && String(value).trim()!=='')return false;
  }
  return true;
}

async function cachedInitialPayload(openFilters:any){
  const sourceVersion=await versionValue(['data_version','crm_shadow_last_sync_at']);
  const hash=(await hashText(stable(openFilters||{}))).slice(0,24);
  const cached=await persistentCached(
    'dashboard-initial:'+hash,
    sourceVersion,
    300,
    ()=>getDashboardInitialPayload(openFilters||{})
  );
  return cached.value;
}

async function cachedPeriodInitial(period:string,filters:any){
  const compute=async ()=>{
    const [campaignOptions,summary]=await Promise.all([
      getPeriodCampaignOptions(period),
      getFilteredPeriodSummary(period,filters||{})
    ]);
    return {campaignOptions,summary};
  };

  if(!periodFiltersAreInitial(filters))return compute();

  const sourceVersion=await versionValue(['data_version','crm_activity_last_sync_at']);
  const cached=await persistentCached(
    'period-initial:'+String(period||''),
    sourceVersion,
    43200,
    compute
  );
  return cached.value;
}

const handlers:Record<string,Handler>={
  getDashboardBootstrap: async ()=>getDashboardBootstrap(),
  getDashboardInitialPayload: async ([openFilters])=>cachedInitialPayload(openFilters||{}),
  getPeriodInitialPayload: async ([period,filters])=>cachedPeriodInitial(String(period||''),filters||{}),
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
  getExportChunk: async ([tab,dataset,filters,offset,limit])=>{
    const t=String(tab||'');
    if(t==='open'){
      if(Number(offset||0)>0)return [];
      return getOpenExportRows(filters||{});
    }
    if(['daily','weekly','monthly'].includes(t)){
      return getPeriodExportChunk(t,String(dataset||''),filters||{},Number(offset||0),Number(limit||10000));
    }
    throw new Error('تب خروجی نامعتبر است.');
  },
};

const responseCache=new Map<string,{expires:number,value:any}>();

function stable(value:any):string{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}

function ttlFor(method:string){
  // Heavy initial payloads use Postgres-backed versioned cache instead.
  if(method==='getDashboardBootstrap')return 15000;
  if(method==='getTeamFilterOptions'||method==='getOpenFilterOptions')return 60000;
  if(method==='getFilteredPeriodSummary')return 8000;
  if(method==='getDashboardMeta')return 10000;
  return 0;
}

async function bridgeTokenOk(req:Request){
  const expected=String(Deno.env.get('DASHBOARD_RPC_TOKEN')||'');
  if(!expected)return true;

  const supplied=String(req.headers.get('x-dashboard-token')||'');
  if(!supplied)return false;

  const enc=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',enc.encode(expected)),
    crypto.subtle.digest('SHA-256',enc.encode(supplied))
  ]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);
  if(aa.length!==bb.length)return false;
  let diff=0;
  for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];
  return diff===0;
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
      version:5,
      methods:Object.keys(handlers).length
    },200,requestId);
  }

  if(req.method!=='POST')return json({ok:false,error:'Method not allowed.'},405,requestId);

  if(!(await bridgeTokenOk(req))){
    return json({ok:false,error:'Unauthorized dashboard bridge.'},401,requestId);
  }

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
