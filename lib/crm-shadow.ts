import crypto from 'node:crypto';
import { tursoBatch, tursoSelect, tableColumns } from './turso';

const SHADOW_TABLE='open_leads_crm_shadow';
const NEXT_TABLE='open_leads_crm_shadow_next';
const STAGING_TABLE='crm_open_leads_shadow_chunks';

function ident(name:string){
  if(!/^[_a-zA-Z0-9]+$/.test(name)) throw new Error('Invalid SQL identifier.');
  return '"' + name + '"';
}
function clean(v:any){ return v===null||v===undefined ? null : String(v).trim(); }
function parseDate(v:any){
  const s=clean(v); if(!s) return null;
  const d=new Date(s); return Number.isNaN(d.getTime()) ? null : d;
}
function ageDays(v:any){
  const d=parseDate(v); if(!d) return null;
  return Math.max(0,Math.floor((Date.now()-d.getTime())/86400000));
}
function safeTokenEqual(got:string,expected:string){
  const a=Buffer.from(got||''); const b=Buffer.from(expected||'');
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
export function assertCrmConnectorToken(value:string|null){
  const expected=process.env.CRM_CONNECTOR_TOKEN||'';
  if(!expected || !value || !safeTokenEqual(value,expected)) throw Object.assign(new Error('Unauthorized connector.'),{status:401});
}

export async function ensureCrmShadowTables(){
  await tursoBatch([
    {sql:`CREATE TABLE IF NOT EXISTS ${ident(SHADOW_TABLE)} AS SELECT * FROM open_leads WHERE FALSE`},
    {sql:`CREATE TABLE IF NOT EXISTS ${ident(NEXT_TABLE)} AS SELECT * FROM open_leads WHERE FALSE`},
    {sql:`CREATE TABLE IF NOT EXISTS ${ident(STAGING_TABLE)} (
      batch_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(batch_id,seq)
    )`}
  ]);
}

export async function startCrmShadowBatch(){
  await ensureCrmShadowTables();
  const batchId=crypto.randomUUID();
  const cutoff=new Date(Date.now()-24*3600_000).toISOString();
  await tursoBatch([{sql:`DELETE FROM ${ident(STAGING_TABLE)} WHERE created_at<?`,args:[cutoff]}]);
  return {batchId,maxChunkRows:400};
}

export async function appendCrmShadowChunk(batchId:string,seq:number,rows:any[]){
  if(!batchId || !Number.isInteger(seq) || seq<0) throw new Error('Invalid CRM shadow chunk.');
  if(!Array.isArray(rows) || rows.length<1 || rows.length>400) throw new Error('CRM shadow chunk must contain 1..400 rows.');
  await ensureCrmShadowTables();
  await tursoBatch([{
    sql:`INSERT INTO ${ident(STAGING_TABLE)}(batch_id,seq,payload_json,created_at) VALUES(?,?,?,?)
         ON CONFLICT(batch_id,seq) DO UPDATE SET payload_json=excluded.payload_json,created_at=excluded.created_at`,
    args:[batchId,seq,JSON.stringify(rows),new Date().toISOString()]
  }]);
  return {batchId,seq,rows:rows.length};
}

const FIELD_MAP:Record<string,string>={
  leadNumber:'lead_number',
  createdOn:'created_date',
  customerRank:'customer_rank',
  modifiedOn:'last_modified_date',
  status:'last_status',
  nextCallReason:'next_call_reason',
  followUpBy:'next_followup_at',
  customerName:'customer_name',
  firstName:'first_name',
  middleName:'middle_name',
  lastName:'last_name',
  modifiedBy:'last_modified_by',
  createdBy:'creator',
  owner:'owner',
  leadType:'lead_type',
  leadSource:'source',
  campaign:'campaign',
  application:'source_software',
  identityId:'identity_id',
  mobile:'mobile',
  customerAdvisor:'advisor',
  customerMarketer:'referrer',
  businessUnit:'business_unit',
  trafficSource:'traffic_source'
};

function mapRow(row:any,dest:Set<string>){
  const out:any={};
  for(const [source,target] of Object.entries(FIELD_MAP)){
    if(dest.has(target) && row?.[source]!==undefined) out[target]=row[source]??null;
  }
  if(dest.has('age_days')) out.age_days=ageDays(row?.createdOn);
  return out;
}
function placeholders(rows:number,cols:number){
  const one='('+Array(cols).fill('?').join(',')+')';
  return Array(rows).fill(one).join(',');
}

export async function finalizeCrmShadowBatch(batchId:string,expectedRows:number,sourceCheckedAt?:string){
  if(!batchId) throw new Error('Missing CRM shadow batch id.');
  await ensureCrmShadowTables();
  const chunks=await tursoSelect(`SELECT seq,payload_json FROM ${ident(STAGING_TABLE)} WHERE batch_id=? ORDER BY seq`,[batchId]);
  if(!chunks.length) throw new Error('CRM shadow batch is empty.');
  const rows:any[]=[];
  for(const chunk of chunks){
    const parsed=JSON.parse(String(chunk.payload_json||'[]'));
    if(!Array.isArray(parsed)) throw new Error('Invalid CRM shadow payload.');
    rows.push(...parsed);
  }
  if(!Number.isInteger(expectedRows) || expectedRows<0 || rows.length!==expectedRows){
    throw new Error(`CRM shadow row-count mismatch: expected ${expectedRows}, received ${rows.length}.`);
  }

  const destColumns=await tableColumns(NEXT_TABLE);
  const dest=new Set(destColumns);
  const mapped=rows.map(r=>mapRow(r,dest));
  const usedColumns=destColumns.filter(c=>mapped.some(r=>Object.prototype.hasOwnProperty.call(r,c)));
  if(!usedColumns.includes('lead_number') || !usedColumns.includes('owner') || !usedColumns.includes('last_status')){
    throw new Error('CRM shadow mapping is missing required open-lead columns.');
  }

  await tursoBatch([{sql:`DELETE FROM ${ident(NEXT_TABLE)}`}]);
  const chunkSize=250;
  for(let i=0;i<mapped.length;i+=chunkSize){
    const part=mapped.slice(i,i+chunkSize);
    const args:any[]=[];
    for(const row of part) for(const col of usedColumns) args.push(row[col]===undefined?null:row[col]);
    await tursoBatch([{
      sql:`INSERT INTO ${ident(NEXT_TABLE)} (${usedColumns.map(ident).join(',')}) VALUES ${placeholders(part.length,usedColumns.length)}`,
      args
    }]);
  }

  const countRows=await tursoSelect(`SELECT COUNT(*) AS n FROM ${ident(NEXT_TABLE)}`);
  const actual=Number(countRows?.[0]?.n||0);
  if(actual!==expectedRows) throw new Error(`CRM shadow verification failed: expected ${expectedRows}, staged ${actual}.`);

  const now=new Date().toISOString();
  await tursoBatch([
    {sql:'BEGIN IMMEDIATE'},
    {sql:`DELETE FROM ${ident(SHADOW_TABLE)}`},
    {sql:`INSERT INTO ${ident(SHADOW_TABLE)} SELECT * FROM ${ident(NEXT_TABLE)}`},
    {sql:"INSERT INTO dashboard_meta(key,value) VALUES('crm_shadow_last_sync_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[now]},
    {sql:"INSERT INTO dashboard_meta(key,value) VALUES('crm_shadow_source_checked_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[sourceCheckedAt||now]},
    {sql:"INSERT INTO dashboard_meta(key,value) VALUES('crm_shadow_row_count',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[String(actual)]},
    {sql:'COMMIT'}
  ]);
  await tursoBatch([{sql:`DELETE FROM ${ident(STAGING_TABLE)} WHERE batch_id=?`,args:[batchId]}]);
  return {batchId,rows:actual,lastSyncAt:now,sourceCheckedAt:sourceCheckedAt||now,table:SHADOW_TABLE};
}

export async function getCrmShadowStatus(){
  await ensureCrmShadowTables();
  const [count,meta]=await Promise.all([
    tursoSelect(`SELECT COUNT(*) AS n FROM ${ident(SHADOW_TABLE)}`),
    tursoSelect("SELECT key,value FROM dashboard_meta WHERE key IN ('crm_shadow_last_sync_at','crm_shadow_source_checked_at','crm_shadow_row_count')")
  ]);
  const values=Object.fromEntries(meta.map((r:any)=>[r.key,r.value]));
  return {
    rows:Number(count?.[0]?.n||0),
    lastSyncAt:values.crm_shadow_last_sync_at||'',
    sourceCheckedAt:values.crm_shadow_source_checked_at||'',
    recordedRows:Number(values.crm_shadow_row_count||0)
  };
}

export async function compareCrmShadowToProduction(){
  await ensureCrmShadowTables();
  const [prod,shadow,onlyProd,onlyShadow]=await Promise.all([
    tursoSelect('SELECT COUNT(*) AS n FROM open_leads'),
    tursoSelect(`SELECT COUNT(*) AS n FROM ${ident(SHADOW_TABLE)}`),
    tursoSelect(`SELECT COUNT(*) AS n FROM open_leads p LEFT JOIN ${ident(SHADOW_TABLE)} s ON s.lead_number=p.lead_number WHERE s.lead_number IS NULL`),
    tursoSelect(`SELECT COUNT(*) AS n FROM ${ident(SHADOW_TABLE)} s LEFT JOIN open_leads p ON p.lead_number=s.lead_number WHERE p.lead_number IS NULL`)
  ]);
  return {
    productionRows:Number(prod?.[0]?.n||0),
    shadowRows:Number(shadow?.[0]?.n||0),
    onlyProduction:Number(onlyProd?.[0]?.n||0),
    onlyShadow:Number(onlyShadow?.[0]?.n||0)
  };
}


export async function operationalOpenLeadsSource(){
  const meta=await tursoSelect("SELECT key,value FROM dashboard_meta WHERE key IN ('crm_shadow_last_sync_at','crm_shadow_row_count')");
  const values=Object.fromEntries(meta.map((r:any)=>[r.key,r.value]));
  const lastSyncAt=String(values.crm_shadow_last_sync_at||'');
  const recordedRows=Number(values.crm_shadow_row_count||0);
  const ts=Date.parse(lastSyncAt);
  const ageMinutes=Number.isFinite(ts)?(Date.now()-ts)/60000:Number.POSITIVE_INFINITY;
  const useCrm=recordedRows>0 && ageMinutes>=0 && ageMinutes<=1080;
  return {
    table: useCrm ? SHADOW_TABLE : 'open_leads',
    source: useCrm ? 'crm' : 'excel',
    lastSyncAt,
    ageMinutes:Number.isFinite(ageMinutes)?Math.round(ageMinutes*10)/10:null,
    fallback:!useCrm
  };
}
