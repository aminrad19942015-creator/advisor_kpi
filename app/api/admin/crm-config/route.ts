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
    const current=await getCrmAdminConfig();
    const incoming=body?.config||{};
    // Technical CRM wiring is server-controlled. Admin may change business rules
    // and source modes, but cannot alter entity/field/origin wiring from the UI/API.
    const protectedConfig={
      ...incoming,
      crmOrigin:current.crmOrigin,
      apiVersion:current.apiVersion,
      schedules:current.schedules,
      openLeads:{...(incoming.openLeads||{}),entity:current.openLeads.entity},
      lead:{...(incoming.lead||{}),entity:current.lead.entity,dateField:current.lead.dateField},
      opportunity:{...(incoming.opportunity||{}),entity:current.opportunity.entity,dateField:current.opportunity.dateField,businessUnitSource:current.opportunity.businessUnitSource},
      calls:{...(incoming.calls||{}),entity:current.calls.entity,dateField:current.calls.dateField,businessUnitSource:current.calls.businessUnitSource},
      ticket:{...(incoming.ticket||{}),queueEntity:current.ticket.queueEntity,caseEntity:current.ticket.caseEntity,dateField:current.ticket.dateField}
    };
    const config=validateCrmAdminConfig(protectedConfig);
    return NextResponse.json({ok:true,config:await saveCrmAdminConfig(config)});
  }catch(e:any){
    return NextResponse.json({ok:false,error:e?.message||String(e)},{status:400});
  }
}
