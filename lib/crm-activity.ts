import crypto from 'node:crypto';
import { tursoBatch, tursoSelect, tableColumns } from './turso';
import { assertCrmConnectorToken } from './crm-shadow';

export { assertCrmConnectorToken };

const STAGING='crm_daily_activity_chunks';
const TARGETS:Record<string,string>={
  leads:'daily_leads',
  weekly_leads:'weekly_leads',
  monthly_leads:'monthly_leads',
  opportunities:'daily_opportunities',
  calls:'daily_calls',
  tickets:'daily_tickets'
};
const PERSON_FIELD:Record<string,string>={
  leads:'owner',
  weekly_leads:'owner',
  monthly_leads:'owner',
  opportunities:'creator',
  calls:'user',
  tickets:'owner'
};

function ident(name:string){
  if(!/^[_a-zA-Z0-9]+$/.test(name)) throw new Error('Invalid SQL identifier.');
  return '"' + name + '"';
}
function placeholders(rows:number,cols:number){
  const one='('+Array(cols).fill('?').join(',')+')';
  return Array(rows).fill(one).join(',');
}
function clean(v:any){
  if(v===null||v===undefined) return null;
  if(typeof v==='number') return Number.isFinite(v)?v:null;
  const s=String(v).trim();
  return s===''?null:s;
}

export async function ensureCrmActivityTables(){
  await tursoBatch([{
    sql:`CREATE TABLE IF NOT EXISTS ${ident(STAGING)}(
      batch_id TEXT NOT NULL,
      dataset TEXT NOT NULL,
      seq INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(batch_id,dataset,seq)
    )`
  }]);
}
export async function startCrmActivityBatch(){
  await ensureCrmActivityTables();
  const batchId=crypto.randomUUID();
  const cutoff=new Date(Date.now()-24*3600_000).toISOString();
  await tursoBatch([{sql:`DELETE FROM ${ident(STAGING)} WHERE created_at<?`,args:[cutoff]}]);
  return {batchId,maxChunkRows:300};
}
export async function appendCrmActivityChunk(batchId:string,dataset:string,seq:number,rows:any[]){
  if(!batchId || !TARGETS[dataset]) throw new Error('Invalid CRM activity batch.');
  if(!Number.isInteger(seq)||seq<0) throw new Error('Invalid CRM activity sequence.');
  if(!Array.isArray(rows)||rows.length<1||rows.length>300) throw new Error('CRM activity chunk must contain 1..300 rows.');
  await ensureCrmActivityTables();
  await tursoBatch([{
    sql:`INSERT INTO ${ident(STAGING)}(batch_id,dataset,seq,payload_json,created_at) VALUES(?,?,?,?,?)
         ON CONFLICT(batch_id,dataset,seq) DO UPDATE SET payload_json=excluded.payload_json,created_at=excluded.created_at`,
    args:[batchId,dataset,seq,JSON.stringify(rows),new Date().toISOString()]
  }]);
  return {batchId,dataset,seq,rows:rows.length};
}

async function replaceTarget(target:string,rows:any[]){
  const destColumns=await tableColumns(target);
  const destSet=new Set(destColumns);
  const mapped=rows.map(row=>{
    const out:any={};
    for(const col of destColumns){
      if(Object.prototype.hasOwnProperty.call(row,col)) out[col]=clean(row[col]);
    }
    return out;
  });
  const used=destColumns.filter(c=>mapped.some(r=>Object.prototype.hasOwnProperty.call(r,c)));
  if(!used.length){
    await tursoBatch([{sql:`DELETE FROM ${ident(target)}`}]);
    return 0;
  }
  const stage=`stg_${target}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const qs=ident(stage),qt=ident(target),cols=used.map(ident).join(',');
  try{
    await tursoBatch([
      {sql:`DROP TABLE IF EXISTS ${qs}`},
      {sql:`CREATE TABLE ${qs} AS SELECT * FROM ${qt} WHERE FALSE`}
    ]);
    const chunk=250;
    for(let i=0;i<mapped.length;i+=chunk){
      const part=mapped.slice(i,i+chunk),args:any[]=[];
      for(const r of part) for(const c of used) args.push(r[c]===undefined?null:r[c]);
      await tursoBatch([{sql:`INSERT INTO ${qs} (${cols}) VALUES ${placeholders(part.length,used.length)}`,args}]);
    }
    await tursoBatch([
      {sql:'BEGIN IMMEDIATE'},
      {sql:`DELETE FROM ${qt}`},
      {sql:`INSERT INTO ${qt} (${cols}) SELECT ${cols} FROM ${qs}`},
      {sql:`DROP TABLE ${qs}`},
      {sql:'COMMIT'}
    ]);
    return mapped.length;
  }catch(e){
    await tursoBatch([{sql:`DROP TABLE IF EXISTS ${qs}`}]).catch(()=>{});
    throw e;
  }
}

export async function finalizeCrmActivityBatch(batchId:string,expected:any,sourceCheckedAt?:string,range?:any){
  if(!batchId) throw new Error('Missing CRM activity batch id.');
  await ensureCrmActivityTables();
  const chunks=await tursoSelect(`SELECT dataset,seq,payload_json FROM ${ident(STAGING)} WHERE batch_id=? ORDER BY dataset,seq`,[batchId]);
  const grouped:Record<string,any[]>={leads:[],weekly_leads:[],monthly_leads:[],opportunities:[],calls:[],tickets:[]};
  for(const chunk of chunks){
    const dataset=String(chunk.dataset||'');
    if(!TARGETS[dataset]) continue;
    const parsed=JSON.parse(String(chunk.payload_json||'[]'));
    if(!Array.isArray(parsed)) throw new Error('Invalid CRM activity payload.');
    grouped[dataset].push(...parsed);
  }
  for(const key of Object.keys(TARGETS)){
    const want=Number(expected?.[key]||0);
    if(grouped[key].length!==want) throw new Error(`CRM activity row-count mismatch for ${key}: expected ${want}, received ${grouped[key].length}.`);
  }

  const teamRows=await tursoSelect('SELECT name FROM team_members');
  const team=new Set(teamRows.map((r:any)=>String(r.name||'').trim()).filter(Boolean));
  const filtered:Record<string,any[]>={};
  for(const key of Object.keys(TARGETS)){
    const person=PERSON_FIELD[key];
    filtered[key]=grouped[key].filter(r=>team.has(String(r?.[person]||'').trim()));
  }

  const counts:any={};
  for(const key of ['leads','weekly_leads','monthly_leads','opportunities','calls','tickets']) counts[key]=await replaceTarget(TARGETS[key],filtered[key]);

  const now=new Date().toISOString();
  const meta=[
    ['crm_activity_last_sync_at',now],
    ['crm_activity_source_checked_at',sourceCheckedAt||now],
    ['crm_activity_range_start',String(range?.start||'')],
    ['crm_activity_range_end',String(range?.end||'')],
    ['crm_activity_counts',JSON.stringify(counts)]
  ];
  await tursoBatch(meta.map(([key,value])=>({
    sql:"INSERT INTO dashboard_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    args:[key,value]
  })));
  await tursoBatch([{sql:`DELETE FROM ${ident(STAGING)} WHERE batch_id=?`,args:[batchId]}]);
  return {batchId,counts,lastSyncAt:now,sourceCheckedAt:sourceCheckedAt||now,range};
}

export async function getCrmActivityStatus(){
  const rows=await tursoSelect("SELECT key,value FROM dashboard_meta WHERE key LIKE 'crm_activity_%'");
  const m=Object.fromEntries(rows.map((r:any)=>[r.key,r.value]));
  const counts=(()=>{try{return JSON.parse(m.crm_activity_counts||'{}')}catch{return {}}})();
  return {
    lastSyncAt:m.crm_activity_last_sync_at||'',
    sourceCheckedAt:m.crm_activity_source_checked_at||'',
    range:{start:m.crm_activity_range_start||'',end:m.crm_activity_range_end||''},
    counts
  };
}
