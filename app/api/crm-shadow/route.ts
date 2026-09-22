import { NextRequest, NextResponse } from 'next/server';
import {
  appendCrmShadowChunk,
  assertCrmConnectorToken,
  compareCrmShadowToProduction,
  finalizeCrmShadowBatch,
  getCrmShadowStatus,
  startCrmShadowBatch
} from '../../../lib/crm-shadow';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function authorize(req:NextRequest){
  assertCrmConnectorToken(req.headers.get('x-crm-connector-token'));
}
function errorResponse(error:any){
  const status=Number(error?.status)||500;
  const safe=status===401?'Unauthorized connector.':(error?.message||'CRM shadow sync failed.');
  return NextResponse.json({ok:false,error:safe},{status});
}

export async function GET(req:NextRequest){
  try{
    authorize(req);
    const [status,comparison]=await Promise.all([getCrmShadowStatus(),compareCrmShadowToProduction()]);
    return NextResponse.json({ok:true,status,comparison},{headers:{'cache-control':'no-store'}});
  }catch(error:any){return errorResponse(error);}
}

export async function POST(req:NextRequest){
  try{
    authorize(req);
    const body=await req.json();
    const action=String(body?.action||'');
    if(action==='start') return NextResponse.json({ok:true,...await startCrmShadowBatch()});
    if(action==='chunk') return NextResponse.json({ok:true,...await appendCrmShadowChunk(String(body?.batchId||''),Number(body?.seq),body?.rows)});
    if(action==='finalize') return NextResponse.json({ok:true,...await finalizeCrmShadowBatch(String(body?.batchId||''),Number(body?.expectedRows),body?.sourceCheckedAt?String(body.sourceCheckedAt):undefined)});
    return NextResponse.json({ok:false,error:'Unknown CRM shadow action.'},{status:400});
  }catch(error:any){return errorResponse(error);}
}
