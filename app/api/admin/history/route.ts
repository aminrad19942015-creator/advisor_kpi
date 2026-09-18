import { NextResponse } from 'next/server';
import { isAdmin } from '../../../../lib/admin-auth';
import { tursoBatch,tursoSelect } from '../../../../lib/turso';

export const runtime='nodejs';

async function ensure(){
 await tursoBatch([{sql:'CREATE TABLE IF NOT EXISTS admin_import_history (id INTEGER PRIMARY KEY AUTOINCREMENT,file_name TEXT NOT NULL,dataset TEXT NOT NULL,target_table TEXT NOT NULL,rows INTEGER NOT NULL,verified_rows INTEGER NOT NULL,data_version TEXT,synced_at TEXT NOT NULL,status TEXT NOT NULL)'}]);
}

export async function GET(){
 try{
  if(!await isAdmin()) return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
  await ensure();
  const rows=await tursoSelect('SELECT id,file_name,dataset,target_table,rows,verified_rows,data_version,synced_at,status FROM admin_import_history ORDER BY id DESC LIMIT 50');
  return NextResponse.json({ok:true,rows});
 }catch(e:any){
  return NextResponse.json({ok:false,error:e?.message||String(e)},{status:500});
 }
}
