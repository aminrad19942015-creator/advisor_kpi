const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function timeoutMs(options={}){
  return Number(options.timeoutMs||60000);
}

function headersObject(headers){
  if(!headers) return {};
  if(typeof headers.entries==='function') return Object.fromEntries(headers.entries());
  return {...headers};
}

function parseMarkedOutput(out){
  const marker='\n__HTTP_STATUS__:';
  const i=String(out||'').lastIndexOf(marker);
  if(i<0) throw new Error('Fallback response missing HTTP status.');
  const text=String(out||'').slice(0,i);
  const status=Number(String(out||'').slice(i+marker.length).trim());
  return {status,ok:status>=200&&status<300,text};
}

function powershellRequest(url,options={}){
  const id=crypto.randomUUID();
  const cfgFile=path.join(os.tmpdir(),'advisor-kpi-http-'+id+'.json');
  const respFile=path.join(os.tmpdir(),'advisor-kpi-http-'+id+'.response.txt');
  const statusFile=path.join(os.tmpdir(),'advisor-kpi-http-'+id+'.status.txt');
  const cfg={
    url,
    method:String(options.method||'GET').toUpperCase(),
    headers:headersObject(options.headers),
    body:options.body===undefined||options.body===null?'':String(options.body),
    timeoutSec:Math.max(5,Math.ceil(timeoutMs(options)/1000)),
    respFile,
    statusFile
  };
  fs.writeFileSync(cfgFile,JSON.stringify(cfg),'utf8');

  const escapedCfgFile=cfgFile.replace(/'/g,"''");
  const ps=[
    "$ErrorActionPreference = 'Stop'",
    "$cfg = Get-Content -Raw -Encoding UTF8 -LiteralPath '"+escapedCfgFile+"' | ConvertFrom-Json",
    "$headers = @{}",
    "if ($cfg.headers) { $cfg.headers.PSObject.Properties | ForEach-Object { $headers[$_.Name] = [string]$_.Value } }",
    "$params = @{ Uri=[string]$cfg.url; Method=[string]$cfg.method; Headers=$headers; UseBasicParsing=$true; TimeoutSec=[int]$cfg.timeoutSec; ErrorAction='Stop' }",
    "if ([string]$cfg.body -ne '') { $params['Body'] = [Text.Encoding]::UTF8.GetBytes([string]$cfg.body) }",
    "try {",
    "  $r = Invoke-WebRequest @params",
    "  [IO.File]::WriteAllText([string]$cfg.respFile,[string]$r.Content,(New-Object Text.UTF8Encoding($false)))",
    "  [IO.File]::WriteAllText([string]$cfg.statusFile,[string][int]$r.StatusCode,(New-Object Text.UTF8Encoding($false)))",
    "} catch {",
    "  $resp = $_.Exception.Response",
    "  if ($resp) {",
    "    $status = [int]$resp.StatusCode",
    "    $text = ''",
    "    try { $stream=$resp.GetResponseStream(); if($stream){ $reader=New-Object IO.StreamReader($stream,[Text.Encoding]::UTF8); $text=$reader.ReadToEnd(); $reader.Dispose() } } catch {}",
    "    [IO.File]::WriteAllText([string]$cfg.respFile,[string]$text,(New-Object Text.UTF8Encoding($false)))",
    "    [IO.File]::WriteAllText([string]$cfg.statusFile,[string]$status,(New-Object Text.UTF8Encoding($false)))",
    "    exit 0",
    "  }",
    "  [Console]::Error.Write($_.Exception.Message)",
    "  exit 1",
    "}"
  ].join('\n');

  const encoded=Buffer.from(ps,'utf16le').toString('base64');
  try{
    const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',encoded],{encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024});
    if(r.error) throw r.error;
    if(r.status!==0) throw new Error('PowerShell HTTP failed ('+r.status+'): '+String(r.stderr||'').trim());
    if(!fs.existsSync(statusFile)) throw new Error('PowerShell HTTP did not write a status file.');
    const status=Number(fs.readFileSync(statusFile,'utf8').trim());
    const text=fs.existsSync(respFile)?fs.readFileSync(respFile,'utf8'):'';
    return {status,ok:status>=200&&status<300,text};
  }finally{
    for(const file of [cfgFile,respFile,statusFile]) try{fs.unlinkSync(file);}catch{}
  }
}
function curlRequest(url,options={}){
  const method=String(options.method||'GET').toUpperCase();
  const headers=headersObject(options.headers);
  const args=['-sS','--http1.1','--retry','3','--retry-delay','1','--retry-all-errors','--max-time',String(Math.max(5,Math.ceil(timeoutMs(options)/1000))),'-X',method,'-H','Expect:','-H','Connection: close'];
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
  return parseMarkedOutput(r.stdout);
}

async function dashboardRequest(url,options={}){
  try{
    const r=await fetch(url,options);
    const text=await r.text();
    return {status:r.status,ok:r.ok,text,transport:'fetch'};
  }catch(fetchError){
    console.log('Node fetch failed for dashboard; retrying with PowerShell: '+String(fetchError?.message||fetchError));
    try{
      return {...powershellRequest(url,options),transport:'powershell'};
    }catch(psError){
      console.log('PowerShell fallback failed; retrying with curl.exe: '+String(psError?.message||psError));
      return {...curlRequest(url,options),transport:'curl'};
    }
  }
}

module.exports={dashboardRequest};
