import { tursoBatch, tursoSelect } from './turso';

const pairs=(rows:any[],k:string,c:string)=>(rows||[]).map(r=>[r[k]||'بدون مقدار',Number(r[c]||0)]);
const first=(rows:any[])=>(rows&&rows.length?rows[0]:{});
const norm=(v:any)=>!v?[]:(Array.isArray(v)?v:[v]).filter(Boolean);
function sqlIn(column:string,values:any[],args:any[]){if(!values.length)return '';const qs=values.map(v=>{args.push(v);return '?'}).join(',');return ` AND ${column} IN (${qs})`;}

export async function getMeta(){
 const [v,s]=await Promise.all([
  tursoSelect("SELECT value FROM dashboard_meta WHERE key='data_version' LIMIT 1").catch(()=>[]),
  tursoSelect("SELECT value FROM dashboard_meta WHERE key='last_sync_at' LIMIT 1").catch(()=>[])
 ]);
 return {source:'Turso',dataVersion:v?.[0]?.value||'legacy',lastSyncAt:s?.[0]?.value||'',generatedAt:new Date().toISOString()};
}

export async function getTeamSummary(filters:any={}){
 const args:any[]=[];let where=' WHERE 1=1';
 if(filters.search){where+=' AND name LIKE ?';args.push('%'+filters.search+'%');}
 where+=sqlIn('team_lead',norm(filters.teamLead),args);
 where+=sqlIn('team',norm(filters.team),args);
 where+=sqlIn('gender',norm(filters.gender),args);
 where+=sqlIn('role',norm(filters.role),args);
 where+=sqlIn('business_unit',norm(filters.businessUnit),args);
 const [rows]=await tursoBatch([{sql:`SELECT name,personnel_code AS personnelCode,email,team_lead AS teamLead,team,gender,role,business_unit AS businessUnit FROM team_members ${where} ORDER BY name`,args}]);
 const countPairs=(field:string)=>{const m:any={};for(const r of rows){const k=r[field]||'بدون مقدار';m[k]=(m[k]||0)+1}return Object.keys(m).map(k=>[k,m[k]]).sort((a:any,b:any)=>b[1]-a[1])};
 return {rows,kpis:{total:rows.length,teamLeads:rows.filter((x:any)=>x.role==='تیم لید').length,teams:new Set(rows.map((x:any)=>x.team).filter(Boolean)).size,advisors:rows.filter((x:any)=>String(x.role||'').includes('مشاور')||String(x.role||'').includes('راهنما')).length,women:rows.filter((x:any)=>x.gender==='خانم').length},roleCounts:countPairs('role'),unitCounts:countPairs('businessUnit')};
}

export async function getTeamFilterOptions(){
 const [members,...res]=await Promise.all([
  tursoSelect("SELECT name,team_lead AS teamLead,team,gender,role,business_unit AS businessUnit FROM team_members ORDER BY name"),
  ...['team_lead','team','gender','role','business_unit','name'].map(c=>tursoSelect(`SELECT DISTINCT ${c} value FROM team_members WHERE COALESCE(${c},'')<>'' ORDER BY value`))
 ]);
 const vals=(x:any[])=>x.map(r=>r.value);
 return {members,teamLead:vals(res[0]),team:vals(res[1]),gender:vals(res[2]),role:vals(res[3]),businessUnit:vals(res[4]),advisor:vals(res[5])};
}

export async function getOpenFilterOptions(){
 const q=[
  "SELECT DISTINCT owner value FROM open_leads WHERE COALESCE(owner,'')<>'' AND owner IN (SELECT name FROM team_members) ORDER BY value",
  "SELECT DISTINCT role value FROM team_members WHERE COALESCE(role,'')<>'' ORDER BY value",
  "SELECT DISTINCT team value FROM team_members WHERE COALESCE(team,'')<>'' ORDER BY value",
  "SELECT DISTINCT business_unit value FROM team_members WHERE COALESCE(business_unit,'')<>'' ORDER BY value",
  "SELECT DISTINCT lead_type value FROM open_leads WHERE COALESCE(lead_type,'')<>'' ORDER BY value",
  "SELECT DISTINCT next_call_reason value FROM open_leads WHERE COALESCE(next_call_reason,'')<>'' ORDER BY value",
  "SELECT DISTINCT customer_rank value FROM open_leads WHERE COALESCE(customer_rank,'')<>'' ORDER BY value",
  "SELECT DISTINCT campaign value FROM open_leads WHERE COALESCE(campaign,'')<>'' ORDER BY value",
  "SELECT DISTINCT source value FROM open_leads WHERE COALESCE(source,'')<>'' ORDER BY value",
  "SELECT DISTINCT last_status value FROM open_leads WHERE COALESCE(last_status,'')<>'' ORDER BY value"
 ];
 const r=await Promise.all(q.map(sql=>tursoSelect(sql)));const v=(i:number)=>r[i].map((x:any)=>x.value);
 const campaigns=v(7);const pinned=['Ayar','LeadAdvice'];const orderedCampaigns=[...pinned.filter(x=>campaigns.includes(x)),...campaigns.filter(x=>!pinned.includes(x))];
 return {advisor:v(0),role:v(1),team:v(2),personUnit:v(3),leadType:v(4),nextCallReason:['بدون تسک',...v(5)],customerRank:v(6),campaign:orderedCampaigns,source:v(8),lastStatus:v(9)};
}

export async function getOpenSummary(filters:any={}){
 const allArgs:any[]=[];let allWhere=' WHERE 1=1';
 allWhere+=sqlIn('o.owner',norm(filters.advisor),allArgs);
 allWhere+=sqlIn('o.lead_type',norm(filters.leadType),allArgs);
 allWhere+=sqlIn('o.customer_rank',norm(filters.customerRank),allArgs);
 allWhere+=sqlIn('o.campaign',norm(filters.campaign),allArgs);
 allWhere+=sqlIn('o.last_status',norm(filters.lastStatus),allArgs);
 allWhere+=sqlIn('o.source',norm(filters.source),allArgs);
 const roles=norm(filters.role),teams=norm(filters.team),personUnits=norm(filters.personUnit);
 if(roles.length||teams.length||personUnits.length){const pArgs:any[]=[];let pSql='SELECT name FROM team_members WHERE 1=1';pSql+=sqlIn('role',roles,pArgs);pSql+=sqlIn('team',teams,pArgs);pSql+=sqlIn('business_unit',personUnits,pArgs);allWhere+=` AND o.owner IN (${pSql})`;allArgs.push(...pArgs)}
 const reasons=norm(filters.nextCallReason);
 if(reasons.length){const hasBlank=reasons.includes('بدون تسک');const normal=reasons.filter((x:any)=>x!=='بدون تسک');const parts:string[]=[];if(normal.length){const qs=normal.map((v:any)=>{allArgs.push(v);return '?'}).join(',');parts.push(`o.next_call_reason IN (${qs})`)}if(hasBlank)parts.push("TRIM(COALESCE(o.next_call_reason,''))=''");if(parts.length)allWhere+=' AND ('+parts.join(' OR ')+')'}
 const age=filters.age||'';if(age==='0-3')allWhere+=' AND o.age_days BETWEEN 0 AND 3';if(age==='4-7')allWhere+=' AND o.age_days BETWEEN 4 AND 7';if(age==='8-14')allWhere+=' AND o.age_days BETWEEN 8 AND 14';if(age==='15-30')allWhere+=' AND o.age_days BETWEEN 15 AND 30';if(age==='31+')allWhere+=' AND o.age_days >= 31';
 const args:any[]=[];let join=' FROM open_leads o INNER JOIN team_members t ON t.name=o.owner WHERE 1=1';
 join+=sqlIn('o.owner',norm(filters.advisor),args);join+=sqlIn('t.role',roles,args);join+=sqlIn('t.team',teams,args);join+=sqlIn('t.business_unit',personUnits,args);join+=sqlIn('o.lead_type',norm(filters.leadType),args);join+=sqlIn('o.customer_rank',norm(filters.customerRank),args);join+=sqlIn('o.campaign',norm(filters.campaign),args);join+=sqlIn('o.last_status',norm(filters.lastStatus),args);join+=sqlIn('o.source',norm(filters.source),args);
 if(reasons.length){const hasBlank=reasons.includes('بدون تسک');const normal=reasons.filter((x:any)=>x!=='بدون تسک');const parts:string[]=[];if(normal.length){const qs=normal.map((v:any)=>{args.push(v);return '?'}).join(',');parts.push(`o.next_call_reason IN (${qs})`)}if(hasBlank)parts.push("TRIM(COALESCE(o.next_call_reason,''))=''");if(parts.length)join+=' AND ('+parts.join(' OR ')+')'}
 if(age==='0-3')join+=' AND o.age_days BETWEEN 0 AND 3';if(age==='4-7')join+=' AND o.age_days BETWEEN 4 AND 7';if(age==='8-14')join+=' AND o.age_days BETWEEN 8 AND 14';if(age==='15-30')join+=' AND o.age_days BETWEEN 15 AND 30';if(age==='31+')join+=' AND o.age_days >= 31';
 const stmts:any[]=[
  {sql:`SELECT COUNT(*) AS allTotal,SUM(CASE WHEN TRIM(COALESCE(o.business_unit,''))='' THEN 1 ELSE 0 END) AS unassigned FROM open_leads o ${allWhere}`,args:allArgs},
  {sql:`SELECT COUNT(*) AS total,COUNT(DISTINCT o.owner) AS owners,MAX(o.age_days) AS oldest,SUM(CASE WHEN TRIM(COALESCE(o.lead_type,''))='حقیقی' AND o.age_days BETWEEN 15 AND 18 THEN 1 ELSE 0 END) AS nearDeadlineReal,SUM(CASE WHEN TRIM(COALESCE(o.lead_type,''))='حقوقی' AND o.age_days BETWEEN 57 AND 60 THEN 1 ELSE 0 END) AS nearDeadlineLegal ${join}`,args},
  {sql:`SELECT o.owner AS name,COALESCE(t.role,'') role,COALESCE(t.team_lead,'') teamLead,COALESCE(t.team,'') team,COUNT(*) count,MAX(o.age_days) oldest,SUM(CASE WHEN TRIM(COALESCE(o.lead_type,''))='حقیقی' AND o.age_days BETWEEN 15 AND 18 THEN 1 ELSE 0 END) AS nearDeadlineReal,SUM(CASE WHEN TRIM(COALESCE(o.lead_type,''))='حقوقی' AND o.age_days BETWEEN 57 AND 60 THEN 1 ELSE 0 END) AS nearDeadlineLegal ${join} GROUP BY o.owner,t.role,t.team_lead,t.team ORDER BY count DESC`,args}
 ];
 const dims:[string,string,string?][]=[['businessUnit','o.business_unit'],['leadType','o.lead_type'],['nextCallReason','o.next_call_reason','بدون تسک'],['customerRank','o.customer_rank'],['campaign','o.campaign'],['source','o.source'],['sourceSoftware','o.source_software'],['lastStatus','o.last_status']];
 for(const [,col,blank] of dims)stmts.push({sql:`SELECT COALESCE(NULLIF(${col},''),?) label,COUNT(*) count ${join} GROUP BY label ORDER BY count DESC`,args:[blank||'بدون مقدار',...args]});
 const r=await tursoBatch(stmts);
 const dimensions:any={};dims.forEach((d,i)=>dimensions[d[0]]=pairs(r[3+i],'label','count'));
 return {kpis:{...first(r[1]),...first(r[0])},advisors:r[2],dimensions};
}

export async function getOpenNearDeadlineDetails(leadType:string,owner:string,filters:any={}){
 if(!['حقیقی','حقوقی'].includes(leadType))throw new Error('نوع لید برای سررسید نامعتبر است.');
 const min=leadType==='حقیقی'?15:57,max=leadType==='حقیقی'?18:60,args:any[]=[leadType,min,max];
 let where=" WHERE TRIM(COALESCE(o.lead_type,''))=? AND o.age_days BETWEEN ? AND ?";
 if(owner){where+=' AND o.owner=?';args.push(owner)}
 where+=sqlIn('o.owner',norm(filters.advisor),args);where+=sqlIn('o.lead_type',norm(filters.leadType),args);where+=sqlIn('o.customer_rank',norm(filters.customerRank),args);where+=sqlIn('o.campaign',norm(filters.campaign),args);where+=sqlIn('o.last_status',norm(filters.lastStatus),args);where+=sqlIn('o.source',norm(filters.source),args);
 return tursoSelect(`SELECT o.lead_number AS leadNumber,o.created_date AS createdDate,o.age_days AS ageDays,CASE WHEN TRIM(COALESCE(o.lead_type,''))='حقیقی' THEN 18-o.age_days WHEN TRIM(COALESCE(o.lead_type,''))='حقوقی' THEN 60-o.age_days END AS remainingDays,o.customer_rank AS customerRank,o.last_status AS lastStatus,o.next_call_reason AS nextCallReason,o.customer_name AS customerName,o.owner,o.lead_type AS leadType,o.source,o.campaign,o.source_software AS sourceSoftware,o.business_unit AS businessUnit FROM open_leads o ${where} ORDER BY remainingDays ASC,o.age_days DESC,o.owner LIMIT 4000`,args);
}
