import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  appendCrmShadowChunk,
  compareCrmShadowToProduction,
  finalizeCrmShadowBatch,
  getCrmShadowStatus,
  startCrmShadowBatch
} from './crm-shadow.ts';
import {
  appendCrmActivityChunk,
  finalizeCrmActivityBatch,
  getCrmActivityStatus,
  startCrmActivityBatch
} from './crm-activity.ts';
import { getCrmAdminConfig } from './crm-config.ts';
import { tursoBatch, tursoSelect } from './turso.ts';

function json(body:any,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'
    }
  });
}

let connectorHashCache:{value:string,expires:number}|null=null;

async function hashText(value:string){
  const bytes=new TextEncoder().encode(value);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(digest).map(x=>x.toString(16).padStart(2,'0')).join('');
}

async function tokenMatches(req:Request){
  const supplied=String(req.headers.get('x-crm-connector-token')||'');
  if(!supplied)return {ok:false,reason:'missing'};

  let expectedHash='';
  const now=Date.now();
  if(connectorHashCache&&connectorHashCache.expires>now){
    expectedHash=connectorHashCache.value;
  }else{
    const rows=await tursoSelect(
      "SELECT token_sha256 FROM private.dashboard_rpc_auth WHERE id='crm-connector' LIMIT 1"
    ).catch(()=>[]);
    expectedHash=String(rows?.[0]?.token_sha256||'');
    if(expectedHash)connectorHashCache={value:expectedHash,expires:now+300000};
  }

  if(!expectedHash)return {ok:false,reason:'not_configured'};
  const got=await hashText(supplied);

  const enc=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',enc.encode(expectedHash)),
    crypto.subtle.digest('SHA-256',enc.encode(got))
  ]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);
  if(aa.length!==bb.length)return {ok:false,reason:'mismatch'};
  let diff=0;
  for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];
  return {ok:diff===0,reason:diff===0?'ok':'mismatch'};
}

function routeName(req:Request){
  const path=new URL(req.url).pathname.replace(/\/+$/,'');
  const marker='/connector-api';
  const i=path.indexOf(marker);
  if(i<0)return '';
  return path.slice(i+marker.length).replace(/^\/+/, '');
}

async function handleShadow(req:Request){
  if(req.method==='GET'){
    const [status,comparison]=await Promise.all([
      getCrmShadowStatus(),
      compareCrmShadowToProduction()
    ]);
    return json({ok:true,status,comparison});
  }
  if(req.method!=='POST')return json({ok:false,error:'Method not allowed.'},405);

  const body=await req.json();
  const action=String(body?.action||'');
  if(action==='start')return json({ok:true,...await startCrmShadowBatch()});
  if(action==='chunk')return json({ok:true,...await appendCrmShadowChunk(
    String(body?.batchId||''),
    Number(body?.seq),
    body?.rows
  )});
  if(action==='finalize')return json({ok:true,...await finalizeCrmShadowBatch(
    String(body?.batchId||''),
    Number(body?.expectedRows),
    body?.sourceCheckedAt?String(body.sourceCheckedAt):undefined
  )});
  return json({ok:false,error:'Unknown CRM shadow action.'},400);
}

async function handleActivity(req:Request){
  if(req.method==='GET')return json({ok:true,status:await getCrmActivityStatus()});
  if(req.method!=='POST')return json({ok:false,error:'Method not allowed.'},405);

  const body=await req.json();
  const action=String(body?.action||'');
  if(action==='start')return json({ok:true,...await startCrmActivityBatch()});
  if(action==='chunk')return json({ok:true,...await appendCrmActivityChunk(
    String(body?.batchId||''),
    String(body?.dataset||''),
    Number(body?.seq),
    body?.rows
  )});
  if(action==='finalize')return json({ok:true,...await finalizeCrmActivityBatch(
    String(body?.batchId||''),
    body?.expected,
    body?.sourceCheckedAt?String(body.sourceCheckedAt):undefined,
    body?.range
  )});
  return json({ok:false,error:'Unknown CRM activity action.'},400);
}

async function handleConfig(req:Request){
  if(req.method!=='GET')return json({ok:false,error:'Method not allowed.'},405);
  return json({ok:true,config:await getCrmAdminConfig()});
}

async function handleCommand(req:Request){
  if(req.method==='GET'){
    const rows=await tursoSelect(
      "SELECT id,command,payload FROM connector_commands WHERE status='pending' ORDER BY id ASC LIMIT 1"
    );
    return json({ok:true,command:rows[0]||null});
  }
  if(req.method!=='POST')return json({ok:false,error:'Method not allowed.'},405);

  const b=await req.json();
  const id=Number(b?.id),status=String(b?.status||'');
  if(!Number.isInteger(id)||!['running','completed','failed'].includes(status)){
    return json({ok:false,error:'Invalid command update.'},400);
  }

  if(status==='running'){
    await tursoBatch([{
      sql:"UPDATE connector_commands SET status='running',started_at=now() WHERE id=? AND status='pending'",
      args:[id]
    }]);
  }else{
    await tursoBatch([{
      sql:"UPDATE connector_commands SET status=?,completed_at=now(),result=? WHERE id=?",
      args:[status,String(b?.result||'').slice(0,2000),id]
    }]);
  }
  return json({ok:true});
}

Deno.serve(async (req:Request)=>{
  const auth=await tokenMatches(req);
  if(!auth.ok){
    if(auth.reason==='not_configured')return json({ok:false,error:'Connector API is not configured.'},503);
    return json({ok:false,error:'Unauthorized connector.'},401);
  }

  try{
    const route=routeName(req);
    if(route==='' && req.method==='GET'){
      return json({
        ok:true,
        service:'connector-api',
        version:2,
        routes:['crm-shadow','crm-activity','crm-config','connector-command']
      });
    }
    if(route==='crm-shadow')return await handleShadow(req);
    if(route==='crm-activity')return await handleActivity(req);
    if(route==='crm-config')return await handleConfig(req);
    if(route==='connector-command')return await handleCommand(req);
    return json({ok:false,error:'Unknown connector route.'},404);
  }catch(error:any){
    console.error('[connector-api]',error);
    return json({ok:false,error:error?.message||String(error)},500);
  }
});
