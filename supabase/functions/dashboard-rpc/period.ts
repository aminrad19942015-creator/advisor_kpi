import { tursoBatch, tursoSelect, type TursoStatement } from './turso.ts';

const STATUS_NORM_SQL = "REPLACE(TRIM(COALESCE(last_status,'')),' ','')";
// Activity lead tables are populated by the connector with CRM statecode ne 0 only.
// Therefore every row here is a closed lead (Qualified or Disqualified), regardless of status reason.
const CLOSED_CONDITION_SQL = '1=1';
const TALKED_CONDITION_SQL = `${STATUS_NORM_SQL} NOT IN ('عدمپاسخ(2بار)','عدمپاسخ(۲بار)','عدمتعیینوضعیتدرزمانمقرر')`;
const AML_SUBJECT_NORM_SQL = "REPLACE(REPLACE(TRIM(COALESCE(subject,'')),'ي','ی'),'ك','ک')";
const AML_CONDITION_SQL = `${AML_SUBJECT_NORM_SQL} IN (
 'تکمیل فرم شناسایی مضاعف',
 'بروز رسانی اطلاعات فرم مشخصات',
 'بروز رسانی اطلاعات مشخصات و تکمیل فرم شناسایی'
)`;
const norm=(v:any)=>!v?[]:(Array.isArray(v)?v:[v]).filter(Boolean);
const normPersonName=(v:any)=>String(v??'').replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/[\u200c\u200f\u202a-\u202e]/g,' ').replace(/\s+/g,' ').trim();
const first=(rows:any[])=>rows?.[0]||{};
const pairs=(rows:any[],k='label',c='count')=>(rows||[]).map(r=>[r[k]||'بدون مقدار',Number(r[c]||0)]);
function sqlIn(column:string,values:any[],args:any[]){if(!values.length)return '';return ` AND ${column} IN (${values.map(v=>{args.push(v);return '?'}).join(',')})`;}
function table(period:string,type:'lead'|'opp'|'call'|'ticket'){
 const p=period==='daily'?'daily_':period==='weekly'?'weekly_':period==='monthly'?'monthly_':period==='reportMonth'?'report_month_':'';
 if(!p)throw new Error('بازه نامعتبر: '+period);
 return p+({lead:'leads',opp:'opportunities',call:'calls',ticket:'tickets'} as const)[type];
}
function whereFor(filters:any,source:'lead'|'opp'|'call'|'ticket',period?:string,outerAlias?:string){
 filters=filters||{};const args:any[]=[];const person=source==='lead'?'owner':source==='opp'?'creator':source==='call'?'"user"':'owner';let where=' WHERE 1=1';
 const advisors=norm(filters.advisor);if(advisors.length)where+=sqlIn(person,advisors,args);
 const campaigns=norm(filters.campaign);
 if(campaigns.length){
  if(source==='lead') where+=sqlIn('campaign',campaigns,args);
  if(source==='opp'){
   if(!period) throw new Error('بازه برای فیلتر کمپین فرصت مشخص نیست.');
   const leadTable=table(period,'lead');
   const qs=campaigns.map(v=>{args.push(v);return '?'}).join(',');
   const outerLeadRef=(outerAlias?outerAlias:table(period,'opp'))+'.lead_number';
   where+=` AND EXISTS (SELECT 1 FROM ${leadTable} cl WHERE cl.campaign IN (${qs}) AND COALESCE(cl.lead_number,'')<>'' AND cl.lead_number=${outerLeadRef})`;
  }
  if(source==='call'){
   if(!period) throw new Error('بازه برای فیلتر کمپین تماس مشخص نیست.');
   const leadTable=table(period,'lead');
   const qs=campaigns.map(v=>{args.push(v);return '?'}).join(',');
   where+=` AND lead_number IN (SELECT lead_number FROM ${leadTable} WHERE campaign IN (${qs}) AND COALESCE(lead_number,'')<>'')`;
  }
 }
 const leads=norm(filters.teamLead),seniorLeads=norm(filters.seniorLead),teams=norm(filters.team),roles=norm(filters.role);
 if(leads.length||seniorLeads.length||teams.length||roles.length){const subArgs:any[]=[];let sub='SELECT name FROM team_members WHERE 1=1';sub+=sqlIn('team_lead',leads,subArgs);sub+=sqlIn('senior_lead',seniorLeads,subArgs);sub+=sqlIn('team',teams,subArgs);sub+=sqlIn('role',roles,subArgs);where+=` AND ${person} IN (${sub})`;args.push(...subArgs);}
 return {where,args};
}
async function namedBatch(items:Array<TursoStatement&{key:string}>){
 const laneCount=Math.min(5,Math.max(1,items.length));
 const lanes:Array<Array<TursoStatement&{key:string}>>=Array.from({length:laneCount},()=>[]);
 items.forEach((item,i)=>lanes[i%laneCount].push(item));
 const laneResults=await Promise.all(lanes.map(async lane=>{
   const rows=await tursoBatch(lane.map(({sql,args})=>({sql,args})));
   return lane.map((x,i)=>[x.key,rows[i]] as const);
 }));
 return Object.fromEntries(laneResults.flat());
}

export async function getPeriodCampaignOptions(period:string){
 const L=table(period,'lead');
 const rows=await tursoSelect(`SELECT DISTINCT TRIM(campaign) campaign FROM ${L} WHERE TRIM(COALESCE(campaign,''))<>'' ORDER BY campaign`);
 return rows.map((r:any)=>r.campaign).filter(Boolean);
}

export async function getFilteredPeriodSummary(period:string,filters:any={}){
 const L=table(period,'lead'),O=table(period,'opp'),C=table(period,'call'),T=table(period,'ticket');
 const lw=whereFor(filters,'lead',period),ow=whereFor(filters,'opp',period),cw=whereFor(filters,'call',period),tw=whereFor(filters,'ticket',period);
 const attendanceFilters={...(filters||{}),campaign:[]};
 const acw=whereFor(attendanceFilters,'call',period);
 const q:any=await namedBatch([
  {key:'leadKpi',sql:`SELECT
    COUNT(*) handled,
    SUM(CASE WHEN ${CLOSED_CONDITION_SQL} THEN 1 ELSE 0 END) closed,
    SUM(CASE WHEN ${TALKED_CONDITION_SQL} THEN 1 ELSE 0 END) talked,
    SUM(CASE WHEN TRIM(COALESCE(last_status,''))='عدم تعیین وضعیت در زمان مقرر' THEN 1 ELSE 0 END) AS "noStatusCount",
    SUM(CASE WHEN REPLACE(TRIM(COALESCE(last_status,'')),' ','') IN ('عدمپاسخ(2بار)','عدمپاسخ(۲بار)') THEN 1 ELSE 0 END) AS "noResponseCount",
    AVG(CASE WHEN ${CLOSED_CONDITION_SQL} AND NULLIF(created_date,'') IS NOT NULL AND NULLIF(last_modified_date,'') IS NOT NULL AND last_modified_date::timestamptz>=created_date::timestamptz THEN EXTRACT(EPOCH FROM (last_modified_date::timestamptz-created_date::timestamptz))/86400.0 END) AS "closeAvg"
    FROM ${L}${lw.where}`,args:lw.args},
  {key:'oppKpi',sql:`SELECT SUM(CASE WHEN registration_type='LEAD' THEN 1 ELSE 0 END) AS "oppLead",SUM(CASE WHEN registration_type='OPP' THEN 1 ELSE 0 END) opp FROM ${O}${ow.where}`,args:ow.args},
  {key:'callKpi',sql:`SELECT
    SUM(CASE WHEN NOT (${AML_CONDITION_SQL}) THEN 1 ELSE 0 END) calls,
    SUM(CASE WHEN ${AML_CONDITION_SQL} THEN 1 ELSE 0 END) aml,
    SUM(CASE WHEN UPPER(COALESCE(queue,''))='T8' THEN 1 ELSE 0 END) t8,
    COUNT(DISTINCT CASE WHEN NOT (${AML_CONDITION_SQL}) AND COALESCE(lead_number,'')<>'' THEN "user"||'|'||lead_number END) AS "uniqueCalls"
    FROM ${C}${cw.where}`,args:cw.args},
  {key:'repeatCalls',sql:`SELECT COALESCE(SUM(n-1),0) AS "repeatCalls" FROM (
    SELECT COUNT(*) n FROM ${C}${cw.where}
    AND NOT (${AML_CONDITION_SQL})
    AND COALESCE(lead_number,'')<>''
    GROUP BY "user",lead_number HAVING COUNT(*)>1
   )`,args:cw.args},
  {key:'ticketKpi',sql:`SELECT COUNT(*) tickets FROM ${T}${tw.where}`,args:tw.args},
  {key:'days',sql:`SELECT "day" FROM (SELECT (last_modified_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date AS "day" FROM ${L}${lw.where} AND last_modified_date<>'' UNION SELECT (created_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date AS "day" FROM ${O}${ow.where} AND created_date<>'' UNION SELECT (start_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date AS "day" FROM ${C}${cw.where} AND start_date<>'' UNION SELECT (closed_at::timestamptz AT TIME ZONE 'Asia/Tehran')::date AS "day" FROM ${T}${tw.where} AND closed_at<>'') WHERE "day" IS NOT NULL ORDER BY "day"`,args:[...lw.args,...ow.args,...cw.args,...tw.args]},
  {key:'leadByAdvisor',sql:`SELECT owner name,SUM(CASE WHEN ${CLOSED_CONDITION_SQL} THEN 1 ELSE 0 END) leads,SUM(CASE WHEN ${TALKED_CONDITION_SQL} THEN 1 ELSE 0 END) talked FROM ${L}${lw.where} AND COALESCE(owner,'')<>'' GROUP BY owner`,args:lw.args},
  {key:'oppByAdvisor',sql:`SELECT creator name,SUM(CASE WHEN registration_type='OPP' THEN 1 ELSE 0 END) opps FROM ${O}${ow.where} AND COALESCE(creator,'')<>'' GROUP BY creator`,args:ow.args},
  {key:'callByAdvisor',sql:`SELECT "user" name,
    SUM(CASE WHEN NOT (${AML_CONDITION_SQL}) THEN 1 ELSE 0 END) calls,
    SUM(CASE WHEN ${AML_CONDITION_SQL} THEN 1 ELSE 0 END) aml,
    SUM(CASE WHEN UPPER(COALESCE(queue,''))='T8' THEN 1 ELSE 0 END) t8
    FROM ${C}${cw.where} AND COALESCE("user",'')<>'' GROUP BY "user"`,args:cw.args},
  {key:'ticketByAdvisor',sql:`SELECT owner name,COUNT(*) tickets FROM ${T}${tw.where} AND COALESCE(owner,'')<>'' GROUP BY owner`,args:tw.args},
  {key:'attendanceByAdvisor',sql:`SELECT name,COUNT(*) AS "attendanceDays" FROM (
    SELECT "user" name,(start_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date AS "day"
    FROM ${C}${acw.where}
      AND COALESCE("user",'')<>''
      AND start_date<>''
    GROUP BY "user",(start_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date
    HAVING COUNT(*)>=5
  ) GROUP BY name`,args:acw.args},
  {key:'allTeamMembers',sql:'SELECT name,team_lead AS "teamLead",senior_lead AS "seniorLead",team,role FROM team_members'},
  {key:'leadState',sql:`SELECT COALESCE(NULLIF(last_status,''),'بدون مقدار') label,COUNT(*) count FROM ${L}${lw.where} GROUP BY label ORDER BY count DESC`,args:lw.args},
  {key:'rank',sql:`SELECT COALESCE(NULLIF(customer_rank,''),'بدون مقدار') label,COUNT(*) count FROM ${L}${lw.where} GROUP BY label ORDER BY count DESC`,args:lw.args},
  {key:'leadSource',sql:`SELECT COALESCE(NULLIF(source,''),'بدون مقدار') label,COUNT(*) count FROM ${L}${lw.where} GROUP BY label ORDER BY count DESC`,args:lw.args},
  {key:'campaign',sql:`SELECT COALESCE(NULLIF(campaign,''),'بدون مقدار') label,COUNT(*) count FROM ${L}${lw.where} GROUP BY label ORDER BY count DESC`,args:lw.args},
  {key:'oppKind',sql:`SELECT COALESCE(NULLIF(registration_type,''),'بدون مقدار') label,COUNT(*) count FROM ${O}${ow.where} GROUP BY label ORDER BY count DESC`,args:ow.args},
  {key:'oppStatus',sql:`SELECT COALESCE(NULLIF(status,''),'بدون مقدار') label,COUNT(*) count FROM ${O}${ow.where} GROUP BY label ORDER BY count DESC`,args:ow.args},
  {key:'callSubject',sql:`SELECT COALESCE(NULLIF(subject,''),'بدون مقدار') label,COUNT(*) count FROM ${C}${cw.where} GROUP BY label ORDER BY count DESC`,args:cw.args},
  {key:'leadTicketTopic',sql:`SELECT COALESCE(NULLIF(source_ticket_contact_topic,''),'بدون مقدار') label,COUNT(*) count FROM ${L}${lw.where} GROUP BY label ORDER BY count DESC`,args:lw.args},
  {key:'ticketState',sql:`SELECT COALESCE(NULLIF(status_reason,''),'بدون مقدار') label,COUNT(*) count FROM ${T}${tw.where} GROUP BY label ORDER BY count DESC`,args:tw.args},
  {key:'ticketSubject',sql:`SELECT COALESCE(NULLIF(contact_topic,''),NULLIF(main_subject,''),'بدون مقدار') label,COUNT(*) count FROM ${T}${tw.where} GROUP BY label ORDER BY count DESC`,args:tw.args}
 ]);
 const lk=first(q.leadKpi),ok=first(q.oppKpi),ck=first(q.callKpi),rk=first(q.repeatCalls),tk=first(q.ticketKpi);
 const days=(q.days||[]).map((r:any)=>r.day),dayCount=Math.max(1,days.length);
 const members:any[]=q.allTeamMembers||[];
 const selectedAdvisors=norm(filters?.advisor),selectedTeamLeads=norm(filters?.teamLead),selectedSeniorLeads=norm(filters?.seniorLead),selectedTeams=norm(filters?.team),selectedRoles=norm(filters?.role);
 const denominatorMembers=members.filter((p:any)=>
  (!selectedAdvisors.length||selectedAdvisors.includes(p.name))&&
  (!selectedTeamLeads.length||selectedTeamLeads.includes(p.teamLead))&&
  (!selectedSeniorLeads.length||selectedSeniorLeads.includes(p.seniorLead))&&
  (!selectedTeams.length||selectedTeams.includes(p.team))&&
  (!selectedRoles.length||selectedRoles.includes(p.role))
 );
 const memberCount=denominatorMembers.length;
 const people:any=Object.fromEntries(members.map((p:any)=>[p.name,p]));
 const canonicalByNorm=new Map<string,string>();
 for(const p of members){const k=normPersonName(p.name);if(k&&!canonicalByNorm.has(k))canonicalByNorm.set(k,p.name)}
 const advisorMap:any={};
 const ensure=(rawName:string)=>{
  const raw=String(rawName||'').trim();
  if(!raw)return null;
  const name=people[raw]?raw:canonicalByNorm.get(normPersonName(raw));
  if(!name)return null;
  const p=people[name]||{};
  return advisorMap[name]||(advisorMap[name]={name,teamLead:p.teamLead||'',seniorLead:p.seniorLead||'',team:p.team||'',role:p.role||'',leads:0,talked:0,opps:0,calls:0,aml:0,t8:0,tickets:0,attendanceDays:0});
 };
 for(const r of q.leadByAdvisor||[]){const x=ensure(r.name);if(x){x.leads=Number(r.leads||0);x.talked=Number(r.talked||0)}}
 for(const r of q.oppByAdvisor||[]){const x=ensure(r.name);if(x)x.opps=Number(r.opps||0)}
 for(const r of q.callByAdvisor||[]){const x=ensure(r.name);if(x){x.calls=Number(r.calls||0);x.aml=Number(r.aml||0);x.t8=Number(r.t8||0)}}
 for(const r of q.ticketByAdvisor||[]){const x=ensure(r.name);if(x)x.tickets=Number(r.tickets||0)}
 for(const r of q.attendanceByAdvisor||[]){const x=ensure(r.name);if(x)x.attendanceDays=Number(r.attendanceDays||0)}
 const advisors=Object.values(advisorMap).map((r:any)=>{const total=Number(r.talked||0)+Number(r.opps||0)+Number(r.aml||0)+Number(r.t8||0)+Number(r.tickets||0);const attendanceDays=Math.max(1,Number(r.attendanceDays||0));return {...r,attendanceDays,total,callAvg:Number(r.calls||0)/attendanceDays,amlAvg:Number(r.aml||0)/attendanceDays,leadAvg:Number(r.leads||0)/attendanceDays,talkedAvg:Number(r.talked||0)/attendanceDays,oppAvg:Number(r.opps||0)/attendanceDays,t8Avg:Number(r.t8||0)/attendanceDays,ticketAvg:Number(r.tickets||0)/attendanceDays,activityAvg:total/attendanceDays}}).sort((a:any,b:any)=>b.total-a.total);
 const handled=Number(lk.handled||0),closed=Number(lk.closed||0),talked=Number(lk.talked||0),noStatusCount=Number(lk.noStatusCount||0),noResponseCount=Number(lk.noResponseCount||0),oppLead=Number(ok.oppLead||0),opp=Number(ok.opp||0),calls=Number(ck.calls||0),aml=Number(ck.aml||0),t8=Number(ck.t8||0),tickets=Number(tk.tickets||0),uniqueCalls=Number(ck.uniqueCalls||0),repeatCalls=Number(rk.repeatCalls||0);
 const noStatusRate=handled?noStatusCount/handled*100:0,noResponseRate=handled?noResponseCount/handled*100:0;
 return {period,days,dayCount,unitAdvisorCount:(q.allTeamMembers||[]).length,kpis:{total:talked+opp+aml+t8+tickets,handled,closed,talked,noStatusCount,noStatusRate,noResponseCount,noResponseRate,oppLead,opp,calls,aml,t8,tickets,closeAvg:lk.closeAvg==null?null:Number(lk.closeAvg),uniqueCalls,repeatCalls,memberCount,callAvg:calls/dayCount,amlAvg:aml/dayCount,closedAvg:closed/dayCount,talkedAvg:talked/dayCount,callAvgPerPerson:memberCount?(calls/dayCount)/memberCount:0,amlAvgPerPerson:memberCount?(aml/dayCount)/memberCount:0,closedAvgPerPerson:memberCount?(closed/dayCount)/memberCount:0,talkedAvgPerPerson:memberCount?(talked/dayCount)/memberCount:0},advisors,dimensions:{leadState:pairs(q.leadState),rank:pairs(q.rank),leadSource:pairs(q.leadSource),campaign:pairs(q.campaign),oppKind:pairs(q.oppKind),oppStatus:pairs(q.oppStatus),callSubject:pairs(q.callSubject),leadTicketTopic:pairs(q.leadTicketTopic),ticketState:pairs(q.ticketState),ticketSubject:pairs(q.ticketSubject)}};
}

export async function getPeriodExportData(period:string,filters:any={}){
 const L=table(period,'lead'),O=table(period,'opp'),C=table(period,'call'),T=table(period,'ticket');
 const lw=whereFor(filters,'lead',period),ow=whereFor(filters,'opp',period),cw=whereFor(filters,'call',period),tw=whereFor(filters,'ticket',period);
 const [summary,leads,opportunities,calls,tickets]=await Promise.all([
  getFilteredPeriodSummary(period,filters),
  tursoSelect(`SELECT * FROM ${L}${lw.where} ORDER BY last_modified_date DESC`,lw.args),
  tursoSelect(`SELECT * FROM ${O}${ow.where} ORDER BY created_date DESC`,ow.args),
  tursoSelect(`SELECT * FROM ${C}${cw.where} ORDER BY start_date DESC`,cw.args),
  tursoSelect(`SELECT * FROM ${T}${tw.where} ORDER BY closed_at DESC`,tw.args)
 ]);
 return {summary,leads,opportunities,calls,tickets};
}

export async function getLeadStatusKpiDetails(period:string,type:string,filters:any={}){
 const L=table(period,'lead');
 const lw=whereFor(filters,'lead',period);
 let condition='';
 if(type==='noStatus')condition="TRIM(COALESCE(last_status,''))='عدم تعیین وضعیت در زمان مقرر'";
 else if(type==='noResponse')condition="REPLACE(TRIM(COALESCE(last_status,'')),' ','') IN ('عدمپاسخ(2بار)','عدمپاسخ(۲بار)')";
 else throw new Error('نوع شاخص وضعیت لید نامعتبر است.');
 return tursoSelect(`SELECT *
  FROM ${L}${lw.where} AND ${condition}
  ORDER BY last_modified_date DESC,owner
  LIMIT 4000`,lw.args);
}

export async function getActivityDetails(period:string,type:string,user:string,filters:any={}){
 let source:'lead'|'opp'|'call'|'ticket';
 if(type==='lead'||type==='talked')source='lead';
 else if(type==='opp')source='opp';
 else if(type==='call'||type==='aml'||type==='t8')source='call';
 else if(type==='ticket')source='ticket';
 else return [];

 const scoped={...(filters||{}),advisor:[user]};
 const w=whereFor(scoped,source,period);
 let extra='';
 if(type==='lead')extra=' AND '+CLOSED_CONDITION_SQL;
 if(type==='talked')extra=' AND '+TALKED_CONDITION_SQL;
 if(type==='opp')extra=" AND registration_type='OPP'";
 if(type==='call')extra=' AND NOT ('+AML_CONDITION_SQL+')';
  if(type==='aml')extra=' AND '+AML_CONDITION_SQL;
  if(type==='t8')extra=" AND UPPER(COALESCE(queue,''))='T8'";
 const rows=await tursoSelect(`SELECT * FROM ${table(period,source)}${w.where}${extra} LIMIT 4000`,w.args);
 if(source==='call')return rows.map((r:any)=>{const {phone_number,destination_number,...rest}=r;return {...rest,'شماره تماس مشتری':phone_number||destination_number||''}});
 return rows;
}

export async function getPeriodKpiDetails(period:string,type:string,filters:any={}){
 let source:'lead'|'opp'|'call'|'ticket';
 if(['closed','talked','noStatus','noResponse'].includes(type))source='lead';
 else if(type==='oppLead'||type==='opp')source='opp';
 else if(type==='calls'||type==='aml'||type==='t8')source='call';
 else if(type==='tickets')source='ticket';
 else throw new Error('نوع KPI نامعتبر است.');

 const w=whereFor(filters||{},source,period);
 let extra='';
 if(type==='closed')extra=' AND '+CLOSED_CONDITION_SQL;
 if(type==='talked')extra=' AND '+TALKED_CONDITION_SQL;
 if(type==='noStatus')extra=" AND REPLACE(TRIM(COALESCE(last_status,'')),' ','')='عدمتعیینوضعیتدرزمانمقرر'";
 if(type==='noResponse')extra=" AND REPLACE(TRIM(COALESCE(last_status,'')),' ','') IN ('عدمپاسخ(2بار)','عدمپاسخ(۲بار)')";
 if(type==='oppLead')extra=" AND registration_type='LEAD'";
 if(type==='opp')extra=" AND registration_type='OPP'";
 if(type==='t8')extra=" AND UPPER(COALESCE(queue,''))='T8'";
 const rows=await tursoSelect(`SELECT * FROM ${table(period,source)}${w.where}${extra} LIMIT 5000`,w.args);
 if(source==='call')return rows.map((r:any)=>{const {phone_number,destination_number,...rest}=r;return {...rest,'شماره تماس مشتری':phone_number||destination_number||''}});
 return rows;
}
export async function getDimensionDetails(period:string,source:'lead'|'opp'|'call'|'ticket',field:string,value:string,filters:any={}){
 const allowed:any={lead:{lastStatus:'last_status',customerRank:'customer_rank',source:'source',campaign:'campaign',sourceTicketContactTopic:'source_ticket_contact_topic'},opp:{registrationType:'registration_type',status:'status'},call:{subject:'subject'},ticket:{statusReason:'status_reason',contactTopic:'contact_topic'}};
 const col=allowed[source]?.[field];if(!col)throw new Error('فیلد Drill-down نامعتبر است.');
 const w=whereFor(filters||{},source,period);
 const expected=value==='بدون مقدار'?'':value;
 if(source==='ticket'&&field==='contactTopic'){
   return tursoSelect(`SELECT * FROM ${table(period,source)}${w.where} AND COALESCE(NULLIF(contact_topic,''),NULLIF(main_subject,''),'')=? LIMIT 4000`,[...w.args,expected]);
 }
 return tursoSelect(`SELECT * FROM ${table(period,source)}${w.where} AND COALESCE(${col},'')=? LIMIT 4000`,[...w.args,expected]);
}
export async function getRepeatedCallDetails(period:string,filters:any={}){
 const t=table(period,'call'),w=whereFor(filters||{},'call',period);
 return tursoSelect(`SELECT c.* FROM ${t} c INNER JOIN (
   SELECT "user",lead_number FROM ${t}${w.where} AND COALESCE(lead_number,'')<>''
   GROUP BY "user",lead_number HAVING COUNT(*)>1
 ) r ON r."user"=c."user" AND r.lead_number=c.lead_number
 WHERE 1=1 LIMIT 5000`,w.args);
}
export async function getAdvisorTrend(period:string,advisor:string){const member=await tursoSelect('SELECT name FROM team_members WHERE name=? LIMIT 1',[advisor]);if(!member.length)return [];const L=table(period,'lead'),O=table(period,'opp'),C=table(period,'call'),T=table(period,'ticket');const q:any=await namedBatch([{key:'leads',sql:`SELECT (last_modified_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date AS "day",SUM(CASE WHEN ${TALKED_CONDITION_SQL} THEN 1 ELSE 0 END) talked FROM ${L} WHERE owner=? AND last_modified_date<>'' GROUP BY "day" ORDER BY "day"`,args:[advisor]},{key:'opps',sql:`SELECT (created_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date AS "day",COUNT(*) opp FROM ${O} WHERE creator=? AND registration_type='OPP' AND created_date<>'' GROUP BY "day" ORDER BY "day"`,args:[advisor]},{key:'calls',sql:`SELECT (start_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date AS "day",COUNT(*) calls,SUM(CASE WHEN UPPER(COALESCE(queue,''))='T8' THEN 1 ELSE 0 END) t8 FROM ${C} WHERE "user"=? AND start_date<>'' GROUP BY "day" ORDER BY "day"`,args:[advisor]},{key:'tickets',sql:`SELECT (closed_at::timestamptz AT TIME ZONE 'Asia/Tehran')::date AS "day",COUNT(*) tickets FROM ${T} WHERE owner=? AND closed_at<>'' GROUP BY "day" ORDER BY "day"`,args:[advisor]}]);const m:any={};const touch=(d:string)=>m[d]||(m[d]={day:d,talked:0,opp:0,calls:0,t8:0,tickets:0,total:0});for(const r of q.leads||[])touch(r.day).talked=Number(r.talked||0);for(const r of q.opps||[])touch(r.day).opp=Number(r.opp||0);for(const r of q.calls||[]){const x=touch(r.day);x.calls=Number(r.calls||0);x.t8=Number(r.t8||0)}for(const r of q.tickets||[])touch(r.day).tickets=Number(r.tickets||0);return Object.keys(m).sort().map(d=>{const r=m[d];r.total=r.talked+r.opp+r.t8+r.tickets;return r});}


export async function getPeriodExportChunk(period:string,dataset:string,filters:any={},offset=0,limit=10000){
 const sourceMap:any={leads:'lead',opportunities:'opp',calls:'call',tickets:'ticket'};
 const source=sourceMap[String(dataset||'')];
 if(!source)throw new Error('نوع دیتاست خروجی نامعتبر است.');
 const safeOffset=Math.max(0,Math.floor(Number(offset)||0));
 const safeLimit=Math.max(1,Math.min(10000,Math.floor(Number(limit)||10000)));
 const w=whereFor(filters||{},source,period);
 const order=source==='lead'?'last_modified_date':source==='opp'?'created_date':source==='call'?'start_date':'closed_at';
 return tursoSelect(
   `SELECT * FROM ${table(period,source)}${w.where} ORDER BY ${order} DESC LIMIT ? OFFSET ?`,
   [...w.args,safeLimit,safeOffset]
 );
}
