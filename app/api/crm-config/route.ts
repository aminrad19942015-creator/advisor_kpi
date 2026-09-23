import { NextRequest, NextResponse } from 'next/server';
import { assertCrmConnectorToken } from '../../../lib/crm-shadow';
import { getCrmAdminConfig } from '../../../lib/crm-config';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(req:NextRequest){
  try{
    assertCrmConnectorToken(req.headers.get('x-crm-connector-token'));
    return NextResponse.json({ok:true,config:await getCrmAdminConfig()},{headers:{'cache-control':'no-store'}});
  }catch(e:any){
    const status=Number(e?.status)||500;
    return NextResponse.json({ok:false,error:status===401?'Unauthorized connector.':(e?.message||String(e))},{status});
  }
}
