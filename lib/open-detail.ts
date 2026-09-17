import { tursoSelect } from './turso';

export async function getOpenLeadDetails(field:string,value:string){
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
 let actual=value;
 if(field==='nextCallReason'&&value==='بدون تسک')actual='';
 if(value==='بدون مقدار')actual='';
 return tursoSelect(`SELECT
   lead_number AS leadNumber,
   created_date AS createdDate,
   age_days AS ageDays,
   customer_rank AS customerRank,
   last_status AS lastStatus,
   next_call_reason AS nextCallReason,
   customer_name AS customerName,
   owner,
   lead_type AS leadType,
   source,
   campaign,
   source_software AS sourceSoftware,
   business_unit AS businessUnit
  FROM open_leads
  WHERE COALESCE(${column},'')=?
  ORDER BY age_days DESC
  LIMIT 3000`,[actual]);
}
