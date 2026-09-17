import { tursoSelect } from './turso';

export type InspectResult={file:string;dataset:string;target:string;sheet:string;rows:number;columns:string[];mode:string};

const CRITICAL:Record<string,string[]>={
 team_members:['name','personnel_code','team_lead','team','gender','role','business_unit'],
 open_leads:['lead_number','created_date','last_status','owner','lead_type','age_days'],
 daily_leads:['lead_number','created_date','last_modified_date','last_status','owner'],
 weekly_leads:['lead_number','created_date','last_modified_date','last_status','owner'],
 monthly_leads:['lead_number','created_date','last_modified_date','last_status','owner'],
 daily_opportunities:['title','created_date','status','creator','owner','registration_type'],
 weekly_opportunities:['title','created_date','status','creator','owner','registration_type'],
 monthly_opportunities:['title','created_date','status','creator','owner','registration_type'],
 daily_calls:['subject','user','queue','start_date'],
 weekly_calls:['subject','user','queue','start_date'],
 monthly_calls:['subject','user','queue','start_date'],
 daily_tickets:['owner','contact_topic','status_reason','closed_at'],
 weekly_tickets:['owner','contact_topic','status_reason','closed_at'],
 monthly_tickets:['owner','contact_topic','status_reason','closed_at']
};

export async function preflightImport(x:InspectResult){
 const countRows=await tursoSelect(`SELECT COUNT(*) AS n FROM "${x.target}"`);
 const currentRows=Number(countRows?.[0]?.n||0);
 const critical=CRITICAL[x.target]||[];
 const mapped=new Set(x.columns||[]);
 const missingCritical=critical.filter(c=>!mapped.has(c));
 const change=x.rows-currentRows;
 const changePct=currentRows?Math.round((change/currentRows)*1000)/10:null;
 const warnings:string[]=[];
 if(x.rows===0)warnings.push('فایل جدید هیچ ردیف داده‌ای ندارد و در صورت تأیید Dataset را خالی می‌کند.');
 if(currentRows>0&&x.rows<currentRows*0.5)warnings.push('تعداد ردیف فایل جدید کمتر از نصف دیتای فعلی است؛ قبل از Replace بررسی شود.');
 if(currentRows>0&&x.rows>currentRows*2)warnings.push('تعداد ردیف فایل جدید بیش از دو برابر دیتای فعلی است؛ قبل از Replace بررسی شود.');
 if(missingCritical.length)warnings.push('ستون‌های حیاتی نگاشت نشده‌اند: '+missingCritical.join('، '));
 return {...x,currentRows,newRows:x.rows,change,changePct,criticalColumns:critical,mappedColumns:x.columns||[],missingCritical,warnings,preflightOk:missingCritical.length===0};
}
