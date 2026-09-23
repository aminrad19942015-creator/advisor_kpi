import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '../../../../lib/admin-auth';
import { getCrmAdminConfig, saveCrmAdminConfig, validateCrmAdminConfig } from '../../../../lib/crm-config';

export const runtime='nodejs';

export async function GET(){
  try{
    if(!await isAdmin()) return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
    return NextResponse.json({ok:true,config:await getCrmAdminConfig()},{headers:{'cache-control':'no-store'}});
  }catch(e:any){
    return NextResponse.json({ok:false,error:e?.message||String(e)},{status:500});
  }
}

export async function PUT(req:NextRequest){
  try{
    if(!await isAdmin()) return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
    const body=await req.json();
    const config=validateCrmAdminConfig(body?.config);
    return NextResponse.json({ok:true,config:await saveCrmAdminConfig(config)});
  }catch(e:any){
    return NextResponse.json({ok:false,error:e?.message||String(e)},{status:400});
  }
}
