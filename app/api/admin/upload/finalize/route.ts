import { NextRequest,NextResponse } from 'next/server';
import { isAdmin } from '../../../../../lib/admin-auth';
import { tursoBatch,tursoSelect } from '../../../../../lib/turso';
import { inspectExcel,replaceExcel } from '../../../../../lib/excel-import';
import { preflightImport } from '../../../../../lib/import-preflight';
export const runtime='nodejs';
export const maxDuration=300;
const ID=/^[a-zA-Z0-9_-]{8,120}$/;

export async function POST(req:NextRequest){
 let uploadId='';
 try{
  if(!await isAdmin())return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
  const b=await req.json();
  uploadId=String(b.uploadId||'');
  const action=b.action==='replace'?'replace':'validate';
  if(!ID.test(uploadId))return NextResponse.json({ok:false,error:'شناسه Upload نامعتبر است.'},{status:400});
  const meta=await tursoSelect('SELECT file_name,total_chunks,COUNT(*) count FROM admin_upload_chunks WHERE upload_id=? GROUP BY file_name,total_chunks',[uploadId]);
  if(!meta.length)return NextResponse.json({ok:false,error:'فایل موقت پیدا نشد یا منقضی شده است. دوباره Preflight را اجرا کن.'},{status:400});
  const m:any=meta[0],total=Number(m.total_chunks||0),count=Number(m.count||0);
  if(!total||count!==total)return NextResponse.json({ok:false,error:`فایل ناقص است (${count} از ${total} بخش).`},{status:400});
  const parts:Buffer[]=[];let bytes=0;
  for(let i=0;i<total;i++){
   const r=await tursoSelect('SELECT data_b64 FROM admin_upload_chunks WHERE upload_id=? AND chunk_index=? LIMIT 1',[uploadId,i]);
   if(!r.length)throw new Error(`Chunk ${i} یافت نشد.`);
   const p=Buffer.from(String(r[0].data_b64||''),'base64');bytes+=p.length;
   if(bytes>20*1024*1024)throw new Error('حجم فایل بیشتر از ۲۰ مگابایت است.');
   parts.push(p);
  }
  const buffer=Buffer.concat(parts);
  let result:any;
  if(action==='replace'){
   const inspected=await inspectExcel(buffer,String(m.file_name));
   const preflight=await preflightImport(inspected as any);
   if(!preflight.preflightOk)throw new Error('Preflight ناموفق است: '+preflight.missingCritical.join('، '));
   result=await replaceExcel(buffer,String(m.file_name));
   const verify=await tursoSelect(`SELECT COUNT(*) count FROM "${String(result.target).replace(/"/g,'')}"`);
   const verifiedRows=Number((verify[0] as any)?.count||0);
   if(verifiedRows!==Number(result.rows))throw new Error(`Verify نهایی ناموفق است: ${verifiedRows} ردیف در مقصد، ${result.rows} ردیف در فایل.`);
   result={...result,verifiedRows,verified:true};
   await tursoBatch([{sql:'DELETE FROM admin_upload_chunks WHERE upload_id=?',args:[uploadId]}]);
  }else{
   const inspected=await inspectExcel(buffer,String(m.file_name));
   result=await preflightImport(inspected as any);
   result={...result,uploadId,staged:true};
   // Intentionally keep validated chunks for the confirmation step. They are reused by Replace.
  }
  return NextResponse.json({ok:true,action,result,uploadId});
 }catch(e:any){
  // Keep validated staging on replace failure so the admin can retry without uploading again.
  if(uploadId && String((await Promise.resolve(req)).method)===''){}
  return NextResponse.json({ok:false,error:e?.message||String(e)},{status:500});
 }
}
