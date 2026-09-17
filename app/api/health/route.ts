import { NextResponse } from 'next/server';
import { getMeta } from '../../../lib/dashboard';

export const runtime = 'nodejs';

export async function GET(){
  try{
    const meta = await getMeta();
    return NextResponse.json({
      ok: true,
      service: 'advisor-kpi',
      database: 'turso',
      dataVersion: meta.dataVersion,
      lastSyncAt: meta.lastSyncAt,
      checkedAt: new Date().toISOString(),
    }, { headers: { 'cache-control': 'no-store' } });
  }catch(error:any){
    return NextResponse.json({
      ok: false,
      service: 'advisor-kpi',
      error: error?.message || String(error),
      checkedAt: new Date().toISOString(),
    }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
