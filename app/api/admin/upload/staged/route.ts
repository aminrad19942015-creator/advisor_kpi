import { NextResponse } from 'next/server';
import { isAdmin } from '../../../../../lib/admin-auth';
import { tursoBatch,tursoSelect } from '../../../../../lib/turso';
import { inspectExcel } from '../../../../../lib/excel-import';
import { preflightImport } from '../../../../../lib/import-preflight';

export const runtime='nodejs';
export const maxDuration=300;

export async function GET(){
 try{
  if(!await isAdmin()) return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
  const cutoff=new Date(Date.now()-6*60*60*1000).toISOString();
  await tursoBatch([{sql:'DELETE FROM admin_upload_chunks WHERE created_at<?',args:[cutoff]}]);
  const groups=await tursoSelect(
   'SELECT upload_id,file_name,total_chunks,COUNT(*) count,MAX(created_at) created_at FROM admin_upload_chunks GROUP BY upload_id,file_name,total_chunks HAVING COUNT(*)=total_chunks ORDER BY MAX(created_at) DESC LIMIT 20'
  );
  const results:any[]=[];
  for(const g of groups as any[]){
   const uploadId=String(g.upload_id||''), total=Number(g.total_chunks||0), fileName=String(g.file_name||'');
   if(!uploadId||!total||!fileName) continue;
   const rows=await tursoSelect('SELECT chunk_index,data_b64 FROM admin_upload_chunks WHERE upload_id=? ORDER BY chunk_index',[uploadId]);
   if(rows.length!==total) continue;
   const parts:Buffer[]=[]; let bytes=0;
   for(const row of rows as any[]){
    const p=Buffer.from(String(row.data_b64||''),'base64');
    bytes+=p.length;
    if(bytes>20*1024*1024) throw new Error('حجم فایل Staging بیشتر از ۲۰ مگابایت است.');
    parts.push(p);
   }
   try{
    const inspected=await inspectExcel(Buffer.concat(parts),fileName);
    const preflight=await preflightImport(inspected as any);
    results.push({...preflight,uploadId,staged:true,createdAt:String(g.created_at||'')});
   }catch(e:any){
    results.push({file:fileName,uploadId,staged:true,preflightOk:false,error:e?.message||String(e),createdAt:String(g.created_at||'')});
   }
  }
  return NextResponse.json({ok:true,results});
 }catch(e:any){
  return NextResponse.json({ok:false,error:e?.message||String(e)},{status:500});
 }
}
