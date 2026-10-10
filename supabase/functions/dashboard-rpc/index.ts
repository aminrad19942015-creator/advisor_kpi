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

async function dashboardDiagnostics(){
  const [metaRows,countRows,stagingRows,cacheRows]=await Promise.all([
    tursoSelect(`
      SELECT key,value
      FROM dashboard_meta
      WHERE key IN (
        'data_version','last_sync_at','crm_shadow_last_sync_at','crm_shadow_row_count',
        'crm_activity_last_sync_at','crm_activity_lead_opp_last_sync_at',
        'crm_activity_calls_last_sync_at','crm_activity_tickets_last_sync_at',
        'crm_activity_counts','crm_activity_range_start','crm_activity_range_end'
      )
    `),
    tursoSelect(`
      SELECT
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
        (SELECT COUNT(*) FROM monthly_tickets) AS monthly_tickets
    `),
    tursoSelect(`
      SELECT COUNT(*) AS chunks,MIN(created_at) AS oldest,MAX(created_at) AS newest
      FROM crm_daily_activity_chunks
    `).catch(()=>[]),
    tursoSelect(`
      SELECT COUNT(*) AS entries,
             SUM(CASE WHEN expires_at<=now() THEN 1 ELSE 0 END) AS expired,
             MIN(created_at) AS oldest,
             MAX(created_at) AS newest
      FROM private.dashboard_rpc_cache
    `).catch(()=>[])
  ]);

  const meta:any=Object.fromEntries((metaRows||[]).map((r:any)=>[String(r.key),String(r.value||'')]));
  const counts:any=countRows?.[0]||{};
  const n=(k:string)=>Number(counts[k]||0);
  const consistency={
    leads:n('daily_leads')<=n('weekly_leads')&&n('weekly_leads')<=n('monthly_leads'),
    opportunities:n('daily_opportunities')<=n('weekly_opportunities')&&n('weekly_opportunities')<=n('monthly_opportunities'),
    calls:n('daily_calls')<=n('weekly_calls')&&n('weekly_calls')<=n('monthly_calls'),
    tickets:n('daily_tickets')<=n('weekly_tickets')&&n('weekly_tickets')<=n('monthly_tickets')
  };

  const componentTimestamps={
    leadOpportunity:meta.crm_activity_lead_opp_last_sync_at||'',
    calls:meta.crm_activity_calls_last_sync_at||'',
    tickets:meta.crm_activity_tickets_last_sync_at||''
  };

  const componentTrackingReady=Object.values(componentTimestamps).every(Boolean);
  const currentActivityCounts=(()=>{
    try{return JSON.parse(meta.crm_activity_counts||'{}')}catch{return {}}
  })();

  return {
    ok:
      n('team_members')>0 &&
      n('open_leads')>0 &&
      Object.values(consistency).every(Boolean),
    provider:'Supabase',
    checkedAt:new Date().toISOString(),
    meta:{
      dataVersion:meta.data_version||'',
      lastSyncAt:meta.last_sync_at||'',
      openLastSyncAt:meta.crm_shadow_last_sync_at||'',
      activityLastSyncAt:meta.crm_activity_last_sync_at||'',
      activityRange:{
        start:meta.crm_activity_range_start||'',
        end:meta.crm_activity_range_end||''
      },
      componentTimestamps,
      componentTrackingReady,
      activityCounts:currentActivityCounts
    },
    counts:Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,Number(v||0)])),
    consistency,
    staging:{
      chunks:Number(stagingRows?.[0]?.chunks||0),
      oldest:stagingRows?.[0]?.oldest||null,
      newest:stagingRows?.[0]?.newest||null
    },
    cache:{
      entries:Number(cacheRows?.[0]?.entries||0),
      expired:Number(cacheRows?.[0]?.expired||0),
      oldest:cacheRows?.[0]?.oldest||null,
      newest:cacheRows?.[0]?.newest||null
    },
    migration:{
      componentTrackingReady,
      note:componentTrackingReady
        ? 'Activity component timestamps are active.'
        : 'Component timestamps will appear after the new serialized morning Connector completes each activity family.'
    }
  };
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
  getDashboardDiagnostics: async ()=>dashboardDiagnostics(),
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

let bridgeTokenHashCache:{value:string,expires:number}|null=null;

async function bridgeTokenOk(req:Request){
  const supplied=String(req.headers.get('x-dashboard-token')||'');
  if(!supplied)return false;

  let expectedHash='';
  const now=Date.now();

  if(bridgeTokenHashCache&&bridgeTokenHashCache.expires>now){
    expectedHash=bridgeTokenHashCache.value;
  }else{
    const rows=await tursoSelect(
      "SELECT token_sha256 FROM private.dashboard_rpc_auth WHERE id='gas-bridge' LIMIT 1"
    ).catch(()=>[]);
    expectedHash=String(rows?.[0]?.token_sha256||'');
    if(expectedHash){
      bridgeTokenHashCache={value:expectedHash,expires:now+300000};
    }
  }

  if(!expectedHash)return false;
  const suppliedHash=await hashText(supplied);

  const enc=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',enc.encode(expectedHash)),
    crypto.subtle.digest('SHA-256',enc.encode(suppliedHash))
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
      version:8,
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
