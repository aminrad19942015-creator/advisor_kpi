'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../lib/initial-periods.ts'),'utf8');
const server={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
 {exports:server.exports,setTimeout,clearTimeout});
const browser=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/RpcClient.html'),'utf8').replace(/^<script>\s*|\s*<\/script>\s*$/g,''),browser);
const payload=(period,generatedAt=new Date().toISOString())=>({summary:{advisors:[{period,count:5}]},campaignOptions:['Ayar'],meta:{generatedAt}});

test('all four tab summaries prepare with bounded parallelism and the original per-period payloads',async()=>{
 const pending=new Map(),requested=[];
 let allStarted;const started=new Promise(resolve=>allStarted=resolve);
 const work=server.exports.buildInitialPeriods(period=>{requested.push(period);if(requested.length===4)allStarted();return new Promise(r=>pending.set(period,r));});
 assert.deepEqual(requested,['daily','weekly']);
 pending.get('daily')(payload('daily'));pending.get('weekly')(payload('weekly'));
 await started;
 assert.deepEqual(requested,['daily','weekly','monthly','reportMonth']);
 pending.get('monthly')(payload('monthly'));pending.get('reportMonth')(payload('reportMonth'));
 const result=await work;
 for(const period of requested)assert.equal(result[period].summary.advisors[0].period,period);
});
test('an unavailable period does not break initial loading and slow work respects its time budget',async()=>{
 let finish;
 const result=await server.exports.buildInitialPeriods(period=>{
  if(period==='weekly')throw Error('unavailable');
  if(period==='monthly')return new Promise(r=>finish=r);
  return Promise.resolve(payload(period));
 },10);
 assert.ok(result.daily&&result.reportMonth);assert.equal(result.weekly,undefined);assert.equal(result.monthly,undefined);
 finish(payload('monthly'));await Promise.resolve();await Promise.resolve();
 assert.equal(result.monthly,undefined,'late work must not mutate the response');
});
test('prepared tabs render from the matching unfiltered summary without sharing mutable objects',()=>{
 const now=Date.now(),store=browser.createInitialPeriodStore({now:()=>now});
 store.seed({weekly:payload('weekly',new Date(now).toISOString()),monthly:payload('monthly',new Date(now).toISOString())});
 const weekly=store.read('weekly',{advisor:[],team:[],campaign:[]});
 assert.equal(weekly.summary.advisors[0].period,'weekly');weekly.summary.advisors[0].count=99;
 assert.equal(store.read('weekly',{}).summary.advisors[0].count,5);
 assert.equal(store.read('monthly',{}).summary.advisors[0].period,'monthly');
 assert.equal(store.read('weekly',{team:['3']}),null);
 assert.equal(store.read('weekly',{campaign:['Ayar']}),null);
});
test('prepared summary age is capped from server generation; stale or invalid tabs use the existing loader',()=>{
 let now=Date.now();const store=browser.createInitialPeriodStore({now:()=>now});
 store.seed({daily:payload('daily',new Date(now-59000).toISOString()),weekly:{summary:{},campaignOptions:[]}});
 assert.ok(store.read('daily',{}));now+=1001;
 assert.equal(store.read('daily',{}),null);assert.equal(store.read('weekly',{}),null);assert.equal(store.read('reportMonth',{}),null);
});
