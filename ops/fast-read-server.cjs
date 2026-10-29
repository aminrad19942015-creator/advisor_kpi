'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process');
const {ensurePortablePostgres}=require('./portable-postgres.cjs');
const root=path.resolve(__dirname,'..');process.chdir(root);process.loadEnvFile('.env.local');
const lock=net.createServer(s=>s.end());let child,stopping=false;
async function start(){
 if(stopping)return;
 let ready;
 try{ready=await ensurePortablePostgres({databaseUrl:process.env.DATABASE_URL,dataDir:process.env.PORTABLE_POSTGRES_DATA_DIR,startIfStopped:false});}
 catch(error){if(!stopping)setTimeout(start,15000);return;}
 if(stopping)return;
 let slot='';try{if(JSON.parse(fs.readFileSync(path.join(root,'runtime/fast-read-ready.json'),'utf8')).buildSlot==='b')slot='b';}catch{}
 const fd=fs.openSync(path.join(root,'runtime/fast-read-server.log'),'a');
 child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-H','127.0.0.1','-p','3012'],{cwd:root,windowsHide:true,env:{...process.env,DATABASE_URL:ready.databaseUrl,ADVISOR_READ_BUILD:'1',ADVISOR_READ_SLOT:slot},stdio:['ignore',fd,fd]});fs.closeSync(fd);
 child.once('exit',()=>{if(!stopping)setTimeout(start,5000);});
 child.once('error',()=>{if(!stopping)setTimeout(start,5000);});
}
function stop(){stopping=true;if(child)child.kill();lock.close();}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
lock.once('error',error=>{if(error.code!=='EADDRINUSE')console.error(error.message);});
lock.listen(3013,'127.0.0.1',start);
