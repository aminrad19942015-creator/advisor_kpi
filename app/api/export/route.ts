import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import { getTeamSummary, getOpenExportRows } from '../../../lib/dashboard';
import { getPeriodExportData } from '../../../lib/period';

export const runtime='nodejs';
export const maxDuration=60;

const PERIOD_TITLES:Record<string,string>={daily:'فعالیت دیروز',weekly:'فعالیت هفته',monthly:'فعالیت ماهانه'};

function filtersRows(filters:any={}){
 const rows:any[]=[];
 for(const [key,value] of Object.entries(filters||{})){
  const text=Array.isArray(value)?value.join('، '):String(value??'');
  if(text)rows.push({'فیلتر':key,'مقدار':text});
 }
 return rows.length?rows:[{'فیلتر':'وضعیت','مقدار':'بدون فیلتر'}];
}

function advisorRows(rows:any[]=[]){
 return rows.map((r:any)=>({
  'مشاور':r.name||'',
  'رده':r.role||'',
  'تیم لید':r.teamLead||'',
  'سرتیم':r.seniorLead||'',
  'تیم':r.team||'',
  'لید بسته':Number(r.leads||0),
  'لید صحبت‌شده':Number(r.talked||0),
  'فرصت OPP':Number(r.opps||0),
  'تماس':Number(r.calls||0),
  'T8':Number(r.t8||0),
  'تیکت':Number(r.tickets||0),
  'فعالیت کل':Number(r.total||0),
  'روز حضور':Number(r.attendanceDays||0),
  'سرانه تماس':Number(r.callAvg||0),
  'سرانه لید بسته':Number(r.leadAvg||0),
  'سرانه لید صحبت‌شده':Number(r.talkedAvg||0),
  'سرانه OPP':Number(r.oppAvg||0),
  'سرانه T8':Number(r.t8Avg||0),
  'سرانه تیکت':Number(r.ticketAvg||0),
  'سرانه فعالیت':Number(r.activityAvg||0)
 }));
}

const FIELD_LABELS:Record<string,string>={
 lead_number:'شماره سرنخ',created_date:'تاریخ ثبت',last_modified_date:'آخرین تغییر',customer_rank:'رتبه مشتری',
 last_status:'آخرین وضعیت',next_call_reason:'دلیل تماس بعدی',next_followup_at:'تاریخ پیگیری بعدی',customer_name:'نام مشتری',
 first_name:'نام',middle_name:'نام میانی',last_name:'نام خانوادگی',last_modified_by:'آخرین ویرایش کننده',creator:'ثبت کننده',
 owner:'مالک',lead_type:'نوع سرنخ',source:'منشا',campaign:'کمپین',source_software:'نرم افزار منشا',identity_id:'کد ملی',
 mobile:'موبایل',advisor:'مشاور',referrer:'معرف',actual_investment:'سرمایه گذاری واقعی',expected_investment:'سرمایه گذاری مورد انتظار',
 city:'شهر',business_unit:'واحد تجاری',source_ticket_subject:'موضوع تیکت منشا',source_ticket_contact_topic:'موضوع تماس تیکت منشا',
 traffic_source:'منشا ترافیک',age_days:'سن لید',opportunity_id:'کد فرصت',title:'عنوان',status:'وضعیت',
 potential_customer:'مشتری بالقوه',campaign_reference:'کمپین',ticket_source:'تیکت منشا',sales_case_type:'نوع پرونده فروش',
 investment_type:'نوع سرمایه گذاری',registration_type:'نوع ثبت',call_id:'کد تماس',subject:'موضوع تماس',user:'کاربر',
 queue:'صف تماس',planned_start:'شروع برنامه ریزی شده',start_date:'تاریخ شروع',customer:'مشتری',destination_number:'شماره مقصد',
 phone_number:'شماره تماس',parameters:'پارامترها',duration:'مدت تماس',queue_item_id:'کد صف',contact_topic:'موضوع تماس',
 main_subject:'موضوع اصلی',worked_by:'رسیدگی کننده',resolve_by:'مهلت رسیدگی',entered_queue:'ورود به صف',status_reason:'دلیل وضعیت',
 description:'توضیحات',origin:'منشا',case_number:'شماره تیکت',national_id:'کد ملی',type:'نوع',closed_at:'زمان بسته شدن',
 modified_on:'زمان آخرین تغییر',modified_by:'آخرین ویرایش کننده',created_on:'زمان ثبت',created_by:'ثبت کننده'
};

function translateRows(rows:any[]=[]){
 return rows.map((row:any)=>{
  const out:any={};
  for(const [key,value] of Object.entries(row||{}))out[FIELD_LABELS[key]||key]=value;
  return out;
 });
}

function addSheet(wb:XLSX.WorkBook,name:string,rows:any[]){
 const safeRows=rows&&rows.length?rows:[{'وضعیت':'داده‌ای برای فیلتر فعلی وجود ندارد'}];
 const ws=XLSX.utils.json_to_sheet(safeRows);
 ws['!cols']=Object.keys(safeRows[0]||{}).map(k=>({wch:Math.min(40,Math.max(12,String(k).length+4))}));
 XLSX.utils.book_append_sheet(wb,ws,name.slice(0,31));
}

export async function POST(req:NextRequest){
 try{
  const body=await req.json();
  const tab=String(body?.tab||'');
  const filters=body?.filters||{};
  const wb=XLSX.utils.book_new();
  let filename='advisor-dashboard.xlsx';

  if(tab==='team'){
   const s=await getTeamSummary(filters);
   addSheet(wb,'فهرست افراد',(s.rows||[]).map((r:any)=>({
    'نام':r.name||'','کد پرسنلی':r.personnelCode||'','ایمیل':r.email||'','تیم لید':r.teamLead||'','سرتیم':r.seniorLead||'',
    'تیم':r.team||'','جنسیت':r.gender||'','رده':r.role||'','واحد تجاری':r.businessUnit||''
   })));
   addSheet(wb,'فیلترها',filtersRows(filters));
   filename='team-overview.xlsx';
  }else if(tab==='open'){
   const rows=await getOpenExportRows(filters);
   addSheet(wb,'سرنخ های باز',rows);
   addSheet(wb,'فیلترها',filtersRows(filters));
   filename='open-leads.xlsx';
  }else if(['daily','weekly','monthly'].includes(tab)){
   const data=await getPeriodExportData(tab,filters);
   addSheet(wb,'خلاصه مشاوران',advisorRows(data.summary?.advisors||[]));
   addSheet(wb,'لیدها',translateRows(data.leads||[]));
   addSheet(wb,'فرصت ها',translateRows(data.opportunities||[]));
   addSheet(wb,'تماس ها',translateRows(data.calls||[]));
   addSheet(wb,'تیکت ها',translateRows(data.tickets||[]));
   addSheet(wb,'فیلترها',filtersRows(filters));
   filename=(PERIOD_TITLES[tab]||tab)+'.xlsx';
  }else{
   return Response.json({ok:false,error:'تب نامعتبر است.'},{status:400});
  }

  const buffer=XLSX.write(wb,{type:'buffer',bookType:'xlsx',compression:true});
  return new Response(buffer,{
   status:200,
   headers:{
    'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'cache-control':'no-store'
   }
  });
 }catch(error:any){
  return Response.json({ok:false,error:error?.message||String(error)},{status:500});
 }
}
