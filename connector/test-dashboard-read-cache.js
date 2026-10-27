'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {createJobPool}=require('./google-relay-worker');
const {verifyRequest}=require('./google-relay-protocol');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/RpcClient.html'),'utf8').replace(/^<script>\s*|\s*<\/script>\s*$/g,''),context);

test('offline initial snapshots reconnect even before an interactive revision exists',async()=>{
 let available=false,revision='',loads=0,accepted=0,confirmed=0,hidden=false;
 const monitor=context.createReportConnectionMonitor({
  isHidden:()=>hidden,revision:()=>revision,
  check:async()=>({available,revision:'new'}),
  load:async()=>{loads++;return {revision:'new'};},
  accept:async data=>{accepted++;revision=data.revision;},
  confirm:()=>confirmed++
 });
 await monitor.tick();assert.equal(loads,0);
 available=true;await monitor.tick();assert.equal(accepted,1);assert.equal(revision,'new');
 await monitor.tick();assert.equal(loads,1);assert.equal(confirmed,1);
 hidden=true;await monitor.tick();assert.equal(confirmed,1);
});

test('connection recovery deduplicates probes and retries after transient failures',async()=>{
 let release,checks=0,errors=0,loads=0;
 const monitor=context.createReportConnectionMonitor({revision:()=>'',check:()=>{checks++;return new Promise(resolve=>release=resolve);},
  load:async()=>{loads++;throw Error('temporary');},accept:assert.fail,confirm:assert.fail,onError:()=>errors++});
 const first=monitor.tick();await monitor.tick();assert.equal(checks,1);
 release({available:true,revision:'new'});await first;assert.equal(errors,1);assert.equal(loads,1);
 const retry=monitor.tick();assert.equal(checks,2);release({available:false});await retry;assert.equal(errors,1);
});

test('browser read cache deduplicates in-flight reads, copies results, and expires within 20 seconds',async()=>{
 let calls=0,now=0,release;
 const client=context.createReadRpcClient(async()=>{calls++;await new Promise(r=>release=r);return {rows:[{count:3}]};},{now:()=>now});
 const first=client.read('summary',[{a:1,b:2}]),second=client.read('summary',[{b:2,a:1}]);
 await Promise.resolve();assert.equal(calls,1);release();
 const [a,b]=await Promise.all([first,second]);a.rows[0].count=99;
 assert.equal(b.rows[0].count,3);assert.equal((await client.read('summary',[{a:1,b:2}])).rows[0].count,3);
 now=20001;const fresh=client.read('summary',[{a:1,b:2}]);await Promise.resolve();assert.equal(calls,2);release();await fresh;
});
test('errors are not cached and bounded memory does not mix filters',async()=>{
 let calls=0;
 const client=context.createReadRpcClient(async(method,[filter])=>{calls++;if(calls===1)throw Error('offline');return filter;},{maxEntries:2});
 await assert.rejects(client.read('x',[1]),/offline/);
 assert.equal(await client.read('x',[1]),1);await client.read('x',[2]);await client.read('x',[3]);await client.read('x',[1]);
 assert.equal(calls,5);
});

test('revision invalidation prevents old in-flight reads from repopulating a cleared cache',async()=>{
 const releases=[];let calls=0;
 const client=context.createReadRpcClient(()=>{calls++;return new Promise(resolve=>releases.push(resolve));});
 const old=client.read('summary',[]);await Promise.resolve();client.clear();
 const fresh=client.read('summary',[]);await Promise.resolve();
 releases[0]({version:'old'});await old;assert.equal(client.peek('summary',[]),null);
 const shared=client.read('summary',[]);await Promise.resolve();assert.equal(calls,2);
 releases[1]({version:'new'});await Promise.all([fresh,shared]);assert.equal(client.peek('summary',[]).value.version,'new');
});

test('expired exact-filter results render immediately while fresh results arrive in the background',async()=>{
 let now=0,release,calls=0;const rendered=[];
 const client=context.createReadRpcClient(()=>{calls++;return new Promise(r=>release=r);},{now:()=>now});
 client.remember('details',['weekly','aml',{advisor:['A']}],[{n:7}]);now=21000;
 const run=context.createLatestReadRunner(client);
 const work=run('detail','details',['weekly','aml',{advisor:['A']}],(rows,info)=>rendered.push([rows[0].n,info.refreshing]),assert.fail,()=>{});
 assert.deepEqual(rendered,[[7,true]]);await Promise.resolve();assert.equal(calls,1);
 assert.equal(client.peek('details',['weekly','aml',{advisor:['B']}]),null);
 release([{n:8}]);await work;assert.deepEqual(rendered,[[7,true],[8,false]]);
 now=321001;assert.equal(client.peek('details',['weekly','aml',{advisor:['A']}]),null);
});

test('failed refresh explicitly labels old results; memory budget prevents caching huge drilldowns',async()=>{
 let now=0;const statuses=[];
 const client=context.createReadRpcClient(async()=>{throw Error('offline');},{now:()=>now,maxBytes:100});
 client.remember('detail',[],[{n:1}]);now=21000;
 await context.createLatestReadRunner(client)('x','detail',[],(r,info)=>statuses.push(info),()=>{},()=>{});
 assert.equal(statuses[0].refreshing,true);assert.equal(statuses[1].error,true);
 client.remember('huge',[],{text:'x'.repeat(100)});assert.equal(client.peek('huge',[]),null);
});

test('changing filters invalidates an in-flight drilldown even without starting another detail',async()=>{
 let release;const rendered=[];
 const run=context.createLatestReadRunner({read:()=>new Promise(r=>release=r)});
 const work=run('detail','details',[],x=>rendered.push(x),assert.fail,()=>{});
 run.invalidate('detail');release(['obsolete']);await work;assert.deepEqual(rendered,[]);
});
test('late responses cannot overwrite the latest selected filters or clear its loading state',async()=>{
 const finish=new Map(),rendered=[],done=[];
 const run=context.createLatestReadRunner({read:(m,[key])=>new Promise(resolve=>finish.set(key,resolve))});
 const old=run('open','summary',['old'],v=>rendered.push(v),assert.fail,()=>done.push('old'));
 const latest=run('open','summary',['new'],v=>rendered.push(v),assert.fail,()=>done.push('new'));
 finish.get('new')('new data');await latest;finish.get('old')('old data');await old;
 assert.deepEqual(rendered,['new data']);assert.deepEqual(done,['new']);
});
test('two dashboard reads run concurrently while admin operations retain order',async()=>{
 let active=0,maxActive=0;const finish=new Map(),started=[],completed=[];
 const pool=createJobPool(async job=>{active++;maxActive=Math.max(maxActive,active);started.push(job.id);
  await new Promise(resolve=>finish.set(job.id,resolve));active--;return job.id;},async(job,value)=>completed.push(value),assert.fail);
 pool.start({id:'read1',method:'summary'});pool.start({id:'read2',method:'summary'});
 assert.equal(maxActive,2);finish.get('read1')();finish.get('read2')();await pool.drain();
 pool.start({id:'admin1',route:'admin',method:'update'});pool.start({id:'admin2',route:'admin',method:'update'});
 await Promise.resolve();assert.ok(!started.includes('admin2'));finish.get('admin1')();
 // Wait for the first completion and the chained second admin execution.
 for(let i=0;i<10&&!finish.has('admin2');i++)await Promise.resolve();
 assert.ok(finish.has('admin2'));finish.get('admin2')();await pool.drain();
 assert.deepEqual(completed,['read1','read2','admin1','admin2']);
});
test('actual GAS summary cache keeps filter/period keys separate, expires and honors cache revision',()=>{
 let now=0,calls=0;const values=new Map(),props=new Map([['DASHBOARD_CACHE_REV','test']]);
 const cache={get:k=>{const x=values.get(k);return x&&x.expires>now?x.value:null;},
  put:(k,value,ttl)=>values.set(k,{value,expires:now+ttl*1000}),getAll:keys=>Object.fromEntries(keys.map(k=>[k,cache.get(k)])),
  putAll:(v,ttl)=>Object.entries(v).forEach(([k,value])=>cache.put(k,value,ttl))};
 const gas=vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},
  CacheService:{getScriptCache:()=>cache},Utilities:{getUuid:()=>crypto.randomUUID(),Charset:{UTF_8:'UTF-8'},DigestAlgorithm:{SHA_256:'sha256'},
   computeDigest:(alg,value)=>crypto.createHash(alg).update(value).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/Code.gs'),'utf8'),gas);
 gas.fetchDashboardRpc_=(method,args)=>({method,args,calls:++calls});
 assert.equal(gas.getFilteredPeriodSummary('monthly',{team:['3']}).calls,1);
 assert.equal(gas.getFilteredPeriodSummary('monthly',{team:['3']}).calls,1);
 assert.equal(gas.getFilteredPeriodSummary('daily',{team:['3']}).calls,2);
 assert.equal(gas.getFilteredPeriodSummary('monthly',{team:['4']}).calls,3);
 now=15001;assert.equal(gas.getFilteredPeriodSummary('monthly',{team:['3']}).calls,4);
 gas.clearDashboardCache();assert.equal(gas.getFilteredPeriodSummary('monthly',{team:['3']}).calls,5);
 const large={text:'سلام🙂'.repeat(20000)};
 gas.cachePutJson_('large',large,15);assert.equal(gas.cacheGetJson_('large').text,large.text);
 const oldKeys=new Set(values.keys());
 gas.cachePutJson_('large',{text:'new'},15);
 // A late/evicted chunk from an old generation cannot contaminate the new manifest.
 for(const key of oldKeys)if(key.includes(':chunk:'))values.delete(key);
 assert.equal(gas.cacheGetJson_('large').text,'new');
 for(const key of values.keys())if(key.startsWith('large:')&&key.includes(':chunk:'))values.delete(key);
 assert.equal(gas.cacheGetJson_('large'),null);
});

test('actual GAS calls the signed native library for reads and safely falls back to HTTP on cache loss',()=>{
 const secret='native-library-isolated-test-secret-only';let native=0,http=0;
 const gas=vm.createContext({Utilities:{getUuid:()=>crypto.randomUUID(),Charset:{UTF_8:'UTF-8'},
  computeHmacSha256Signature:(value,key)=>crypto.createHmac('sha256',key).update(value).digest(),
  base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')},
  AdvisorQueue:{signedReadCall:env=>{native++;assert.equal(verifyRequest(secret,env),true);return {done:true,value:{count:80}};}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/Code.gs'),'utf8'),gas);
 gas.relayCall_=()=>{http++;return {done:true,value:{count:81}};};
 assert.equal(gas.relayRpc_('https://script.google.com/test',secret,'dashboard','getDashboardMeta',[]).count,80);
 assert.equal(http,0);
 gas.AdvisorQueue.signedReadCall=()=>({useHttp:true});
 assert.equal(gas.relayRpc_('https://script.google.com/test',secret,'dashboard','getDashboardMeta',[]).count,81);
 assert.equal(http,1);
 assert.equal(gas.relayRpc_('https://script.google.com/test',secret,'admin','getOverview',[]).count,81);
 assert.equal(http,2);assert.equal(native,1);
});
