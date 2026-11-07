'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {assertReleaseBranch,assertClean,assertTarget,digest,verifyDeployment} = require('./deploy-gas.cjs');
const {validate} = require('./validate-gas.cjs');
const root = path.resolve(__dirname,'..');
test('deployment verification tolerates stale Google reads but stops on persistent mismatch',()=>{
  let calls=0;
  const read=()=>[{deploymentId:'existing',versionNumber:++calls<3?28:29}];
  assert.equal(verifyDeployment(read,{deploymentId:'existing'},29).versionNumber,29);
  assert.equal(calls,3);
  calls=0;
  assert.throws(()=>verifyDeployment(()=>{calls++;return [{deploymentId:'existing',versionNumber:28}];},{deploymentId:'existing'},29));
  assert.equal(calls,5);
});
test('reject main, detached HEAD, dirty source and missing/head deployments',()=>{
  assert.throws(()=>assertReleaseBranch('main'));
  assert.throws(()=>assertReleaseBranch('HEAD'));
  assert.doesNotThrow(()=>assertReleaseBranch('monthly-report-v1'));
  assert.throws(()=>assertClean(' M gas/Styles.html'));
  assert.throws(()=>assertTarget([], {deploymentId:'existing'}));
  assert.throws(()=>assertTarget([{deploymentId:'existing'}], {deploymentId:'existing'}));
  assert.equal(assertTarget([{deploymentId:'existing',versionNumber:28}],{deploymentId:'existing'}).versionNumber,28);
});
test('staging needs no .env and removes stale/secret setup source',()=>{
  execFileSync(process.execPath,[path.join(__dirname,'stage-google-project.cjs'),'dashboard']);
  const stage = path.join(root,'runtime/gas-dashboard-deploy');
  fs.writeFileSync(path.join(stage,'OwnerSetup.gs'),'secret placeholder');
  fs.writeFileSync(path.join(stage,'Removed.html'),'old include');
  execFileSync(process.execPath,[path.join(__dirname,'stage-google-project.cjs'),'dashboard']);
  assert(!fs.existsSync(path.join(stage,'OwnerSetup.gs')));
  assert(!fs.existsSync(path.join(stage,'Removed.html')));
  validate(stage);
  assert.equal(JSON.parse(fs.readFileSync(path.join(stage,'appsscript.json'))).webapp.access,'ANYONE_ANONYMOUS');
});
test('missing includes prevent publication',()=>{
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'advisor-gas-test-'));
  try {
    for (const name of fs.readdirSync(path.join(root,'gas')).filter(n=>/\.(gs|html|json)$/.test(n))) fs.copyFileSync(path.join(root,'gas',name),path.join(temp,name));
    fs.unlinkSync(path.join(temp,'RpcClient.html'));
    assert.throws(()=>validate(temp),/Missing include RpcClient/);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
test('hash tolerates clasp gs/js conversion, CRLF and manifest key order',()=>{
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'advisor-gas-hash-'));
  try {
    const a = path.join(temp,'a'), b = path.join(temp,'b');
    fs.mkdirSync(a); fs.mkdirSync(b);
    fs.writeFileSync(path.join(a,'Code.gs'),'function ok() {}\r\n');
    fs.writeFileSync(path.join(b,'Code.js'),'function ok() {}\n');
    fs.writeFileSync(path.join(a,'appsscript.json'),'{"a":1,"b":2}');
    fs.writeFileSync(path.join(b,'appsscript.json'),'{"b":2,"a":1}');
    assert.deepEqual(digest(a),digest(b));
    fs.writeFileSync(path.join(b,'Code.js'),'function changed() {}');
    assert.notDeepEqual(digest(a),digest(b));
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
