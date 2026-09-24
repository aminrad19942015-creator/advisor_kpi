const {restoreAll}=require('./recovery-lib');

function commandUrl(){
 const shadow=process.env.DASHBOARD_API_URL||'https://advisor-kpi.vercel.app/api/crm-shadow';
 return process.env.DASHBOARD_CONNECTOR_COMMAND_URL||shadow.replace(/\/crm-shadow\/?$/,'/connector-command');
}
async function request(url,token,options={}){
 const r=await fetch(url,{...options,headers:{'content-type':'application/json','x-crm-connector-token':token,...(options.headers||{})},signal:AbortSignal.timeout(30000)});
 const t=await r.text();if(!r.ok)throw new Error('Connector command HTTP '+r.status+': '+t);return JSON.parse(t);
}
async function processPendingCommand(token){
 const url=commandUrl(),j=await request(url,token);
 if(!j.command)return null;
 const cmd=j.command,id=Number(cmd.id);
 await request(url,token,{method:'POST',body:JSON.stringify({id,status:'running'})});
 try{
  if(cmd.command!=='restore_local_snapshots')throw new Error('Unsupported connector command: '+cmd.command);
  await restoreAll(token);
  await request(url,token,{method:'POST',body:JSON.stringify({id,status:'completed',result:'Local snapshots restored successfully.'})});
  return {id,status:'completed'};
 }catch(e){
  await request(url,token,{method:'POST',body:JSON.stringify({id,status:'failed',result:String(e?.message||e)})}).catch(()=>{});
  throw e;
 }
}
module.exports={processPendingCommand};
