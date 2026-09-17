export type TursoStatement={sql:string,args?:unknown[]};

function config(){
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
export async function tursoBatch(statements:TursoStatement[]){
 const c=config();
 const requests:any[]=statements.map(s=>({type:'execute',stmt:{sql:s.sql,args:(s.args||[]).map(arg)}}));requests.push({type:'close'});
 const response=await fetch(c.url,{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify({requests}),cache:'no-store'});
 const text=await response.text();if(!response.ok)throw new Error('Turso HTTP '+response.status+': '+text);
 const parsed=JSON.parse(text);const bad=(parsed.results||[]).find((r:any)=>r.type==='error');if(bad)throw new Error('Turso query error: '+JSON.stringify(bad));
 return statements.map((_,i)=>rows(parsed.results[i]));
}
export async function tursoSelect(sql:string,args:unknown[]=[]){return (await tursoBatch([{sql,args}]))[0];}
