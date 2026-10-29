import {tursoSelect} from './turso';
import {operationalOpenLeadsSource} from './crm-shadow';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

// Only fields necessary for report math. No customer names, phone numbers,
// national IDs, descriptions, record IDs or actual lead numbers leave this function.
export async function getReportFacts(period:string){
 const prefix=({daily:'daily',weekly:'weekly',monthly:'monthly',reportMonth:'report_month'} as Record<string,string>)[period];
 if(!prefix)throw new Error('Invalid report period');
 const day=(column:string)=>`CASE WHEN NULLIF(${column},'') IS NOT NULL THEN ((${column})::timestamptz AT TIME ZONE 'Asia/Tehran')::date::text END`;
 const [members,leads,opps,calls,tickets]=await Promise.all([
  tursoSelect('SELECT name,team_lead AS "teamLead",senior_lead AS "seniorLead",team,role FROM team_members'),
  tursoSelect(`SELECT owner,lead_number,campaign,last_status,customer_rank,source,source_ticket_contact_topic,${day('last_modified_date')} AS day,CASE WHEN NULLIF(created_date,'') IS NOT NULL AND NULLIF(last_modified_date,'') IS NOT NULL AND last_modified_date::timestamptz>=created_date::timestamptz THEN EXTRACT(EPOCH FROM(last_modified_date::timestamptz-created_date::timestamptz))/86400.0 END AS close_days FROM ${prefix}_leads`),
  tursoSelect(`SELECT creator,lead_number,registration_type,status,${day('created_date')} AS day FROM ${prefix}_opportunities`),
  tursoSelect(`SELECT "user",lead_number,subject,queue,${day('start_date')} AS day FROM ${prefix}_calls`),
  tursoSelect(`SELECT owner,status_reason,COALESCE(NULLIF(contact_topic,''),NULLIF(main_subject,''),'') AS topic,${day('closed_at')} AS day FROM ${prefix}_tickets`)
 ]);
 const refs=new Map<string,number>();
 const ref=(value:any)=>{const key=String(value??'');if(!key)return 0;if(!refs.has(key))refs.set(key,refs.size+1);return refs.get(key);};
 return {schema:1,period,members,
  leads:leads.map((r:any)=>[r.owner,ref(r.lead_number),r.campaign,r.last_status,r.customer_rank,r.source,r.source_ticket_contact_topic,r.day,r.close_days===null?null:Number(r.close_days)]),
  opps:opps.map((r:any)=>[r.creator,ref(r.lead_number),r.registration_type,r.status,r.day]),
  calls:calls.map((r:any)=>[r.user,ref(r.lead_number),r.subject,r.queue,r.day]),
  tickets:tickets.map((r:any)=>[r.owner,r.status_reason,r.topic,r.day])};
}

export async function getOpenFacts(){
 const sourceStatus=await operationalOpenLeadsSource();
 if(!/^[_a-zA-Z0-9]+$/.test(sourceStatus.table))throw new Error('Invalid source');
 const [members,rows]=await Promise.all([
  tursoSelect('SELECT name,team_lead AS "teamLead",senior_lead AS "seniorLead",team,role,business_unit AS "businessUnit" FROM team_members'),
  tursoSelect(`SELECT owner,lead_type,customer_rank,campaign,source,last_status,next_call_reason,age_days,business_unit,source_software FROM ${sourceStatus.table}`)
 ]);
 return {members,sourceStatus,rows:rows.map((r:any)=>[r.owner,r.lead_type,r.customer_rank,r.campaign,r.source,r.last_status,r.next_call_reason,r.age_days===null?null:Number(r.age_days),r.business_unit,r.source_software])};
}

export async function getDashboardRevision(){
 const rows=await tursoSelect("SELECT key,value FROM dashboard_meta WHERE key LIKE 'crm_%' OR key IN ('admin_revision','last_sync_at','data_version') ORDER BY key");
 return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

export async function getInteractiveData(){
 const before=await getDashboardRevision();
 const periods:Record<string,unknown>={};
 // Bound query concurrency to avoid disturbing connector writes.
 for(const period of ['daily','weekly','monthly','reportMonth'])periods[period]=await getReportFacts(period);
 const open=await getOpenFacts();
 const after=await getDashboardRevision();
 if(before!==after)throw new Error('Data changed while building the interactive snapshot; retry.');
 return {revision:after,encoding:'gzip-base64',body:gzipSync(JSON.stringify({periods,open}),{level:6}).toString('base64')};
}
