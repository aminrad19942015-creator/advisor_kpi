'use strict';

const TRANSIENT=new Set([0,408,429,500,502,503,504]);
class CrmReadError extends Error {
  constructor(message,status){super(message);this.status=status;this.retryable=TRANSIENT.has(status);this.splittable=this.retryable&&status!==429;}
}

function createPagedReader({request,log=console.log,sleep=ms=>new Promise(r=>setTimeout(r,ms)),attempts=3}){
 return async function read(label,initialUrl){
  const all=[],visited=new Set();let url=initialUrl,page=0;
  while(url){
   if(visited.has(url))throw new Error(label+': repeated CRM pagination link');
   visited.add(url);
   let data;
   for(let attempt=1;attempt<=attempts;attempt++){
    let result;
    result=await request(url);
    if(result.status===200){
     try{data=JSON.parse(result.text);}catch{throw new CrmReadError(label+': CRM returned invalid JSON',200);}
     if(!Array.isArray(data.value))throw new Error(label+': CRM response has no row array');
     break;
    }
    const error=new CrmReadError(label+' CRM read failed HTTP '+result.status,result.status);
    if(!error.retryable||attempt===attempts)throw error;
    const retrySeconds=Number(result.retryAfter);
    const wait=Number.isFinite(retrySeconds)&&retrySeconds>0?Math.min(30000,retrySeconds*1000):1000*Math.pow(2,attempt-1);
    log(label+': transient HTTP '+result.status+'; retry '+(attempt+1)+'/'+attempts+' in '+wait+'ms');
    await sleep(wait);
   }
   all.push(...data.value);page++;
   log(label+' page '+page+': '+data.value.length+' - total '+all.length);
   const next=data['@odata.nextLink'];
   if(next){const parsed=new URL(next,'https://mxrm.emofid.com');if(parsed.origin!=='https://mxrm.emofid.com')throw new Error('Unexpected CRM pagination origin');url=parsed.pathname+parsed.search;}else url=null;
  }
  return all;
 };
}

// A failed later page discards this window before retrying it as smaller windows.
// Bounds stay [start,end), so no midnight records are lost or counted twice.
async function readTimeRange({read,buildUrl,label,range,idField,windowMs=86400000,minWindowMs=3600000,log=console.log,accept=()=>true,checkpoint}){
 const start=Date.parse(range.start),end=Date.parse(range.end);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||windowMs<=0||minWindowMs<=0)throw new Error('Invalid CRM time range');
 const rows=[],ids=new Set();
 async function window(a,b){
  const part={start:new Date(a).toISOString(),end:new Date(b).toISOString()};
  const key=label+'|'+part.start+'|'+part.end;
  let found=checkpoint?.read(key);
  try{if(found==null){found=(await read(label+' ['+part.start+' .. '+part.end+')',buildUrl(part))).filter(accept);checkpoint?.write(key,found);}else log(label+': resuming completed window '+part.start);}
  catch(error){
   if(!error.splittable||b-a<=minWindowMs)throw error;
   const mid=a+Math.floor((b-a)/2);
   log(label+': splitting timed-out/transient window into smaller ranges');
   await window(a,mid);await window(mid,b);return;
  }
  for(const row of found){
   if(!accept(row))continue;
   const id=String(row[idField]||'').toLowerCase();
   if(!id)throw new Error(label+': CRM row is missing '+idField);
   if(!ids.has(id)){ids.add(id);rows.push(row);}
  }
 }
 for(let a=start;a<end;a+=windowMs)await window(a,Math.min(a+windowMs,end));
 return rows;
}

module.exports={CrmReadError,createPagedReader,readTimeRange};
