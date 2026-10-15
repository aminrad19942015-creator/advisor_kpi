import { tursoSelect } from './turso.ts';
import { operationalOpenLeadsSource } from './crm-shadow.ts';

const norm=(v:any)=>!v?[]:(Array.isArray(v)?v:[v]).filter(Boolean);
function sqlIn(column:string,values:any[],args:any[]){
 if(!values.length)return '';
 return ` AND ${column} IN (${values.map(v=>{args.push(v);return '?'}).join(',')})`;
}
function applyOpenFilters(filters:any,args:any[]){
 filters=filters||{};
 let where=' WHERE 1=1';
 where+=sqlIn('o.owner',norm(filters.advisor),args);
 where+=sqlIn('t.senior_lead',norm(filters.seniorLead),args);
 where+=sqlIn('t.role',norm(filters.role),args);
 where+=sqlIn('t.team',norm(filters.team),args);
 where+=sqlIn('t.business_unit',norm(filters.personUnit),args);
 where+=sqlIn('o.lead_type',norm(filters.leadType),args);
 where+=sqlIn('o.customer_rank',norm(filters.customerRank),args);
 where+=sqlIn('o.campaign',norm(filters.campaign),args);
 where+=sqlIn('o.last_status',norm(filters.lastStatus),args);
 where+=sqlIn('o.source',norm(filters.source),args);

 const reasons=norm(filters.nextCallReason);
 if(reasons.length){
  const hasBlank=reasons.includes('بدون تسک');
  const normal=reasons.filter((x:any)=>x!=='بدون تسک');
  const parts:string[]=[];
  if(normal.length){
   const qs=normal.map((v:any)=>{args.push(v);return '?'}).join(',');
   parts.push(`o.next_call_reason IN (${qs})`);
  }
  if(hasBlank)parts.push("TRIM(COALESCE(o.next_call_reason,''))=''");
  if(parts.length)where+=' AND ('+parts.join(' OR ')+')';
 }

 const age=String(filters.age||'');
 if(age==='0-3')where+=' AND o.age_days BETWEEN 0 AND 3';
 if(age==='4-7')where+=' AND o.age_days BETWEEN 4 AND 7';
 if(age==='8-14')where+=' AND o.age_days BETWEEN 8 AND 14';
 if(age==='15-30')where+=' AND o.age_days BETWEEN 15 AND 30';
 if(age==='31+')where+=' AND o.age_days >= 31';

 return where;
}

export async function getOpenLeadDetails(field:string,value:string,filters:any={}){
 if(typeof value==='string'&&value.startsWith('__OPEN_FILTERS_V2__')){
  try{
   const envelope=JSON.parse(value.slice('__OPEN_FILTERS_V2__'.length));
   value=String(envelope?.value??'');
   filters=envelope?.filters||filters||{};
  }catch{
   throw new Error('پارامتر جزئیات سرنخ نامعتبر است.');
  }
 }
 const openSource=await operationalOpenLeadsSource();const openTable=openSource.table;
 const allowed:Record<string,string>={
  leadType:'lead_type',
  nextCallReason:'next_call_reason',
  customerRank:'customer_rank',
  campaign:'campaign',
  source:'source',
  sourceSoftware:'source_software',
  lastStatus:'last_status',
  businessUnit:'business_unit',
  owner:'owner'
 };
 const column=allowed[field];
 if(!column)throw new Error('فیلد نامعتبر: '+field);

 const args:any[]=[];
 let where=applyOpenFilters(filters,args);
 let actual=value;
 if(field==='nextCallReason'&&value==='بدون تسک')actual='';
 if(value==='بدون مقدار')actual='';

 if(actual===''){
  where+=` AND TRIM(COALESCE(o.${column},''))=''`;
 }else{
  where+=` AND o.${column}=?`;
  args.push(actual);
 }

 return tursoSelect((`SELECT
   o.lead_number AS "leadNumber",
   o.created_date AS "createdDate",
   o.age_days AS "ageDays",
   o.customer_rank AS "customerRank",
   o.last_status AS "lastStatus",
   o.next_call_reason AS "nextCallReason",
   o.customer_name AS "customerName",
   t.name AS owner,
   o.lead_type AS "leadType",
   o.source,
   o.campaign,
   o.source_software AS "sourceSoftware",
   o.business_unit AS "businessUnit"
  FROM open_leads o
  INNER JOIN team_members t ON t.name=o.owner
  ${where}
  ORDER BY o.age_days DESC
  LIMIT 3000`).replaceAll('open_leads',openTable),args);
}
