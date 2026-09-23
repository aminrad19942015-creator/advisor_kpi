import { NextResponse } from 'next/server';
import { isAdmin } from '../../../../lib/admin-auth';
import { getCrmShadowStatus } from '../../../../lib/crm-shadow';
import { getCrmActivityStatus } from '../../../../lib/crm-activity';
import { tursoBatch } from '../../../../lib/turso';

export const runtime='nodejs';

const TABLES=[
 'open_leads_crm_shadow',
 'daily_leads','weekly_leads','monthly_leads',
 'daily_opportunities','weekly_opportunities','monthly_opportunities',
 'daily_calls','weekly_calls','monthly_calls',
 'daily_tickets','weekly_tickets','monthly_tickets'
];

export async function GET(){
 try{
  if(!await isAdmin()) return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
  const [open,activity,sets]=await Promise.all([
   getCrmShadowStatus(),
   getCrmActivityStatus(),
   tursoBatch(TABLES.map(t=>({sql:`SELECT COUNT(*) count FROM "${t}"`})))
  ]);
  const counts=Object.fromEntries(TABLES.map((t,i)=>[t,Number((sets[i]?.[0] as any)?.count||0)]));
  return NextResponse.json({ok:true,open,activity,counts,checkedAt:new Date().toISOString()},{headers:{'cache-control':'no-store'}});
 }catch(e:any){
  return NextResponse.json({ok:false,error:e?.message||String(e)},{status:500});
 }
}
