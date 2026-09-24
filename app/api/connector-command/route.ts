import { NextRequest,NextResponse } from 'next/server';
import { assertCrmConnectorToken } from '../../../lib/crm-shadow';
import { tursoBatch,tursoSelect } from '../../../lib/turso';
export const runtime='nodejs';export const dynamic='force-dynamic';
function auth(req:NextRequest){assertCrmConnectorToken(req.headers.get('x-crm-connector-token'));}

export async function GET(req:NextRequest){
 try{
  auth(req);
  const rows=await tursoSelect("SELECT id,command,payload FROM connector_commands WHERE status='pending' ORDER BY id ASC LIMIT 1");
  return NextResponse.json({ok:true,command:rows[0]||null},{headers:{'cache-control':'no-store'}});
 }catch(e:any){return NextResponse.json({ok:false,error:e?.message||String(e)},{status:Number(e?.status)||500});}
}
export async function POST(req:NextRequest){
 try{
  auth(req);const b=await req.json(),id=Number(b?.id),status=String(b?.status||'');
  if(!Number.isInteger(id)||!['running','completed','failed'].includes(status))return NextResponse.json({ok:false,error:'Invalid command update.'},{status:400});
  if(status==='running')await tursoBatch([{sql:"UPDATE connector_commands SET status='running',started_at=now() WHERE id=? AND status='pending'",args:[id]}]);
  else await tursoBatch([{sql:"UPDATE connector_commands SET status=?,completed_at=now(),result=? WHERE id=?",args:[status,String(b?.result||'').slice(0,2000),id]}]);
  return NextResponse.json({ok:true});
 }catch(e:any){return NextResponse.json({ok:false,error:e?.message||String(e)},{status:Number(e?.status)||500});}
}
