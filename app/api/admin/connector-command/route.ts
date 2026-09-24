import { NextRequest,NextResponse } from 'next/server';
import { isAdmin } from '../../../../lib/admin-auth';
import { tursoBatch,tursoSelect } from '../../../../lib/turso';
export const runtime='nodejs';

export async function GET(){
 try{
  if(!await isAdmin())return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
  const rows=await tursoSelect("SELECT id,command,status,created_at,started_at,completed_at,result FROM connector_commands ORDER BY id DESC LIMIT 20");
  return NextResponse.json({ok:true,commands:rows},{headers:{'cache-control':'no-store'}});
 }catch(e:any){return NextResponse.json({ok:false,error:e?.message||String(e)},{status:500});}
}
export async function POST(req:NextRequest){
 try{
  if(!await isAdmin())return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
  const body=await req.json(),command=String(body?.command||'');
  if(command!=='restore_local_snapshots')return NextResponse.json({ok:false,error:'فرمان نامعتبر است.'},{status:400});
  await tursoBatch([{sql:"INSERT INTO connector_commands(command,payload,status) VALUES(?,?::jsonb,'pending')",args:[command,JSON.stringify({scope:'all'})]}]);
  return NextResponse.json({ok:true,message:'درخواست بازیابی ثبت شد و در اجرای بعدی Connector انجام می‌شود.'});
 }catch(e:any){return NextResponse.json({ok:false,error:e?.message||String(e)},{status:500});}
}
