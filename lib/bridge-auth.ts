import crypto from 'node:crypto';

function tokenEqual(a:string,b:string){
 const aa=Buffer.from(a||''),bb=Buffer.from(b||'');
 return aa.length>0&&aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
}

export function assertDashboardBridgeToken(value:string|null){
 const expected=String(process.env.DASHBOARD_RPC_TOKEN||'');
 if(!expected||!tokenEqual(String(value||''),expected)){
  throw Object.assign(new Error('Unauthorized dashboard bridge.'),{status:401});
 }
}
