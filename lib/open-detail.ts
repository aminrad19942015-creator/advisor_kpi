import { tursoSelect } from './turso';
import { operationalOpenLeadsSource } from './crm-shadow';

export async function getOpenLeadDetails(field:string,value:string){
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
 let actual=value;
 if(field==='nextCallReason'&&value==='بدون تسک')actual='';
 if(value==='بدون مقدار')actual='';
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
  LEFT JOIN team_members t ON t.name=o.owner
  WHERE COALESCE(o.${column},'')=?
  ORDER BY o.age_days DESC
  LIMIT 3000`).replaceAll('open_leads',openTable),[actual]);
}
