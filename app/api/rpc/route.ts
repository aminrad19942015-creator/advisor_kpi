import { NextRequest, NextResponse } from 'next/server';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const body=await req.json().catch(()=>null);
 if(!body?.method)return NextResponse.json({error:'Invalid RPC request'},{status:400});
 return NextResponse.json({error:`Backend migration in progress: ${body.method}`},{status:501});
}
