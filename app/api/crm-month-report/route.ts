import { assertCrmConnectorToken } from '../../../lib/crm-shadow';
import { NextRequest, NextResponse } from 'next/server';
import {
  appendCrmMonthReportChunk,

  finalizeCrmMonthReportBatch,
  getCrmMonthReportStatus,
  startCrmMonthReportBatch
} from '../../../lib/crm-month-report';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function authorize(req:NextRequest){ assertCrmConnectorToken(req.headers.get('x-crm-connector-token')); }
function fail(error:any){
  const status=Number(error?.status)||500;
  return NextResponse.json({ok:false,error:status===401?'Unauthorized connector.':(error?.message||'CRM activity sync failed.')},{status});
}
export async function GET(req:NextRequest){
  try{ authorize(req); return NextResponse.json({ok:true,status:await getCrmMonthReportStatus()},{headers:{'cache-control':'no-store'}}); }
  catch(e:any){ return fail(e); }
}
export async function POST(req:NextRequest){
  try{
    authorize(req);
    const body=await req.json();
    const action=String(body?.action||'');
    if(action==='start') return NextResponse.json({ok:true,...await startCrmMonthReportBatch()});
    if(action==='chunk') return NextResponse.json({ok:true,...await appendCrmMonthReportChunk(String(body?.batchId||''),String(body?.dataset||''),Number(body?.seq),body?.rows)});
    if(action==='finalize') return NextResponse.json({ok:true,...await finalizeCrmMonthReportBatch(String(body?.batchId||''),body?.expected,body?.sourceCheckedAt?String(body.sourceCheckedAt):undefined,body?.range)});
    return NextResponse.json({ok:false,error:'Unknown CRM activity action.'},{status:400});
  }catch(e:any){ return fail(e); }
}
