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
  const nonces = new Map();
  let now = Date.now();
  const iterator = list => { let i=0; return {hasNext:()=>i<list.length,next:()=>list[i++]}; };
  const folder = {
    getFiles:()=>iterator(files.filter(file=>!file.trashed)),
    getFilesByName:name=>iterator(files.filter(file=>file.name===name&&!file.trashed)),
    getSharingAccess:()=> 'PRIVATE', getEditors:()=>[],getViewers:()=>[],
    createFile(name,content) {
      const file = {name,content,trashed:false,getName:()=>name,
        getBlob(){return {getDataAsString:()=>this.content};},
        setContent(value){this.content=value;},setTrashed(value){this.trashed=value;}};
      files.push(file);return file;
    }
  };
  const context = vm.createContext({
    Date:class extends Date {static now(){return now;}},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='GAS_RELAY_SECRET'?secret:'test-private-folder'})},
    CacheService:{getScriptCache:()=>({get:key=>nonces.get(key),put:(key,value)=>nonces.set(key,value)})},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    DriveApp:{getFolderById:()=>folder,Access:{PRIVATE:'PRIVATE'}},
    MimeType:{PLAIN_TEXT:'text/plain'},
    Utilities:{Charset:{UTF_8:'UTF-8'},getUuid:()=>crypto.randomUUID(),
      computeHmacSha256Signature:(value,key)=>crypto.createHmac('sha256',key).update(value).digest(),
      base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url'),sleep(){}},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({text,setMimeType(){return this;}})}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas-relay/Code.gs'),'utf8'),context);
  const sendEnvelope = env => JSON.parse(context.doPost({postData:{contents:JSON.stringify(env)}}).text);
  return {files,advance:ms=>{now+=ms;},sendEnvelope,envelope:body=>makeEnvelope(secret,body,now),
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
