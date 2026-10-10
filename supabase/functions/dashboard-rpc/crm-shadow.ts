import { tursoSelect } from './turso.ts';

const SHADOW_TABLE='open_leads_crm_shadow';

export async function operationalOpenLeadsSource(){
  const [meta,configRows,shadowCount]=await Promise.all([
    tursoSelect("SELECT key,value FROM dashboard_meta WHERE key IN ('crm_shadow_last_sync_at','crm_shadow_row_count')"),
    tursoSelect("SELECT config FROM crm_admin_config WHERE id='default' LIMIT 1").catch(()=>[]),
    tursoSelect(`SELECT COUNT(*) AS n FROM ${SHADOW_TABLE}`).catch(()=>[])
  ]);
  const values=Object.fromEntries(meta.map((r:any)=>[r.key,r.value]));
  const lastSyncAt=String(values.crm_shadow_last_sync_at||'');
  const actualRows=Number(shadowCount?.[0]?.n||0);
  const recordedRows=Number(values.crm_shadow_row_count||actualRows||0);
  let sourceMode='crm';
  try{
    const raw=configRows?.[0]?.config;
    const cfg=raw&&typeof raw==='object'?raw:JSON.parse(String(raw||'{}'));
    sourceMode=String(cfg?.openLeads?.sourceMode||'crm').toLowerCase();
  }catch{}
  const ts=Date.parse(lastSyncAt);
  const ageMinutes=Number.isFinite(ts)?(Date.now()-ts)/60000:Number.POSITIVE_INFINITY;
  const stale=Number.isFinite(ageMinutes)&&ageMinutes>1080;
  const useCrm=sourceMode!=='excel'&&actualRows>0;
  return {
    table:useCrm?SHADOW_TABLE:'open_leads',
    source:useCrm?'crm':'excel',
    sourceMode,
    lastSyncAt,
    rows:actualRows,
    recordedRows,
    ageMinutes:Number.isFinite(ageMinutes)?Math.round(ageMinutes*10)/10:null,
    stale,
    fallback:sourceMode!=='excel'&&!useCrm
  };
}
