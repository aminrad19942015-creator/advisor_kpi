import { NextResponse } from 'next/server';
import { isAdmin } from '../../../../lib/admin-auth';
import { getDashboardBootstrap } from '../../../../lib/bootstrap';
import { getFilteredPeriodSummary } from '../../../../lib/period';
import { tursoBatch } from '../../../../lib/turso';

export const runtime='nodejs';
export const maxDuration=300;

const TABLES=[
 'team_members','open_leads',
 'daily_leads','weekly_leads','monthly_leads',
 'daily_opportunities','weekly_opportunities','monthly_opportunities',
 'daily_calls','weekly_calls','monthly_calls',
 'daily_tickets','weekly_tickets','monthly_tickets'
];

export async function GET(){
 const started=Date.now();
 try{
  if(!await isAdmin()) return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
  const [bootstrap,daily,weekly,monthly,countSets]=await Promise.all([
   getDashboardBootstrap(),
   getFilteredPeriodSummary('daily',{}),
   getFilteredPeriodSummary('weekly',{}),
   getFilteredPeriodSummary('monthly',{}),
   tursoBatch(TABLES.map(table=>({sql:`SELECT COUNT(*) count FROM "${table}"`})))
  ]);
  const counts=Object.fromEntries(TABLES.map((t,i)=>[t,Number((countSets[i]?.[0] as any)?.count||0)]));
  const checks=[
   {key:'meta',label:'Metadata / Sync',ok:Boolean(bootstrap?.meta?.dataVersion&&bootstrap?.meta?.lastSyncAt),detail:`version=${bootstrap?.meta?.dataVersion||'—'} | sync=${bootstrap?.meta?.lastSyncAt||'—'}`},
   {key:'team',label:'نمای کلی تیم',ok:Array.isArray(bootstrap?.team?.rows)&&bootstrap.team.rows.length===counts.team_members,detail:`${bootstrap?.team?.rows?.length||0} / ${counts.team_members} ردیف`},
   {key:'open',label:'سرنخ‌های باز روزانه',ok:Number(bootstrap?.open?.kpis?.allTotal||0)===counts.open_leads,detail:`${Number(bootstrap?.open?.kpis?.allTotal||0)} / ${counts.open_leads} ردیف`},
   {key:'daily',label:'فعالیت دیروز',ok:Boolean(daily&&typeof daily==='object'),detail:`Summary پاسخ داد | total=${Number((daily as any)?.kpis?.total||0)}`},
   {key:'weekly',label:'فعالیت هفته',ok:Boolean(weekly&&typeof weekly==='object'),detail:`Summary پاسخ داد | total=${Number((weekly as any)?.kpis?.total||0)}`},
   {key:'monthly',label:'فعالیت ماه',ok:Boolean(monthly&&typeof monthly==='object'),detail:`Summary پاسخ داد | total=${Number((monthly as any)?.kpis?.total||0)}`},
   ...TABLES.map(t=>({key:'table:'+t,label:t,ok:counts[t]>0,detail:`${counts[t]} ردیف`}))
  ];
  const failed=checks.filter(x=>!x.ok);
  return NextResponse.json({
   ok:failed.length===0,
   checkedAt:new Date().toISOString(),
   durationMs:Date.now()-started,
   meta:bootstrap.meta,
   counts,
   checks,
   failed
  },{status:failed.length?500:200});
 }catch(e:any){
  return NextResponse.json({ok:false,error:e?.message||String(e),checkedAt:new Date().toISOString(),durationMs:Date.now()-started},{status:500});
 }
}
