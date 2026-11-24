import { tursoBatch, tursoSelect } from './turso.ts';

const STAGING='crm_month_report_chunks';
const TARGETS:Record<string,string>={
  report_month_leads:'report_month_leads',
  report_month_opportunities:'report_month_opportunities',
  report_month_calls:'report_month_calls',
  report_month_tickets:'report_month_tickets'
};
const REQUIRED=Object.keys(TARGETS);

function ident(name:string){
  if(!/^[_a-zA-Z0-9]+$/.test(name))throw new Error('Invalid SQL identifier.');
  return '"'+name+'"';
}

export async function ensureCrmMonthReportTables(){
  await tursoBatch([{
    sql:`CREATE TABLE IF NOT EXISTS ${ident(STAGING)}(
      batch_id TEXT NOT NULL,
      dataset TEXT NOT NULL,
      seq INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(batch_id,dataset,seq)
    )`
  }]);
}

export async function startCrmMonthReportBatch(){
  await ensureCrmMonthReportTables();
  const batchId=crypto.randomUUID();
  await tursoBatch([{
    sql:`DELETE FROM ${ident(STAGING)} WHERE created_at<now()-interval '12 hours'`
  }]);
  return {batchId,maxChunkRows:300};
}

export async function appendCrmMonthReportChunk(batchId:string,dataset:string,seq:number,rows:any[]){
  if(!batchId||!TARGETS[dataset])throw new Error('Invalid CRM month-report batch.');
  if(!Number.isInteger(seq)||seq<0)throw new Error('Invalid CRM month-report sequence.');
  if(!Array.isArray(rows)||rows.length<1||rows.length>300){
    throw new Error('CRM month-report chunk must contain 1..300 rows.');
  }
  await ensureCrmMonthReportTables();
  await tursoBatch([{
    sql:`INSERT INTO ${ident(STAGING)}(batch_id,dataset,seq,payload_json,created_at)
         VALUES(?,?,?,?,now())
         ON CONFLICT(batch_id,dataset,seq) DO UPDATE SET
           payload_json=excluded.payload_json,created_at=excluded.created_at`,
    args:[batchId,dataset,seq,JSON.stringify(rows)]
  }]);
  return {batchId,dataset,seq,rows:rows.length};
}

type Prepared={
  dataset:string;
  target:string;
  stage:string;
  columns:string[];
  count:number;
};

async function prepare(batchId:string,dataset:string,target:string,expected:number):Promise<Prepared>{
  const countRows=await tursoSelect(
    `SELECT COALESCE(SUM(jsonb_array_length(payload_json::jsonb)),0) n
     FROM ${ident(STAGING)} WHERE batch_id=? AND dataset=?`,
    [batchId,dataset]
  );
  const actual=Number(countRows?.[0]?.n||0);
  if(actual!==expected){
    throw new Error(`CRM month-report row-count mismatch for ${dataset}: expected ${expected}, received ${actual}.`);
  }

  const cols=await tursoSelect(
    "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=? ORDER BY ordinal_position",
    [target]
  );
  if(!cols.length)throw new Error('Month-report target table not found: '+target);

  const stage=`stg_${target}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const qs=ident(stage),qt=ident(target);
  const names=cols.map((r:any)=>String(r.column_name));
  const colSql=names.map(ident).join(',');
  const exprSql=cols.map((r:any)=>{
    const col=String(r.column_name).replace(/'/g,"''");
    const type=String(r.data_type||'').toLowerCase();
    const raw=`NULLIF(j->>'${col}','')`;
    if(['numeric','decimal','real','double precision'].includes(type))return `${raw}::numeric`;
    if(['integer','bigint','smallint'].includes(type))return `${raw}::bigint`;
    if(type==='boolean')return `${raw}::boolean`;
    return raw;
  }).join(',');

  const teamFilter=dataset==='report_month_leads'
    ? " AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.name=NULLIF(j->>'owner',''))"
    : '';

  try{
    await tursoBatch([
      {sql:`DROP TABLE IF EXISTS ${qs}`},
      {sql:`CREATE TABLE ${qs} AS SELECT * FROM ${qt} WHERE FALSE`},
      {sql:`
        INSERT INTO ${qs}(${colSql})
        SELECT ${exprSql}
        FROM ${ident(STAGING)} s
        CROSS JOIN LATERAL jsonb_array_elements(s.payload_json::jsonb) j
        WHERE s.batch_id=? AND s.dataset=?${teamFilter}
      `,args:[batchId,dataset]}
    ]);
    const rows=await tursoSelect(`SELECT COUNT(*) n FROM ${qs}`);
    return {dataset,target,stage,columns:names,count:Number(rows?.[0]?.n||0)};
  }catch(e){
    await tursoBatch([{sql:`DROP TABLE IF EXISTS ${qs}`}]).catch(()=>{});
    throw e;
  }
}

async function cleanup(prepared:Prepared[]){
  for(const p of prepared){
    await tursoBatch([{sql:`DROP TABLE IF EXISTS ${ident(p.stage)}`}]).catch(()=>{});
  }
}

export async function finalizeCrmMonthReportBatch(
  batchId:string,
  expected:any,
  sourceCheckedAt?:string,
  range?:any
){
  if(!batchId)throw new Error('Missing CRM month-report batch id.');
  await ensureCrmMonthReportTables();

  const keys=Object.keys(expected||{}).filter(k=>TARGETS[k]).sort();
  const required=[...REQUIRED].sort();
  if(keys.length!==required.length||keys.some((k,i)=>k!==required[i])){
    throw new Error('Month report must publish Lead, Opportunity, Calls and Tickets together.');
  }

  const reportKey=String(range?.reportKey||'').trim();
  if(!/^\d{4}-\d{2}$/.test(reportKey))throw new Error('Invalid Persian month report key.');
  const start=String(range?.start||'');
  const end=String(range?.end||'');
  if(!start||!end||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(start)>=Date.parse(end)){
    throw new Error('Invalid month-report range.');
  }

  const prepared:Prepared[]=[];
  try{
    for(const key of required){
      prepared.push(await prepare(batchId,key,TARGETS[key],Number(expected?.[key]||0)));
    }

    const total=prepared.reduce((sum,p)=>sum+p.count,0);
    if(total===0){
      throw new Error('Refusing all-zero CRM month report; preserving current snapshot.');
    }

    const now=new Date().toISOString();
    const counts=Object.fromEntries(prepared.map(p=>[p.dataset,p.count]));
    const tx:any[]=[{sql:'BEGIN IMMEDIATE'}];

    for(const p of prepared){
      const qt=ident(p.target),qs=ident(p.stage),cols=p.columns.map(ident).join(',');
      tx.push({sql:`DELETE FROM ${qt}`});
      tx.push({sql:`INSERT INTO ${qt}(${cols}) SELECT ${cols} FROM ${qs}`});
    }

    const meta=[
      ['crm_month_report_last_sync_at',now],
      ['crm_month_report_source_checked_at',sourceCheckedAt||now],
      ['crm_month_report_range_start',start],
      ['crm_month_report_range_end',end],
      ['crm_month_report_period',reportKey],
      ['crm_month_report_label',String(range?.label||reportKey)],
      ['crm_month_report_counts',JSON.stringify(counts)]
    ];
    for(const [key,value] of meta){
      tx.push({
        sql:"INSERT INTO dashboard_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        args:[key,value]
      });
    }

    for(const p of prepared)tx.push({sql:`DROP TABLE ${ident(p.stage)}`});
    tx.push({sql:'COMMIT'});
    await tursoBatch(tx);
    await tursoBatch([{sql:`DELETE FROM ${ident(STAGING)} WHERE batch_id=?`,args:[batchId]}]);

    return {batchId,counts,lastSyncAt:now,sourceCheckedAt:sourceCheckedAt||now,range};
  }catch(e){
    await cleanup(prepared);
    throw e;
  }
}

export async function getCrmMonthReportStatus(){
  const rows=await tursoSelect(
    "SELECT key,value FROM dashboard_meta WHERE key LIKE 'crm_month_report_%'"
  );
  const m:any=Object.fromEntries(rows.map((r:any)=>[r.key,r.value]));
  let counts={};
  try{counts=JSON.parse(String(m.crm_month_report_counts||'{}'));}catch{}
  return {
    lastSyncAt:m.crm_month_report_last_sync_at||'',
    sourceCheckedAt:m.crm_month_report_source_checked_at||'',
    period:m.crm_month_report_period||'',
    label:m.crm_month_report_label||'',
    range:{
      start:m.crm_month_report_range_start||'',
      end:m.crm_month_report_range_end||''
    },
    counts
  };
}
