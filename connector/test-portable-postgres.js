'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {ensurePortablePostgres,livePostmaster,startArgs}=require('../ops/portable-postgres.cjs');
const options={databaseUrl:'postgres://test:test@127.0.0.1:55432/dashboard',dataDir:path.resolve('test-cluster'),bin:'test-bin',logFile:'test-log',startIfStopped:true};
test('startup explicitly passes the configured loopback port to PostgreSQL',async()=>{
 let running=false,args;const checks=[];
 const ready=await ensurePortablePostgres(options,{livePostmaster:()=>null,portOpen:async port=>{assert.equal(port,55432);return running;},startCluster:async(bin,a)=>{assert.equal(bin,'test-bin');args=a;running=true;},verify:async(url,dir)=>checks.push([new URL(url).port,dir])});
 assert.equal(ready.port,55432);assert.deepEqual(args,startArgs(options.dataDir,options.logFile,55432));
 assert.equal(args[args.indexOf('-o')+1],'-h 127.0.0.1 -p 55432');assert.deepEqual(checks,[['55432',options.dataDir]]);
});
test('a running same-cluster alternate port is reused without stopping or starting PostgreSQL',async()=>{
 let checked;
 const ready=await ensurePortablePostgres(options,{livePostmaster:()=>({pid:12,port:5432}),portOpen:async port=>port===5432,startCluster:assert.fail,verify:async(url,dir)=>{checked=[new URL(url).port,dir];}});
 assert.equal(ready.port,5432);assert.equal(ready.reusedAlternatePort,true);assert.equal(new URL(ready.databaseUrl).hostname,'127.0.0.1');assert.deepEqual(checked,['5432',options.dataDir]);
 assert.equal(new URL(options.databaseUrl).port,'55432','persistent configuration must not be changed');
});
test('readers wait for PostgreSQL and never launch another cluster during startup recovery',async()=>{
 await assert.rejects(ensurePortablePostgres({...options,startIfStopped:false},{livePostmaster:()=>null,portOpen:async()=>false,startCluster:assert.fail,verify:assert.fail}),/not ready/);
 await assert.rejects(ensurePortablePostgres(options,{livePostmaster:()=>({pid:1,port:5432}),portOpen:async()=>false,startCluster:assert.fail,verify:assert.fail}),/not accepting/);
});
test('non-loopback URLs and cluster identity failures never cause a fallback startup',async()=>{
 await assert.rejects(ensurePortablePostgres({...options,databaseUrl:'postgres://test:test@example.com/db'}),/loopback/);
 await assert.rejects(ensurePortablePostgres(options,{livePostmaster:()=>null,portOpen:async()=>true,startCluster:assert.fail,verify:async()=>{throw Error('cluster identity mismatch');}}),/identity/);
});
test('only a live postmaster PID file for the configured data directory can supply an alternate port',()=>{
 const record=dir=>`42\n${dir}\n1700000000\n5432\n\nlocalhost\n\nready\n`;
 assert.deepEqual(livePostmaster(options.dataDir,()=>record(options.dataDir),()=>true),{pid:42,port:5432});
 assert.equal(livePostmaster(options.dataDir,()=>record(path.resolve('different-cluster')),()=>true),null);
 assert.equal(livePostmaster(options.dataDir,()=>record(options.dataDir),()=>false),null);
 assert.equal(livePostmaster(options.dataDir,()=>record(options.dataDir).replace('5432','99999'),()=>true),null);
});
