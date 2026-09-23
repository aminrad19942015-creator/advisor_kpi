import { tursoBatch, tursoSelect } from './turso';

export type CrmAdminConfig={
  crmOrigin:string;
  apiVersion:string;
  schedules:{openLeads:string[];activity:string[]};
  openLeads:{entity:string;enabled:boolean};
  lead:{entity:string;enabled:boolean;dateField:string;businessUnits:string[];statuses:string[];ownerFromTeamMembers:boolean};
  opportunity:{entity:string;enabled:boolean;dateField:string;businessUnits:string[];businessUnitSource:string};
  calls:{entity:string;enabled:boolean;dateField:string;businessUnits:string[];businessUnitSource:string};
  ticket:{queueEntity:string;caseEntity:string;enabled:boolean;dateField:string;queues:string[];topics:string[];topicMatch:string;excludedStatuses:string[];customerRanks:string[]};
};

function parseConfig(value:any):CrmAdminConfig{
  if(value&&typeof value==='object') return value as CrmAdminConfig;
  return JSON.parse(String(value||'{}')) as CrmAdminConfig;
}

export async function getCrmAdminConfig():Promise<CrmAdminConfig>{
  const rows=await tursoSelect("SELECT config FROM crm_admin_config WHERE id='default' LIMIT 1");
  if(!rows.length) throw new Error('CRM admin config is not initialized.');
  return parseConfig(rows[0].config);
}

export async function saveCrmAdminConfig(config:CrmAdminConfig){
  const json=JSON.stringify(config);
  await tursoBatch([{
    sql:"INSERT INTO crm_admin_config(id,config,updated_at) VALUES('default',?::jsonb,now()) ON CONFLICT(id) DO UPDATE SET config=excluded.config,updated_at=now()",
    args:[json]
  }]);
  return getCrmAdminConfig();
}

export function validateCrmAdminConfig(config:any):CrmAdminConfig{
  if(!config||typeof config!=='object') throw new Error('تنظیمات CRM نامعتبر است.');
  const list=(v:any,name:string)=>{
    if(!Array.isArray(v)) throw new Error(name+' باید لیست باشد.');
    return v.map(x=>String(x).trim()).filter(Boolean);
  };
  const out:any=structuredClone(config);
  out.crmOrigin=String(out.crmOrigin||'').trim().replace(/\/$/,'');
  out.apiVersion=String(out.apiVersion||'').trim();
  if(!/^https:\/\//i.test(out.crmOrigin)) throw new Error('CRM Origin باید با https:// شروع شود.');
  if(!out.apiVersion) throw new Error('API Version خالی است.');
  out.schedules=out.schedules||{};
  out.schedules.openLeads=list(out.schedules.openLeads,'زمان‌های Open Leads');
  out.schedules.activity=list(out.schedules.activity,'زمان Activity');
  for(const key of ['lead','opportunity','calls'] as const){
    if(!out[key]||typeof out[key]!=='object') throw new Error('تنظیمات '+key+' ناقص است.');
    out[key].entity=String(out[key].entity||'').trim();
    out[key].dateField=String(out[key].dateField||'').trim();
    out[key].businessUnits=list(out[key].businessUnits,'واحدهای '+key);
    out[key].enabled=out[key].enabled!==false;
    out[key].sourceMode=String(out[key].sourceMode||'crm').toLowerCase()==='excel'?'excel':'crm';
  }
  out.lead.statuses=list(out.lead.statuses,'وضعیت‌های Lead');
  out.lead.ownerFromTeamMembers=out.lead.ownerFromTeamMembers!==false;
  out.opportunity.businessUnitSource=String(out.opportunity.businessUnitSource||'').trim();
  out.calls.businessUnitSource=String(out.calls.businessUnitSource||'').trim();
  if(!out.ticket||typeof out.ticket!=='object') throw new Error('تنظیمات Ticket ناقص است.');
  out.ticket.queueEntity=String(out.ticket.queueEntity||'').trim();
  out.ticket.caseEntity=String(out.ticket.caseEntity||'').trim();
  out.ticket.dateField=String(out.ticket.dateField||'').trim();
  out.ticket.queues=list(out.ticket.queues,'Queueهای Ticket');
  out.ticket.topics=list(out.ticket.topics,'موضوعات Ticket');
  out.ticket.excludedStatuses=list(out.ticket.excludedStatuses,'وضعیت‌های حذف‌شده Ticket');
  out.ticket.customerRanks=list(out.ticket.customerRanks,'رتبه‌های Ticket');
  out.ticket.topicMatch=String(out.ticket.topicMatch||'contact_or_main');
  out.ticket.enabled=out.ticket.enabled!==false;
  out.ticket.sourceMode=String(out.ticket.sourceMode||'crm').toLowerCase()==='excel'?'excel':'crm';
  out.openLeads=out.openLeads||{entity:'leads',enabled:true,sourceMode:'crm'};
  out.openLeads.entity=String(out.openLeads.entity||'leads').trim();
  out.openLeads.enabled=out.openLeads.enabled!==false;
  out.openLeads.sourceMode=String(out.openLeads.sourceMode||'crm').toLowerCase()==='excel'?'excel':'crm';
  return out as CrmAdminConfig;
}
