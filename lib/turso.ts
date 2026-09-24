import postgres from 'postgres';

/**
 * Supabase/PostgreSQL database adapter.
 *
 * The legacy export names tursoSelect/tursoBatch are intentionally kept as
 * compatibility aliases so the already-tested dashboard modules do not need a
 * risky mass rename during the final migration. There is no Turso network
 * fallback or Turso credential path anymore.
 */
export type DatabaseStatement={sql:string,args?:unknown[]};
export type TursoStatement=DatabaseStatement;

function pgClient(){
 const url=process.env.SUPABASE_DATABASE_URL;
 if(!url) throw new Error('SUPABASE_DATABASE_URL is not configured.');
 return postgres(url,{max:1,idle_timeout:5,connect_timeout:10,max_lifetime:60,prepare:false});
}

function pgSql(input:string){
 if(/^\s*BEGIN\s+IMMEDIATE\s*$/i.test(input))return 'BEGIN';
 let out='',n=0,inQuote=false;
 for(let i=0;i<input.length;i++){
  const ch=input[i];
  if(ch==="'"){
   out+=ch;
   if(inQuote&&input[i+1]==="'"){out+=input[++i];continue;}
   inQuote=!inQuote;
   continue;
  }
  if(ch==='?'&&!inQuote){out+='$'+(++n);continue;}
  out+=ch;
 }
 return out;
}

async function pgExec(client:any,statement:DatabaseStatement):Promise<any[]>{
 const result:any=await client.unsafe(pgSql(statement.sql),(statement.args||[]) as any[]);
 return Array.from(result as any) as any[];
}

async function postgresBatch(statements:DatabaseStatement[]):Promise<any[][]>{
 const sql=pgClient();
 try{
  const explicit=statements.length>=2 &&
   /^\s*BEGIN(?:\s+IMMEDIATE)?\s*$/i.test(statements[0].sql) &&
   /^\s*COMMIT\s*$/i.test(statements[statements.length-1].sql);
  if(explicit){
   return await sql.begin(async (tx:any)=>{
    const out:any[]=[[]];
    for(const s of statements.slice(1,-1))out.push(await pgExec(tx,s));
    out.push([]);
    return out;
   });
  }
  const out:any[][]=[];
  for(const s of statements)out.push(await pgExec(sql,s));
  return out;
 }finally{
  await sql.end({timeout:1}).catch(()=>{});
 }
}

export function databaseProvider(){return 'Supabase';}

export async function tableColumns(table:string):Promise<string[]>{
 const r=await postgresBatch([{
  sql:"SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name=? ORDER BY ordinal_position",
  args:[table]
 }]);
 return (r[0]||[]).map((x:any)=>String(x.name));
}

// Compatibility aliases used throughout the migrated dashboard.
export async function tursoBatch(statements:DatabaseStatement[]):Promise<any[][]>{
 return postgresBatch(statements);
}
export async function tursoSelect(sql:string,args:unknown[]=[]):Promise<any[]>{
 return (await postgresBatch([{sql,args}]))[0]||[];
}
