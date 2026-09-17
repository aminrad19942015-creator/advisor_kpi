import { NextRequest, NextResponse } from 'next/server';
import { setAdminSession, verifyPassword } from '../../../../lib/admin-auth';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 try{
  const body=await req.json();
  if(!verifyPassword(String(body?.password||''))) return NextResponse.json({ok:false,error:'رمز عبور نادرست است.'},{status:401});
  await setAdminSession();
  return NextResponse.json({ok:true});
 }catch(error:any){return NextResponse.json({ok:false,error:error?.message||String(error)},{status:500});}
}
