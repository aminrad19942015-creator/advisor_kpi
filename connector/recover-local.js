const path=require('path');
require('dotenv').config({path:path.join(__dirname,'.env.local')});
const {readSnapshot,status}=require('./local-backup');

const shadowUrl=process.env.DASHBOARD_API_URL||'https://advisor-kpi.vercel.app/api/crm-shadow';
const activityUrl=process.env.DASHBOARD_ACTIVITY_API_URL||shadowUrl.replace(/\/crm-shadow\/?$/,'/crm-activity');
const token=process.env.CRM_CONNECTOR_TOKEN;
if(!token){console.error('Missing CRM_CONNECTOR_TOKEN in .env.local');process.exit(1);}

async function post(url,body){
 let last;
 for(let attempt=1;attempt<=4;attempt++){
  try{
   const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-crm-connector-token':token},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
   const t=await r.text();if(!r.ok)throw new Error('Recovery API HTTP '+r.status+': '+t);return JSON.parse(t);
  }catch(e){last=e;if(attempt<4)await new Promise(x=>setTimeout(x,1500*attempt));}
 }
 throw last;
}
async function restoreOpen(){
 const snap=readSnapshot('open_leads'),start=await post(shadowUrl,{action:'start'}),size=start.maxChunkRows||400;
 let seq=0;for(let i=0;i<snap.rows.length;i+=size)await post(shadowUrl,{action:'chunk',batchId:start.batchId,seq:seq++,rows:snap.rows.slice(i,i+size)});
 return post(shadowUrl,{action:'finalize',batchId:start.batchId,expectedRows:snap.rows.length,sourceCheckedAt:snap.createdAt});
}
async function restoreActivity(){
 const names=['leads','weekly_leads','monthly_leads','opportunities','weekly_opportunities','monthly_opportunities','calls','weekly_calls','monthly_calls','tickets','weekly_tickets','monthly_tickets'];
 const datasets={};
 for(const name of names)try{datasets[name]=readSnapshot(name).rows}catch{}
 if(!Object.keys(datasets).length)throw new Error('No local activity snapshots found.');
 const start=await post(activityUrl,{action:'start'}),size=start.maxChunkRows||300,expected={};
 for(const [dataset,rows] of Object.entries(datasets)){expected[dataset]=rows.length;let seq=0;for(let i=0;i<rows.length;i+=size)await post(activityUrl,{action:'chunk',batchId:start.batchId,dataset,seq:seq++,rows:rows.slice(i,i+size)});}
 return post(activityUrl,{action:'finalize',batchId:start.batchId,expected,sourceCheckedAt:new Date().toISOString()});
}
(async()=>{
 const scope=String(process.argv[2]||'all').toLowerCase();
 console.log('Local backup root:',status().root);
 if(scope==='all'||scope==='open')console.log('Open Leads restored:',await restoreOpen());
 if(scope==='all'||scope==='activity')console.log('Activity restored:',await restoreActivity());
 console.log('=== LOCAL SNAPSHOT RECOVERY SUCCESS ===');
})().catch(e=>{console.error('Local recovery failed:',e.message);process.exitCode=1;});
