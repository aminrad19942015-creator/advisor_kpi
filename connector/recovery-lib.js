const {readSnapshot}=require('./local-backup');

function urls(){
 const shadow=process.env.DASHBOARD_API_URL||'https://advisor-kpi.vercel.app/api/crm-shadow';
 return {shadow,activity:process.env.DASHBOARD_ACTIVITY_API_URL||shadow.replace(/\/crm-shadow\/?$/,'/crm-activity')};
}
async function post(url,token,body){
 let last;for(let attempt=1;attempt<=4;attempt++)try{
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-crm-connector-token':token},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  const t=await r.text();if(!r.ok)throw new Error('Recovery API HTTP '+r.status+': '+t);return JSON.parse(t);
 }catch(e){last=e;if(attempt<4)await new Promise(x=>setTimeout(x,1500*attempt));}
 throw last;
}
async function restoreOpen(token){
 const {shadow}=urls(),snap=readSnapshot('open_leads'),start=await post(shadow,token,{action:'start'}),size=start.maxChunkRows||400;
 let seq=0;for(let i=0;i<snap.rows.length;i+=size)await post(shadow,token,{action:'chunk',batchId:start.batchId,seq:seq++,rows:snap.rows.slice(i,i+size)});
 return post(shadow,token,{action:'finalize',batchId:start.batchId,expectedRows:snap.rows.length,sourceCheckedAt:snap.createdAt});
}
async function restoreActivity(token){
 const {activity}=urls(),names=['leads','weekly_leads','monthly_leads','opportunities','weekly_opportunities','monthly_opportunities','calls','weekly_calls','monthly_calls','tickets','weekly_tickets','monthly_tickets'],datasets={};
 for(const name of names)try{datasets[name]=readSnapshot(name).rows}catch{}
 if(!Object.keys(datasets).length)throw new Error('No local activity snapshots found.');
 const start=await post(activity,token,{action:'start'}),size=start.maxChunkRows||300,expected={};
 for(const [dataset,rows] of Object.entries(datasets)){expected[dataset]=rows.length;let seq=0;for(let i=0;i<rows.length;i+=size)await post(activity,token,{action:'chunk',batchId:start.batchId,dataset,seq:seq++,rows:rows.slice(i,i+size)});}
 return post(activity,token,{action:'finalize',batchId:start.batchId,expected,sourceCheckedAt:new Date().toISOString()});
}
async function restoreAll(token){const open=await restoreOpen(token);const activity=await restoreActivity(token);return {open,activity};}
module.exports={restoreOpen,restoreActivity,restoreAll};
