import postgres from 'npm:postgres@3.4.7';

export type DatabaseStatement={sql:string,args?:unknown[]};
export type TursoStatement=DatabaseStatement;

const connectionString=Deno.env.get('SUPABASE_DB_URL')||'';
if(!connectionString) throw new Error('SUPABASE_DB_URL is not configured.');

const sql=postgres(connectionString,{
  max:6,
  idle_timeout:12,
  connect_timeout:10,
  max_lifetime:90,
  prepare:false
});

function pgSql(input:string){
  if(/^\s*BEGIN\s+IMMEDIATE\s*$/i.test(input))return 'BEGIN';
  let out='',n=0,inQuote=false;
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(ch==="'"){
      out+=ch;
      if(inQuote&&input[i+1]=="'"){out+=input[++i];continue;}
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

  return await Promise.all(statements.map(s=>pgExec(sql,s)));
}

export function databaseProvider(){return 'Supabase';}

export async function tableColumns(table:string):Promise<string[]>{
  const r=await postgresBatch([{
    sql:"SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name=? ORDER BY ordinal_position",
    args:[table]
  }]);
  return (r[0]||[]).map((x:any)=>String(x.name));
}

export async function tursoBatch(statements:DatabaseStatement[]):Promise<any[][]>{
  return postgresBatch(statements);
}

export async function tursoSelect(query:string,args:unknown[]=[]):Promise<any[]>{
  return (await postgresBatch([{sql:query,args}]))[0]||[];
}
