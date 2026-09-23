import postgres from 'postgres';

export type TursoStatement={sql:string,args?:unknown[]};

const usePostgres=()=>Boolean(process.env.SUPABASE_DATABASE_URL);

function tursoConfig(){
 const raw=process.env.TURSO_DATABASE_URL;
 const token=process.env.TURSO_AUTH_TOKEN;
 if(!raw) throw new Error('TURSO_DATABASE_URL is not configured.');
 if(!token) throw new Error('TURSO_AUTH_TOKEN is not configured.');
 return {url:raw.replace(/^libsql:\/\//,'https://').replace(/\/$/,'')+'/v2/pipeline',token};
}
function arg(v:unknown){
 if(v===null||v===undefined)return {type:'null'};
 if(typeof v==='number'&&Number.isFinite(v))return Number.isInteger(v)?{type:'integer',value:String(v)}:{type:'float',value:v};
 return {type:'text',value:String(v)};
}
function cell(c:any){if(!c||c.type==='null')return null;if(c.type==='integer'||c.type==='float')return Number(c.value);return c.value;}
function rows(item:any){const d=item?.response?.result;if(!d)return [];const cols=(d.cols||[]).map((c:any)=>c.name);return (d.rows||[]).map((r:any[])=>Object.fromEntries(cols.map((n:string,i:number)=>[n,cell(r[i])])));}

let pg:any;
function pgClient(){
 if(!pg){
  const url=process.env.SUPABASE_DATABASE_URL;
  if(!url) throw new Error('SUPABASE_DATABASE_URL is not configured.');
  pg=postgres(url,{max:3,idle_timeout:20,connect_timeout:20,prepare:false});
 }
 return pg;
}
function pgSql(input:string){
 if(/^\s*BEGIN\s+IMMEDIATE\s*$/i.test(input))return 'BEGIN';
 let out='',n=0,inQuote=false;
 for(let i=0;i<input.length;i++){
  const ch=input[i];
  if(ch==="'"){
   out+=ch;
   if(inQuote&&input[i+1]==="'"){out+=input[++i];continue;}
   inQuote=!inQuote;continue;
  }
  if(ch==='?'&&!inQuote){out+='$'+(++n);continue;}
  out+=ch;
 }
 return out;
}
async function pgExec(client:any,statement:TursoStatement){
 const result=await client.unsafe(pgSql(statement.sql),(statement.args||[]) as any[]);
 return Array.from(result as any);
}
async function postgresBatch(statements:TursoStatement[]){
 const sql=pgClient();
 const explicit=statements.length>=2 && /^\s*BEGIN(?:\s+IMMEDIATE)?\s*$/i.test(statements[0].sql) && /^\s*COMMIT\s*$/i.test(statements[statements.length-1].sql);
 if(explicit){
  return sql.begin(async (tx:any)=>{
   const out:any[]=[[]];
   for(const s of statements.slice(1,-1))out.push(await pgExec(tx,s));
   out.push([]);
   return out;
  });
 }
 const out:any[]=[];
 for(const s of statements)out.push(await pgExec(sql,s));
 return out;
}

export function databaseProvider(){return usePostgres()?'Supabase':'Turso';}

export async function tableColumns(table:string):Promise<string[]>{
 if(usePostgres()){
  const r=await postgresBatch([{sql:"SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name=? ORDER BY ordinal_position",args:[table]}]);
  return (r[0]||[]).map((x:any)=>String(x.name));
 }
 const r=await tursoSelect('PRAGMA table_info("'+table.replace(/"/g,'')+'")');
 return (r||[]).map((x:any)=>String(x.name));
}

export async function tursoBatch(statements:TursoStatement[]){
 if(usePostgres())return postgresBatch(statements);
 const c=tursoConfig();
 const requests:any[]=statements.map(s=>({type:'execute',stmt:{sql:s.sql,args:(s.args||[]).map(arg)}}));requests.push({type:'close'});
 const response=await fetch(c.url,{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify({requests}),cache:'no-store'});
 const text=await response.text();if(!response.ok)throw new Error('Turso HTTP '+response.status+': '+text);
 const parsed=JSON.parse(text);const bad=(parsed.results||[]).find((r:any)=>r.type==='error');if(bad)throw new Error('Turso query error: '+JSON.stringify(bad));
 return statements.map((_,i)=>rows(parsed.results[i]));
}
export async function tursoSelect(sql:string,args:unknown[]=[]){return (await tursoBatch([{sql,args}]))[0];}
