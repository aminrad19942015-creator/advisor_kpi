const { spawnSync } = require('child_process');

function timeoutMs(options={}){
  const signal=options.signal;
  if(signal && typeof signal.reason==='object' && signal.reason?.name==='TimeoutError') return 30000;
  return Number(options.timeoutMs||60000);
}

function headersObject(headers){
  if(!headers) return {};
  if(typeof headers.entries==='function') return Object.fromEntries(headers.entries());
  return {...headers};
}

function curlRequest(url,options={}){
  const method=String(options.method||'GET').toUpperCase();
  const headers=headersObject(options.headers);
  const args=['-sS','--max-time',String(Math.max(5,Math.ceil(timeoutMs(options)/1000))),'-X',method];
  for(const [k,v] of Object.entries(headers)) args.push('-H',String(k)+': '+String(v));
  const body=options.body===undefined||options.body===null?'':String(options.body);
  if(body) args.push('--data-binary','@-');
  args.push('-w','\n__HTTP_STATUS__:%{http_code}',url);

  const r=spawnSync('curl.exe',args,{
    input:body||undefined,
    encoding:'utf8',
    windowsHide:true,
    maxBuffer:20*1024*1024
  });
  if(r.error) throw r.error;
  if(r.status!==0) throw new Error('curl.exe failed ('+r.status+'): '+String(r.stderr||'').trim());
  const out=String(r.stdout||'');
  const marker='\n__HTTP_STATUS__:';
  const i=out.lastIndexOf(marker);
  if(i<0) throw new Error('curl.exe response missing HTTP status.');
  const text=out.slice(0,i);
  const status=Number(out.slice(i+marker.length).trim());
  return {status,ok:status>=200&&status<300,text};
}

async function dashboardRequest(url,options={}){
  try{
    const r=await fetch(url,options);
    const text=await r.text();
    return {status:r.status,ok:r.ok,text,transport:'fetch'};
  }catch(error){
    const message=String(error?.message||error);
    console.log('Node fetch failed for dashboard; retrying with curl.exe: '+message);
    const r=curlRequest(url,options);
    return {...r,transport:'curl'};
  }
}

module.exports={dashboardRequest};
