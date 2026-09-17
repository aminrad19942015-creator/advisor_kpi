import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '../../../../lib/admin-auth';

export const runtime='nodejs';
export const maxDuration=30;

const MAX_FILE_BYTES=12*1024*1024;
export async function POST(req:NextRequest){
 try{
  if(!await isAdmin()) return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
  const form=await req.formData();
  const files=form.getAll('files').filter((x):x is File=>x instanceof File);
  if(!files.length) return NextResponse.json({ok:false,error:'هیچ فایلی دریافت نشد.'},{status:400});
  const result=[] as any[];
  for(const file of files){
   const name=file.name||'file';
   const ext=name.toLowerCase().split('.').pop();
   if(!['xlsx','xls'].includes(ext||'')) return NextResponse.json({ok:false,error:`فرمت فایل ${name} مجاز نیست.`},{status:400});
   if(file.size>MAX_FILE_BYTES) return NextResponse.json({ok:false,error:`حجم فایل ${name} بیشتر از ۱۲ مگابایت است.`},{status:400});
   result.push({name,size:file.size,type:file.type||'',status:'validated'});
  }
  return NextResponse.json({ok:true,mode:'validate-only',files:result,note:'Excel schema mapping is intentionally disabled until reference files are supplied.'});
 }catch(error:any){return NextResponse.json({ok:false,error:error?.message||String(error)},{status:500});}
}
