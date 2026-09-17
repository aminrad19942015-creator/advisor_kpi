import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const COOKIE='advisor_admin_session';

function password(){
 const v=process.env.ADMIN_PASSWORD;
 if(!v) throw new Error('ADMIN_PASSWORD is not configured.');
 return v;
}
function signature(){return createHmac('sha256',password()).update('advisor-kpi-admin-v1').digest('hex');}
export function verifyPassword(input:string){
 const a=Buffer.from(String(input||''));
 const b=Buffer.from(password());
 return a.length===b.length && timingSafeEqual(a,b);
}
export async function isAdmin(){
 const jar=await cookies();
 const value=jar.get(COOKIE)?.value||'';
 const expected=signature();
 const a=Buffer.from(value),b=Buffer.from(expected);
 return a.length===b.length && timingSafeEqual(a,b);
}
export async function setAdminSession(){
 const jar=await cookies();
 jar.set(COOKIE,signature(),{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:60*60*8});
}
export async function clearAdminSession(){const jar=await cookies();jar.delete(COOKIE);}
