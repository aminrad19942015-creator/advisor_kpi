'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {makeEnvelope} = require('./google-relay-protocol');

function server() {
  const secret = 'isolated-test-key-for-google-relay-only';
  const files = [];
  const cacheValues = new Map();
  let now = Date.now();
  let onSleep = null, scans = 0, reads = 0;
  const cache = {
    get:key=>{const item=cacheValues.get(key);return item&&item.expires>now?item.value:null;},
    put:(key,value,ttl=600)=>{assert.ok(Buffer.byteLength(value,'utf8')<=100000);cacheValues.set(key,{value,expires:now+ttl*1000});},
    remove:key=>cacheValues.delete(key),
    getAll:keys=>Object.fromEntries(keys.map(k=>[k,cache.get(k)]).filter(([,v])=>v!=null)),
    putAll:(values,ttl)=>Object.entries(values).forEach(([k,v])=>cache.put(k,v,ttl)),
    removeAll:keys=>keys.forEach(k=>cache.remove(k))
  };
  const iterator = list => { let i=0; return {hasNext:()=>i<list.length,next:()=>list[i++]}; };
  const folder = {
    getFiles:()=>{scans++;return iterator(files.filter(file=>!file.trashed));},
    getFilesByName:name=>iterator(files.filter(file=>file.name===name&&!file.trashed)),
    getSharingAccess:()=> 'PRIVATE', getEditors:()=>[],getViewers:()=>[],
    createFile(name,content) {
      const id=crypto.randomUUID();
      const file = {name,content,id,trashed:false,getName:()=>name,getId:()=>id,isTrashed(){return this.trashed;},
        getBlob(){reads++;return {getDataAsString:()=>this.content};},
        setContent(value){this.content=value;},setTrashed(value){this.trashed=value;}};
      files.push(file);return file;
    }
  };
  const context = vm.createContext({
    Date:class extends Date {static now(){return now;}},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='GAS_RELAY_SECRET'?secret:'test-private-folder'})},
    CacheService:{getScriptCache:()=>cache},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    DriveApp:{getFolderById:()=>folder,getFileById:id=>{const file=files.find(f=>f.id===id);if(!file)throw Error('missing');return file;},Access:{PRIVATE:'PRIVATE'}},
    MimeType:{PLAIN_TEXT:'text/plain'},
    Utilities:{Charset:{UTF_8:'UTF-8'},getUuid:()=>crypto.randomUUID(),
      computeHmacSha256Signature:(value,key)=>crypto.createHmac('sha256',key).update(value).digest(),
      base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url'),sleep(ms){now+=ms;if(onSleep)onSleep();}},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({text,setMimeType(){return this;}})}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas-relay/Code.gs'),'utf8'),context);
  const sendEnvelope = env => JSON.parse(context.doPost({postData:{contents:JSON.stringify(env)}}).text);
  return {files,cache,stats:()=>({scans,reads}),onSleep:fn=>{onSleep=fn;},clearCache:()=>cacheValues.clear(),advance:ms=>{now+=ms;},sendEnvelope,envelope:body=>makeEnvelope(secret,body,now),
    send:body=>sendEnvelope(makeEnvelope(secret,body,now))};
}

test('unauthenticated, tampered and replayed requests cannot modify the private queue', () => {
  const s=server();
  assert.equal(s.sendEnvelope({body:{action:'enqueue'}}).ok,false);
  const envelope=s.envelope({action:'health'});
  assert.equal(s.sendEnvelope({...envelope,body:{action:'enqueue'}}).ok,false);
  assert.equal(s.sendEnvelope(envelope).result.privateQueue,true);
  assert.equal(s.sendEnvelope(envelope).ok,false);
  assert.equal(s.files.length,0);
  assert.equal(s.send({action:'enqueue',method:'arbitrarySql'}).ok,false);
});

test('combined request and long-poll claim wake when a new job arrives', () => {
  const s=server();let supplied=false;
  s.onSleep(()=>{if(!supplied){supplied=true;s.send({action:'enqueue',method:'getDashboardMeta'});}});
  const claimed=s.send({action:'claim',waitMs:15000}).result;
  assert.ok(claimed.job.id);assert.ok(claimed.waitedMs<15000);
  s.onSleep(()=>{
    const job=s.send({action:'claim'}).result.job;
    if(job)s.send({action:'complete',jobId:job.id,value:{total:80}});
  });
  const result=s.send({action:'request',method:'getTeamFilteredSummary',waitMs:18000}).result;
  assert.equal(result.done,true);assert.deepEqual(result.value,{total:80});
});

test('large Unicode results are cached in bounded chunks and cache eviction falls back to Drive', () => {
  for(const evict of [false,true]){
    const s=server(),value={text:'سلام🙂'.repeat(20000)};
    const jobId=s.send({action:'enqueue',method:'getDashboardMeta'}).result.jobId;
    s.send({action:'claim'});s.send({action:'complete',jobId,value});
    if(evict)s.clearCache();
    assert.deepEqual(s.send({action:'wait',jobId}).result.value,value);
    assert.equal(s.files[0].trashed,true);
    assert.match(s.send({action:'wait',jobId}).result.error,/expired|consumed/);
  }
});

test('waiting does not repeatedly scan Drive and request action still enforces the allowlist', () => {
  const s=server();
  const jobId=s.send({action:'enqueue',method:'getDashboardMeta'}).result.jobId;
  const before=s.stats();
  assert.equal(s.send({action:'wait',jobId,waitMs:18000}).result.done,false);
  const after=s.stats();
  assert.equal(after.scans,before.scans);assert.ok(after.reads-before.reads<=10);
  assert.equal(s.send({action:'request',method:'arbitrarySql'}).ok,false);
  assert.equal(s.send({action:'request',route:'admin',method:'arbitrarySql'}).ok,false);
});

test('a dashboard request is claimed once and its result is consumed into Drive trash', () => {
  const s=server();
  const jobId=s.send({action:'enqueue',method:'getDashboardMeta',args:[]}).result.jobId;
  assert.equal(s.send({action:'claim'}).result.job.id,jobId);
  assert.equal(s.send({action:'claim'}).result.job,null);
  assert.equal(s.send({action:'complete',jobId,value:{ready:true}}).ok,true);
  assert.deepEqual(s.send({action:'wait',jobId}).result.value,{ready:true});
  assert.equal(s.files[0].trashed,true);
  assert.match(s.send({action:'wait',jobId}).result.error,/expired|consumed/);
});

test('an interrupted worker lease is recoverable and abandoned jobs expire', () => {
  const s=server();
  const jobId=s.send({action:'enqueue',method:'getDashboardMeta'}).result.jobId;
  s.send({action:'claim'});
  s.advance(46000);
  assert.equal(s.send({action:'claim'}).result.job.id,jobId);
  s.advance(10*60*1000);
  assert.equal(s.send({action:'claim'}).result.job,null);
  assert.equal(s.files[0].trashed,true);
});
