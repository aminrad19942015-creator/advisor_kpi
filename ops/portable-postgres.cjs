'use strict';
// Reuse a verified, already-running portable cluster. Never stop/reconfigure it.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{execFile}=require('node:child_process');
const normalized=p=>path.resolve(p).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
function livePostmaster(dataDir,read=fs.readFileSync,alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}){
 if(!dataDir)return null;
 try{
  const lines=read(path.join(dataDir,'postmaster.pid'),'utf8').split(/\r?\n/),pid=Number(lines[0]),port=Number(lines[3]);
  if(!Number.isInteger(pid)||pid<=0||!Number.isInteger(port)||port<1||port>65535||normalized(lines[1])!==normalized(dataDir)||!alive(pid))return null;
  return {pid,port};
 }catch{return null;}
}
function portOpen(port){return new Promise(resolve=>{
 const socket=net.connect({host:'127.0.0.1',port});let done=false;
 function finish(ok){if(done)return;done=true;socket.destroy();resolve(ok);}
 socket.setTimeout(2000);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));
});}
async function verify(url,dataDir){
 const sql=require('postgres')(url,{ssl:false,max:1,connect_timeout:8,prepare:false});
 try{
  const [row]=await sql.unsafe("SELECT current_setting('data_directory') AS data_directory,current_setting('port') AS port");
  if(dataDir&&normalized(row.data_directory)!==normalized(dataDir))throw Error('PostgreSQL cluster identity does not match the configured data directory.');
  if(Number(row.port)!==Number(new URL(url).port||5432))throw Error('Unexpected PostgreSQL server port.');
 }finally{await sql.end({timeout:1}).catch(()=>{});}
}
function startArgs(dataDir,logFile,port){
 if(!dataDir||!logFile||!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid portable PostgreSQL startup configuration.');
 return ['-D',dataDir,'-l',logFile,'-o','-h 127.0.0.1 -p '+port,'start','-w','-t','30'];
}
function startCluster(bin,args){return new Promise((resolve,reject)=>{
 execFile(path.join(bin,'pg_ctl.exe'),args,{windowsHide:true,timeout:35000,maxBuffer:65536},error=>error?reject(Error('Portable PostgreSQL startup failed; see runtime/postgres-start.log.')):resolve());
});}
async function ensurePortablePostgres(options,deps={}){
 const url=new URL(options.databaseUrl||'');
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('A loopback PostgreSQL URL is required.');
 const configuredPort=Number(url.port||5432),open=deps.portOpen||portOpen,check=deps.verify||verify;
 const running=(deps.livePostmaster||livePostmaster)(options.dataDir);
 let actualPort=configuredPort;
 if(!await open(configuredPort)){
  if(running){
   // A previous launcher may have omitted -p and started this same cluster on 5432.
   if(!await open(running.port))throw Error('The portable PostgreSQL process is not accepting connections yet.');
   actualPort=running.port;
  }else{
   if(!options.startIfStopped)throw Error('Portable PostgreSQL is not ready yet.');
   if(!options.dataDir||!options.bin)throw Error('Portable PostgreSQL data/bin paths are not configured.');
   await (deps.startCluster||startCluster)(options.bin,startArgs(options.dataDir,options.logFile,configuredPort));
   if(!await open(configuredPort))throw Error('Portable PostgreSQL did not open its configured port.');
  }
 }
 url.hostname='127.0.0.1';url.port=String(actualPort);
 await check(url.toString(),options.dataDir);
 return {databaseUrl:url.toString(),port:actualPort,reusedAlternatePort:actualPort!==configuredPort};
}
module.exports={ensurePortablePostgres,livePostmaster,startArgs};
