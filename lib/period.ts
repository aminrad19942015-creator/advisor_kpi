import { tursoBatch, tursoSelect, type TursoStatement } from './turso';

const TALKED_EXCLUDED_SQL = "('تماس تکراری','عدم پاسخ (2 بار)','عدم پاسخ(2 بار)','عدم تعیین وضعیت در زمان مقرر')";
const norm=(v:any)=>!v?[]:(Array.isArray(v)?v:[v]).filter(Boolean);
const first=(rows:any[])=>rows?.[0]||{};
const pairs=(rows:any[],k='label',c='count')=>(rows||[]).map(r=>[r[k]||'بدون مقدار',Number(r[c]||0)]);
function sqlIn(column:string,values:any[],args:any[]){if(!values.length)return '';return ` AND ${column} IN (${values.map(v=>{args.push(v);return '?'}).join(',')})`;}
function table(period:string,type:'lead'|'opp'|'call'|'ticket'){
 const p=period==='daily'?'daily_':period==='weekly'?'weekly_':period==='monthly'?'monthly_':'';
 if(!p)throw new Error('بازه نامعتبر: '+period);
 return p+({lead:'leads',opp:'opportunities',call:'calls',ticket:'tickets'} as const)[type];
}
function whereFor(filters:any,source:'lead'|'opp'|'call'|'ticket'){
 filters=filters||{};const args:any[]=[];const person=source==='lead'?'owner':source==='opp'?'creator':source==='call'?'user':'owner';let where=' WHERE 1=1';
 const advisors=norm(filters.advisor);if(advisors.length)where+=sqlIn(person,advisors,args);
 const campaigns=norm(filters.campaign);
 if(campaigns.length && source==='lead') where+=sqlIn('campaign',campaigns,args);
 const leads=norm(filters.teamLead),teams=norm(filters.team),roles=norm(filters.role);
 if(leads.length||teams.length||roles.length){const subArgs:any[]=[];let sub='SELECT name FROM team_members WHERE 1=1';sub+=sqlIn('team_lead',leads,subArgs);sub+=sqlIn('team',teams,subArgs);sub+=sqlIn('role',roles,subArgs);where+=` AND ${person} IN (${sub})`;args.push(...subArgs);}
 return {where,args};
}
async function namedBatch(items:Array<TursoStatement&{key:string}>){const rows=await tursoBatch(items.map(({sql,args})=>({sql,args})));return Object.fromEntries(items.map((x,i)=>[x.key,rows[i]]));}

export async function getPeriodCampaignOptions(period:string){
 const L=table(period,'lead');
 const rows=await tursoSelect(`SELECT DISTINCT TRIM(campaign) campaign FROM ${L} WHERE TRIM(COALESCE(campaign,''))<>'' ORDER BY campaign`);
 return rows.map((r:any)=>r.campaign).filter(Boolean);
}

export async function getFilteredPeriodSummary(period:string,filters:any={}){
 const L=table(period,'lead'),O=table(period,'opp'),C=table(period,'call'),T=table(period,'ticket');
 const lw=whereFor(filters,'lead'),ow=whereFor(filters,'opp'),cw=whereFor(filters,'call'),tw=whereFor(filters,'ticket');
 const q:any=await namedBatch([
  {key:'leadKpi',sql:`SELECT COUNT(*) closed,SUM(CASE WHEN COALESCE(last_status,'') NOT IN ${TALKED_EXCLUDED_SQL} THEN 1 ELSE 0 END) talked,AVG(CASE WHEN created_date<>'' AND last_modified_date<>'' AND julianday(last_modified_date)>=julianday(created_date) THEN julianday(last_modified_date)-julianday(created_date) END) closeAvg FROM ${L}${lw.where}`,args:lw.args},
  {key:'oppKpi',sql:`SELECT SUM(CASE WHEN registration_type='LEAD' THEN 1 ELSE 0 END) oppLead,SUM(CASE WHEN registration_type='OPP' THEN 1 ELSE 0 END) opp FROM ${O}${ow.where}`,args:ow.args},
  {key:'callKpi',sql:`SELECT COUNT(*) calls,SUM(CASE WHEN UPPER(COALESCE(queue,''))='T8' THEN 1 ELSE 0 END) t8,COUNT(DISTINCT CASE WHEN COALESCE(lead_number,'')<>'' THEN user||'|'||lead_number END) uniqueCalls FROM ${C}${cw.where}`,args:cw.args},
  {key:'repeatCalls',sql:`SELECT COALESCE(SUM(n-1),0) repeatCalls FROM (SELECT COUNT(*) n FROM ${C}${cw.where} AND COALESCE(lead_number,'')<>'' GROUP BY user,lead_number HAVING COUNT(*)>1)`,args:cw.args},
  {key:'ticketKpi',sql:`SELECT COUNT(*) tickets FROM ${T}${tw.where}`,args:tw.args},
  {key:'days',sql:`SELECT day FROM (SELECT date(last_modified_date) day FROM ${L}${lw.where} AND last_modified_date<>'' UNION SELECT date(created_date) day FROM ${O}${ow.where} AND created_date<>'' UNION SELECT date(start_date) day FROM ${C}${cw.where} AND start_date<>'' UNION SELECT date(closed_at) day FROM ${T}${tw.where} AND closed_at<>'') WHERE day IS NOT NULL ORDER BY day`,args:[...lw.args,...ow.args,...cw.args,...tw.args]},
  {key:'leadByAdvisor',sql:`SELECT owner name,COUNT(*) leads,SUM(CASE WHEN COALESCE(last_status,'') NOT IN ${TALKED_EXCLUDED_SQL} THEN 1 ELSE 0 END) talked FROM ${L}${lw.where} AND COALESCE(owner,'')<>'' GROUP BY owner`,args:lw.args},
  {key:'oppByAdvisor',sql:`SELECT creator name,SUM(CASE WHEN registration_type='OPP' THEN 1 ELSE 0 END) opps FROM ${O}${ow.where} AND COALESCE(creator,'')<>'' GROUP BY creator`,args:ow.args},
  {key:'callByAdvisor',sql:`SELECT user name,COUNT(*) calls,SUM(CASE WHEN UPPER(COALESCE(queue,''))='T8' THEN 1 ELSE 0 END) t8 FROM ${C}${cw.where} AND COALESCE(user,'')<>'' GROUP BY user`,args:cw.args},
  {key:'ticketByAdvisor',sql:`SELECT owner name,COUNT(*) tickets FROM ${T}${tw.where} AND COALESCE(owner,'')<>'' GROUP BY owner`,args:tw.args},
  {key:'allTeamMembers',sql:'SELECT name,team_lead teamLead,team,role FROM team_members'},
  {key:'leadState',sql:`SELECT COALESCE(NULLIF(last_status,''),'بدون مقدار') label,COUNT(*) count FROM ${L}${lw.where} GROUP BY label ORDER BY count DESC`,args:lw.args},
  {key:'rank',sql:`SELECT COALESCE(NULLIF(customer_rank,''),'بدون مقدار') label,COUNT(*) count FROM ${L}${lw.where} GROUP BY label ORDER BY count DESC`,args:lw.args},
  {key:'leadSource',sql:`SELECT COALESCE(NULLIF(source,''),'بدون مقدار') label,COUNT(*) count FROM ${L}${lw.where} GROUP BY label ORDER BY count DESC`,args:lw.args},
  {key:'campaign',sql:`SELECT COALESCE(NULLIF(campaign,''),'بدون مقدار') label,COUNT(*) count FROM ${L}${lw.where} GROUP BY label ORDER BY count DESC`,args:lw.args},
  {key:'oppKind',sql:`SELECT COALESCE(NULLIF(registration_type,''),'بدون مقدار') label,COUNT(*) count FROM ${O}${ow.where} GROUP BY label ORDER BY count DESC`,args:ow.args},
  {key:'oppStatus',sql:`SELECT COALESCE(NULLIF(status,''),'بدون مقدار') label,COUNT(*) count FROM ${O}${ow.where} GROUP BY label ORDER BY count DESC`,args:ow.args},
  {key:'callSubject',sql:`SELECT COALESCE(NULLIF(subject,''),'بدون مقدار') label,COUNT(*) count FROM ${C}${cw.where} GROUP BY label ORDER BY count DESC`,args:cw.args},
  {key:'leadTicketTopic',sql:`SELECT COALESCE(NULLIF(source_ticket_contact_topic,''),'بدون مقدار') label,COUNT(*) count FROM ${L}${lw.where} GROUP BY label ORDER BY count DESC`,args:lw.args},
  {key:'ticketState',sql:`SELECT COALESCE(NULLIF(status_reason,''),'بدون مقدار') label,COUNT(*) count FROM ${T}${tw.where} GROUP BY label ORDER BY count DESC`,args:tw.args},
  {key:'ticketSubject',sql:`SELECT COALESCE(NULLIF(contact_topic,''),'بدون مقدار') label,COUNT(*) count FROM ${T}${tw.where} GROUP BY label ORDER BY count DESC`,args:tw.args},
  {key:'trendLeads',sql:`SELECT date(last_modified_date) day,SUM(CASE WHEN COALESCE(last_status,'') NOT IN ${TALKED_EXCLUDED_SQL} THEN 1 ELSE 0 END) talked FROM ${L}${lw.where} AND last_modified_date<>'' GROUP BY day`,args:lw.args},
  {key:'trendOpps',sql:`SELECT date(created_date) day,COUNT(*) opp FROM ${O}${ow.where} AND registration_type='OPP' AND created_date<>'' GROUP BY day`,args:ow.args},
  {key:'trendCalls',sql:`SELECT date(start_date) day,COUNT(*) calls,SUM(CASE WHEN UPPER(COALESCE(queue,''))='T8' THEN 1 ELSE 0 END) t8 FROM ${C}${cw.where} AND start_date<>'' GROUP BY day`,args:cw.args},
  {key:'trendTickets',sql:`SELECT date(closed_at) day,COUNT(*) tickets FROM ${T}${tw.where} AND closed_at<>'' GROUP BY day`,args:tw.args},
  {key:'teamTrendLead',sql:`SELECT date(last_modified_date) day,SUM(CASE WHEN COALESCE(last_status,'') NOT IN ${TALKED_EXCLUDED_SQL} THEN 1 ELSE 0 END) talked FROM ${L}${lw.where} AND owner IN (SELECT name FROM team_members) AND last_modified_date<>'' GROUP BY day`,args:lw.args},
  {key:'teamTrendOpp',sql:`SELECT date(created_date) day,COUNT(*) opp FROM ${O}${ow.where} AND creator IN (SELECT name FROM team_members) AND registration_type='OPP' AND created_date<>'' GROUP BY day`,args:ow.args},
  {key:'teamTrendCall',sql:`SELECT date(start_date) day,COUNT(*) calls,SUM(CASE WHEN UPPER(COALESCE(queue,''))='T8' THEN 1 ELSE 0 END) t8 FROM ${C}${cw.where} AND user IN (SELECT name FROM team_members) AND start_date<>'' GROUP BY day`,args:cw.args},
  {key:'teamTrendTicket',sql:`SELECT date(closed_at) day,COUNT(*) tickets FROM ${T}${tw.where} AND owner IN (SELECT name FROM team_members) AND closed_at<>'' GROUP BY day`,args:tw.args}
 ]);
 const lk=first(q.leadKpi),ok=first(q.oppKpi),ck=first(q.callKpi),rk=first(q.repeatCalls),tk=first(q.ticketKpi);
 const days=(q.days||[]).map((r:any)=>r.day),dayCount=Math.max(1,days.length);
 const advisorMap:any={};const ensure=(name:string)=>name?(advisorMap[name]||(advisorMap[name]={name,teamLead:'',team:'',role:'',leads:0,talked:0,opps:0,calls:0,t8:0,tickets:0})):null;
 for(const r of q.leadByAdvisor||[]){const x=ensure(r.name);if(x){x.leads=Number(r.leads||0);x.talked=Number(r.talked||0)}}
 for(const r of q.oppByAdvisor||[]){const x=ensure(r.name);if(x)x.opps=Number(r.opps||0)}
 for(const r of q.callByAdvisor||[]){const x=ensure(r.name);if(x){x.calls=Number(r.calls||0);x.t8=Number(r.t8||0)}}
 for(const r of q.ticketByAdvisor||[]){const x=ensure(r.name);if(x)x.tickets=Number(r.tickets||0)}
 const people:any=Object.fromEntries((q.allTeamMembers||[]).map((p:any)=>[p.name,p]));for(const name of Object.keys(advisorMap)){const p=people[name];if(p)Object.assign(advisorMap[name],{teamLead:p.teamLead||'',team:p.team||'',role:p.role||''})}
 const advisors=Object.values(advisorMap).map((r:any)=>{const total=Number(r.talked||0)+Number(r.opps||0)+Number(r.calls||0)+Number(r.tickets||0);return {...r,total,callAvg:Number(r.calls||0)/dayCount,leadAvg:Number(r.leads||0)/dayCount,talkedAvg:Number(r.talked||0)/dayCount,oppAvg:Number(r.opps||0)/dayCount,t8Avg:Number(r.t8||0)/dayCount,ticketAvg:Number(r.tickets||0)/dayCount,activityAvg:total/dayCount}}).sort((a:any,b:any)=>b.total-a.total);
 const buildTrend=(sets:any[])=>{const m:any={};const touch=(d:string)=>m[d]||(m[d]={day:d,talked:0,opp:0,calls:0,t8:0,tickets:0,total:0});for(const [rows,fields] of sets)for(const r of rows||[]){const x=touch(r.day);for(const f of fields)x[f]=Number(r[f]||0)}return Object.keys(m).sort().map(d=>{const r=m[d];r.total=r.talked+r.opp+r.calls+r.tickets;return r})};
 const trend=buildTrend([[q.trendLeads,['talked']],[q.trendOpps,['opp']],[q.trendCalls,['calls','t8']],[q.trendTickets,['tickets']]]);
 const teamTrend=buildTrend([[q.teamTrendLead,['talked']],[q.teamTrendOpp,['opp']],[q.teamTrendCall,['calls','t8']],[q.teamTrendTicket,['tickets']]]);
 const closed=Number(lk.closed||0),talked=Number(lk.talked||0),oppLead=Number(ok.oppLead||0),opp=Number(ok.opp||0),calls=Number(ck.calls||0),t8=Number(ck.t8||0),tickets=Number(tk.tickets||0),uniqueCalls=Number(ck.uniqueCalls||0),repeatCalls=Number(rk.repeatCalls||0);
 return {period,days,dayCount,kpis:{total:talked+opp+calls+tickets,closed,talked,oppLead,opp,calls,t8,tickets,closeAvg:lk.closeAvg==null?null:Number(lk.closeAvg),uniqueCalls,repeatCalls,callAvg:calls/dayCount,closedAvg:closed/dayCount,talkedAvg:talked/dayCount},advisors,dimensions:{leadState:pairs(q.leadState),rank:pairs(q.rank),leadSource:pairs(q.leadSource),campaign:pairs(q.campaign),oppKind:pairs(q.oppKind),oppStatus:pairs(q.oppStatus),callSubject:pairs(q.callSubject),leadTicketTopic:pairs(q.leadTicketTopic),ticketState:pairs(q.ticketState),ticketSubject:pairs(q.ticketSubject)},trend,teamTrend};
}

export async function getActivityDetails(period:string,type:string,user:string){let source:'lead'|'opp'|'call'|'ticket',where:string;if(type==='lead'||type==='talked'){source='lead';where='owner=?'+(type==='talked'?` AND COALESCE(last_status,'') NOT IN ${TALKED_EXCLUDED_SQL}`:'')}else if(type==='opp'){source='opp';where="creator=? AND registration_type='OPP'"}else if(type==='call'){source='call';where='user=?'}else if(type==='t8'){source='call';where="user=? AND UPPER(COALESCE(queue,''))='T8'"}else if(type==='ticket'){source='ticket';where='owner=?'}else return [];return tursoSelect(`SELECT * FROM ${table(period,source)} WHERE ${where} LIMIT 4000`,[user]);}
export async function getDimensionDetails(period:string,source:'lead'|'opp'|'call'|'ticket',field:string,value:string){const allowed:any={lead:{lastStatus:'last_status',customerRank:'customer_rank',source:'source',campaign:'campaign',sourceTicketContactTopic:'source_ticket_contact_topic'},opp:{registrationType:'registration_type',status:'status'},call:{subject:'subject'},ticket:{statusReason:'status_reason',contactTopic:'contact_topic'}};const col=allowed[source]?.[field];if(!col)throw new Error('فیلد Drill-down نامعتبر است.');return tursoSelect(`SELECT * FROM ${table(period,source)} WHERE COALESCE(${col},'')=? LIMIT 4000`,[value==='بدون مقدار'?'':value]);}
export async function getRepeatedCallDetails(period:string){const t=table(period,'call');return tursoSelect(`SELECT c.* FROM ${t} c INNER JOIN (SELECT user,lead_number FROM ${t} WHERE COALESCE(lead_number,'')<>'' GROUP BY user,lead_number HAVING COUNT(*)>1) r ON r.user=c.user AND r.lead_number=c.lead_number LIMIT 5000`);}
export async function getAdvisorTrend(period:string,advisor:string){const member=await tursoSelect('SELECT name FROM team_members WHERE name=? LIMIT 1',[advisor]);if(!member.length)return [];const L=table(period,'lead'),O=table(period,'opp'),C=table(period,'call'),T=table(period,'ticket');const q:any=await namedBatch([{key:'leads',sql:`SELECT date(last_modified_date) day,SUM(CASE WHEN COALESCE(last_status,'') NOT IN ${TALKED_EXCLUDED_SQL} THEN 1 ELSE 0 END) talked FROM ${L} WHERE owner=? AND last_modified_date<>'' GROUP BY day ORDER BY day`,args:[advisor]},{key:'opps',sql:`SELECT date(created_date) day,COUNT(*) opp FROM ${O} WHERE creator=? AND registration_type='OPP' AND created_date<>'' GROUP BY day ORDER BY day`,args:[advisor]},{key:'calls',sql:`SELECT date(start_date) day,COUNT(*) calls,SUM(CASE WHEN UPPER(COALESCE(queue,''))='T8' THEN 1 ELSE 0 END) t8 FROM ${C} WHERE user=? AND start_date<>'' GROUP BY day ORDER BY day`,args:[advisor]},{key:'tickets',sql:`SELECT date(closed_at) day,COUNT(*) tickets FROM ${T} WHERE owner=? AND closed_at<>'' GROUP BY day ORDER BY day`,args:[advisor]}]);const m:any={};const touch=(d:string)=>m[d]||(m[d]={day:d,talked:0,opp:0,calls:0,t8:0,tickets:0,total:0});for(const r of q.leads||[])touch(r.day).talked=Number(r.talked||0);for(const r of q.opps||[])touch(r.day).opp=Number(r.opp||0);for(const r of q.calls||[]){const x=touch(r.day);x.calls=Number(r.calls||0);x.t8=Number(r.t8||0)}for(const r of q.tickets||[])touch(r.day).tickets=Number(r.tickets||0);return Object.keys(m).sort().map(d=>{const r=m[d];r.total=r.talked+r.opp+r.calls+r.tickets;return r});}
