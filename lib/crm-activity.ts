import crypto from 'node:crypto';
import { tursoBatch, tursoSelect, tableColumns, databaseProvider } from './turso';
import { assertCrmConnectorToken } from './crm-shadow';

export { assertCrmConnectorToken };

const STAGING='crm_daily_activity_chunks';
const TARGETS:Record<string,string>={
  leads:'daily_leads',
  weekly_leads:'weekly_leads',
  monthly_leads:'monthly_leads',
  opportunities:'daily_opportunities',
  weekly_opportunities:'weekly_opportunities',
  monthly_opportunities:'monthly_opportunities',
  calls:'daily_calls',
  weekly_calls:'weekly_calls',
  monthly_calls:'monthly_calls',
  tickets:'daily_tickets',
  weekly_tickets:'weekly_tickets',
  monthly_tickets:'monthly_tickets'
};
const PERSON_FIELD:Record<string,string>={
  leads:'owner',
  weekly_leads:'owner',
  monthly_leads:'owner',
  opportunities:'creator',
  weekly_opportunities:'creator',
  monthly_opportunities:'creator',
  calls:'user',
  weekly_calls:'user',
  monthly_calls:'user',
  tickets:'owner',
  weekly_tickets:'owner',
  monthly_tickets:'owner'
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
  const cutoff=new Date(Date.now()-6*3600_000).toISOString();
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


type PreparedDataset={
  dataset:string;
  target:string;
  stage:string;
  columns:string[];
  count:number;
};

async function prepareDatasetFromStaging(batchId:string,dataset:string,target:string,expectedRows:number):Promise<PreparedDataset>{
  const countRows=await tursoSelect(
    `SELECT COALESCE(SUM(jsonb_array_length(payload_json::jsonb)),0) AS n
     FROM ${ident(STAGING)} WHERE batch_id=? AND dataset=?`,
    [batchId,dataset]
  );
  const actual=Number(countRows?.[0]?.n||0);
  if(actual!==expectedRows){
    throw new Error(`CRM activity row-count mismatch for ${dataset}: expected ${expectedRows}, received ${actual}.`);
  }

  const cols=await tursoSelect(
    "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=? ORDER BY ordinal_position",
    [target]
  );
  if(!cols.length) throw new Error('Target table metadata not found: '+target);

  const stage=`stg_${target}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const qs=ident(stage),qt=ident(target);
  const colNames=cols.map((r:any)=>String(r.column_name));
  const colSql=colNames.map(ident).join(',');
  const exprSql=cols.map((r:any)=>{
    const col=String(r.column_name).replace(/'/g,"''");
    const type=String(r.data_type||'').toLowerCase();
    const raw=`NULLIF(j->>'${col}','')`;
    if(['numeric','decimal','real','double precision'].includes(type)) return `${raw}::numeric`;
    if(['integer','bigint','smallint'].includes(type)) return `${raw}::bigint`;
    if(type==='boolean') return `${raw}::boolean`;
    return raw;
  }).join(',');

  const teamFilter=dataset==='leads'||dataset==='weekly_leads'||dataset==='monthly_leads'
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

    const staged=await tursoSelect(`SELECT COUNT(*) AS n FROM ${qs}`);
    return {
      dataset,
      target,
      stage,
      columns:colNames,
      count:Number(staged?.[0]?.n||0)
    };
  }catch(e){
    await tursoBatch([{sql:`DROP TABLE IF EXISTS ${qs}`}]).catch(()=>{});
    throw e;
  }
}

function assertPeriodCountConsistency(prepared:PreparedDataset[]){
  const byDataset=new Map(prepared.map(x=>[x.dataset,x]));
  const families=[
    ['leads','weekly_leads','monthly_leads'],
    ['opportunities','weekly_opportunities','monthly_opportunities'],
    ['calls','weekly_calls','monthly_calls'],
    ['tickets','weekly_tickets','monthly_tickets']
  ];

  for(const [dailyKey,weeklyKey,monthlyKey] of families){
    const daily=byDataset.get(dailyKey);
    const weekly=byDataset.get(weeklyKey);
    const monthly=byDataset.get(monthlyKey);
    if(!daily||!weekly||!monthly) continue;

    if(daily.count>weekly.count || weekly.count>monthly.count){
      throw new Error(
        `CRM activity period counts are inconsistent for ${dailyKey}: daily=${daily.count}, weekly=${weekly.count}, monthly=${monthly.count}.`
      );
    }
  }
}

async function cleanupPrepared(prepared:PreparedDataset[]){
  for(const p of prepared){
    await tursoBatch([{sql:`DROP TABLE IF EXISTS ${ident(p.stage)}`}]).catch(()=>{});
  }
}

async function activityMetaForBatch(requestedKeys:string[],counts:any,sourceCheckedAt:string|undefined,range:any){
  const metaRows=await tursoSelect(
    "SELECT key,value FROM dashboard_meta WHERE key IN ('crm_activity_last_sync_at','crm_activity_lead_opp_last_sync_at','crm_activity_calls_last_sync_at','crm_activity_tickets_last_sync_at','crm_activity_counts')"
  ).catch(()=>[]);
  const current:any=Object.fromEntries(metaRows.map((r:any)=>[r.key,r.value]));

  const now=new Date().toISOString();
  const component:any={
    leadOpp:String(current.crm_activity_lead_opp_last_sync_at||''),
    calls:String(current.crm_activity_calls_last_sync_at||''),
    tickets:String(current.crm_activity_tickets_last_sync_at||'')
  };

  if(requestedKeys.some(k=>['leads','weekly_leads','monthly_leads','opportunities','weekly_opportunities','monthly_opportunities'].includes(k))){
    component.leadOpp=now;
  }
  if(requestedKeys.some(k=>['calls','weekly_calls','monthly_calls'].includes(k))){
    component.calls=now;
  }
  if(requestedKeys.some(k=>['tickets','weekly_tickets','monthly_tickets'].includes(k))){
    component.tickets=now;
  }

  let mergedCounts:any={};
  try{ mergedCounts=JSON.parse(String(current.crm_activity_counts||'{}')); }catch{}
  mergedCounts={...mergedCounts,...counts};

  const componentTimes=[component.leadOpp,component.calls,component.tickets]
    .filter(Boolean)
    .map((raw:string)=>({raw,time:Date.parse(raw)}))
    .filter((x:any)=>Number.isFinite(x.time));

  const completeSyncAt=componentTimes.length===3
    ? componentTimes.sort((a:any,b:any)=>a.time-b.time)[0].raw
    : String(current.crm_activity_last_sync_at||now);

  return {
    now,
    completeSyncAt,
    rows:[
      ['crm_activity_last_sync_at',completeSyncAt],
      ['crm_activity_lead_opp_last_sync_at',component.leadOpp],
      ['crm_activity_calls_last_sync_at',component.calls],
      ['crm_activity_tickets_last_sync_at',component.tickets],
      ['crm_activity_source_checked_at',sourceCheckedAt||now],
      ['crm_activity_range_start',String(range?.start||'')],
      ['crm_activity_range_end',String(range?.end||'')],
      ['crm_activity_counts',JSON.stringify(mergedCounts)]
    ]
  };
}

async function replaceCallsFromStaging(batchId:string,dataset:string,target:string,expectedRows:number){
  const countRows=await tursoSelect(
    `SELECT COALESCE(SUM(jsonb_array_length(payload_json::jsonb)),0) AS n
     FROM ${ident(STAGING)} WHERE batch_id=? AND dataset=?`,
    [batchId,dataset]
  );
  const actual=Number(countRows?.[0]?.n||0);
  if(actual!==expectedRows){
    throw new Error(`CRM activity row-count mismatch for ${dataset}: expected ${expectedRows}, received ${actual}.`);
  }

  const stage=`stg_${target}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const qs=ident(stage),qt=ident(target);

  try{
    await tursoBatch([
      {sql:`DROP TABLE IF EXISTS ${qs}`},
      {sql:`CREATE TABLE ${qs} AS SELECT * FROM ${qt} WHERE FALSE`},
      {sql:`
        INSERT INTO ${qs}(
          call_id,subject,"user",queue,planned_start,start_date,customer,customer_rank,
          destination_number,phone_number,parameters,duration,business_unit,lead_number
        )
        SELECT
          j->>'call_id',
          j->>'subject',
          j->>'user',
          j->>'queue',
          j->>'planned_start',
          j->>'start_date',
          j->>'customer',
          j->>'customer_rank',
          j->>'destination_number',
          j->>'phone_number',
          j->>'parameters',
          NULLIF(j->>'duration','')::numeric,
          j->>'business_unit',
          j->>'lead_number'
        FROM ${ident(STAGING)} s
        CROSS JOIN LATERAL jsonb_array_elements(s.payload_json::jsonb) j
        WHERE s.batch_id=? AND s.dataset=?
      `,args:[batchId,dataset]},
      {sql:'BEGIN IMMEDIATE'},
      {sql:`DELETE FROM ${qt}`},
      {sql:`
        INSERT INTO ${qt}(
          call_id,subject,"user",queue,planned_start,start_date,customer,customer_rank,
          destination_number,phone_number,parameters,duration,business_unit,lead_number
        )
        SELECT
          call_id,subject,"user",queue,planned_start,start_date,customer,customer_rank,
          destination_number,phone_number,parameters,duration,business_unit,lead_number
        FROM ${qs}
      `},
      {sql:`DROP TABLE ${qs}`},
      {sql:'COMMIT'}
    ]);
    return actual;
  }catch(e){
    await tursoBatch([{sql:`DROP TABLE IF EXISTS ${qs}`}]).catch(()=>{});
    throw e;
  }
}

export async function finalizeCrmActivityBatch(batchId:string,expected:any,sourceCheckedAt?:string,range?:any){
  if(!batchId) throw new Error('Missing CRM activity batch id.');
  await ensureCrmActivityTables();

  const requestedKeys=Object.keys(expected||{}).filter(key=>TARGETS[key]);
  if(!requestedKeys.length) throw new Error('CRM activity finalize has no datasets.');

  if(databaseProvider()==='PostgreSQL'){
    const prepared:PreparedDataset[]=[];
    try{
      for(const key of requestedKeys){
        prepared.push(await prepareDatasetFromStaging(
          batchId,
          key,
          TARGETS[key],
          Number(expected?.[key]||0)
        ));
      }

      assertPeriodCountConsistency(prepared);

      // If an entire requested 3-period family unexpectedly becomes empty
      // while the current monthly table is populated, preserve the last good
      // snapshot instead of silently replacing it with an empty dataset.
      const byDataset=new Map(prepared.map(x=>[x.dataset,x]));
      const familyMonthly=[
        ['leads','weekly_leads','monthly_leads'],
        ['opportunities','weekly_opportunities','monthly_opportunities'],
        ['calls','weekly_calls','monthly_calls'],
        ['tickets','weekly_tickets','monthly_tickets']
      ];
      for(const [dailyKey,weeklyKey,monthlyKey] of familyMonthly){
        const d=byDataset.get(dailyKey),w=byDataset.get(weeklyKey),m=byDataset.get(monthlyKey);
        if(!d||!w||!m||d.count||w.count||m.count) continue;
        const old=await tursoSelect(`SELECT COUNT(*) AS n FROM ${ident(TARGETS[monthlyKey])}`);
        if(Number(old?.[0]?.n||0)>0){
          throw new Error(`Refusing to replace non-empty ${monthlyKey} history with an all-zero CRM snapshot.`);
        }
      }

      const counts:any={};
      for(const p of prepared) counts[p.dataset]=p.count;
      const meta=await activityMetaForBatch(requestedKeys,counts,sourceCheckedAt,range);

      const tx:any[]=[{sql:'BEGIN IMMEDIATE'}];
      for(const p of prepared){
        const qt=ident(p.target),qs=ident(p.stage),cols=p.columns.map(ident).join(',');
        tx.push({sql:`DELETE FROM ${qt}`});
        tx.push({sql:`INSERT INTO ${qt}(${cols}) SELECT ${cols} FROM ${qs}`});
      }
      for(const [key,value] of meta.rows){
        if(!value && ['crm_activity_lead_opp_last_sync_at','crm_activity_calls_last_sync_at','crm_activity_tickets_last_sync_at'].includes(key)) continue;
        tx.push({
          sql:"INSERT INTO dashboard_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          args:[key,value]
        });
      }
      for(const p of prepared) tx.push({sql:`DROP TABLE ${ident(p.stage)}`});
      tx.push({sql:'COMMIT'});

      // One transaction replaces every table in this connector batch and its
      // metadata together. Any uniqueness/type error rolls the whole batch back.
      await tursoBatch(tx);

      await tursoBatch([{sql:`DELETE FROM ${ident(STAGING)} WHERE batch_id=?`,args:[batchId]}]);
      return {
        batchId,
        counts,
        lastSyncAt:meta.completeSyncAt,
        componentFinishedAt:meta.now,
        sourceCheckedAt:sourceCheckedAt||meta.now,
        range
      };
    }catch(e){
      await cleanupPrepared(prepared);
      throw e;
    }
  }

  const chunks=await tursoSelect(`SELECT dataset,seq,payload_json FROM ${ident(STAGING)} WHERE batch_id=? ORDER BY dataset,seq`,[batchId]);
  const grouped:Record<string,any[]>={leads:[],weekly_leads:[],monthly_leads:[],opportunities:[],weekly_opportunities:[],monthly_opportunities:[],calls:[],weekly_calls:[],monthly_calls:[],tickets:[],weekly_tickets:[],monthly_tickets:[]};
  for(const chunk of chunks){
    const dataset=String(chunk.dataset||'');
    if(!TARGETS[dataset]) continue;
    const parsed=JSON.parse(String(chunk.payload_json||'[]'));
    if(!Array.isArray(parsed)) throw new Error('Invalid CRM activity payload.');
    grouped[dataset].push(...parsed);
  }
  for(const key of requestedKeys){
    const want=Number(expected?.[key]||0);
    if(grouped[key].length!==want) throw new Error(`CRM activity row-count mismatch for ${key}: expected ${want}, received ${grouped[key].length}.`);
  }

  const teamRows=await tursoSelect('SELECT name FROM team_members');
  const team=new Set(teamRows.map((r:any)=>String(r.name||'').trim()).filter(Boolean));
  const filtered:Record<string,any[]>={};
  for(const key of requestedKeys){
    if(key==='opportunities'||key==='weekly_opportunities'||key==='monthly_opportunities'||key==='calls'||key==='weekly_calls'||key==='monthly_calls'||key==='tickets'||key==='weekly_tickets'||key==='monthly_tickets'){
      filtered[key]=grouped[key];
      continue;
    }
    const person=PERSON_FIELD[key];
    filtered[key]=grouped[key].filter(r=>team.has(String(r?.[person]||'').trim()));
  }

  const counts:any={};
  for(const key of requestedKeys) counts[key]=await replaceTarget(TARGETS[key],filtered[key]);

  const now=new Date().toISOString();
  await tursoBatch([
    {sql:"INSERT INTO dashboard_meta(key,value) VALUES('crm_activity_last_sync_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[now]},
    {sql:"INSERT INTO dashboard_meta(key,value) VALUES('crm_activity_source_checked_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[sourceCheckedAt||now]},
    {sql:"INSERT INTO dashboard_meta(key,value) VALUES('crm_activity_range_start',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[String(range?.start||'')]},
    {sql:"INSERT INTO dashboard_meta(key,value) VALUES('crm_activity_range_end',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[String(range?.end||'')]},
    {sql:"INSERT INTO dashboard_meta(key,value) VALUES('crm_activity_counts',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[JSON.stringify(counts)]},
    {sql:`DELETE FROM ${ident(STAGING)} WHERE batch_id=?`,args:[batchId]}
  ]);
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
