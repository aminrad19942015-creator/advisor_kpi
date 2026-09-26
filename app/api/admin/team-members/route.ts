import {NextRequest,NextResponse} from 'next/server';
import {isAdmin} from '../../../../lib/admin-auth';
import {tursoBatch,tursoSelect} from '../../../../lib/turso';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const fields=['name','personnel_code','email','team_lead','senior_lead','team','gender','role','business_unit'] as const;

function cleanMember(input:any){
 const out:any={};
 for(const f of fields) out[f]=String(input?.[f]??'').trim();
 if(!out.name) throw new Error('نام و نام خانوادگی الزامی است.');
 if(!out.personnel_code) throw new Error('کد پرسنلی الزامی است.');
 return out;
}

export async function GET(){
 try{
  if(!await isAdmin()) return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
  const members=await tursoSelect(`
   SELECT name,personnel_code,email,team_lead,senior_lead,team,gender,role,business_unit
   FROM team_members
   ORDER BY name
  `);
  return NextResponse.json({ok:true,members},{headers:{'cache-control':'no-store'}});
 }catch(e:any){return NextResponse.json({ok:false,error:e?.message||String(e)},{status:500});}
}

export async function POST(req:NextRequest){
 try{
  if(!await isAdmin()) return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
  const m=cleanMember(await req.json());
  await tursoBatch([{sql:`
   INSERT INTO team_members(name,personnel_code,email,team_lead,senior_lead,team,gender,role,business_unit)
   VALUES(?,?,?,?,?,?,?,?,?)
  `,args:fields.map(f=>m[f])}]);
  return NextResponse.json({ok:true});
 }catch(e:any){
  const msg=String(e?.message||e);
  return NextResponse.json({ok:false,error:msg.includes('unique')?'این کد پرسنلی قبلاً ثبت شده است.':msg},{status:400});
 }
}

export async function PUT(req:NextRequest){
 try{
  if(!await isAdmin()) return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
  const body=await req.json();
  const rows=Array.isArray(body?.members)?body.members:[body];
  if(!rows.length) return NextResponse.json({ok:true,updated:0});
  const statements=rows.map((row:any)=>{
   const originalCode=String(row?.original_personnel_code||'').trim();
   if(!originalCode) throw new Error('کد پرسنلی رکورد اصلی مشخص نیست.');
   const m=cleanMember(row);
   return {sql:`
    UPDATE team_members
    SET name=?,personnel_code=?,email=?,team_lead=?,senior_lead=?,team=?,gender=?,role=?,business_unit=?
    WHERE personnel_code=?
   `,args:[...fields.map(f=>m[f]),originalCode]};
  });
  await tursoBatch(statements);
  return NextResponse.json({ok:true,updated:rows.length});
 }catch(e:any){
  const msg=String(e?.message||e);
  return NextResponse.json({ok:false,error:msg.includes('unique')?'حداقل یکی از کدهای پرسنلی تکراری است.':msg},{status:400});
 }
}

export async function DELETE(req:NextRequest){
 try{
  if(!await isAdmin()) return NextResponse.json({ok:false,error:'دسترسی غیرمجاز.'},{status:401});
  const body=await req.json();
  const code=String(body?.personnel_code||'').trim();
  if(!code) throw new Error('کد پرسنلی الزامی است.');
  await tursoBatch([{sql:'DELETE FROM team_members WHERE personnel_code=?',args:[code]}]);
  return NextResponse.json({ok:true});
 }catch(e:any){return NextResponse.json({ok:false,error:e?.message||String(e)},{status:400});}
}
