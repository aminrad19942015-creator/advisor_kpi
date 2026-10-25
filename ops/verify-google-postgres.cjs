'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
process.loadEnvFile(path.join(__dirname,'../.env.local'));
const {makeEnvelope} = require('../connector/google-relay-protocol');
async function post(url,body,headers={}) {
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
  const result=await response.json();
  assert.equal(response.ok,true,'HTTP request failed');
  return result;
}
async function relay(body) {
  const result=await post(process.env.GAS_RELAY_URL,makeEnvelope(process.env.GAS_RELAY_SECRET,body));
  assert.equal(result.ok,true,result.error || 'Google queue request failed');
  return result.result;
}
(async()=>{
  const health=await relay({action:'health'});
  assert.equal(health.privateQueue,true,'The queue folder must remain private');
  assert.equal((await post(process.env.GAS_RELAY_URL,{body:{action:'claim'}})).ok,false,'Unsigned access must fail');
  const local=await post(process.env.LOCAL_DASHBOARD_RPC_URL || 'http://127.0.0.1:3010/api/rpc',{method:'getDashboardDiagnostics',args:[]},{'x-dashboard-token':process.env.DASHBOARD_RPC_TOKEN});
  assert.equal(local.ok,true);
  assert.equal(local.result.ok,true);
  const {jobId}=await relay({action:'enqueue',method:'getDashboardDiagnostics',args:[]});
  const deadline=Date.now()+150000;
  while(Date.now()<deadline){
    const result=await relay({action:'wait',jobId,waitMs:18000});
    if(!result.done)continue;
    assert.equal(result.error,null,result.error || 'Local worker failed');
    const remote=result.value;
    assert.equal(remote.ok,true);
    assert.equal(remote.provider,'PostgreSQL');
    assert.equal(remote.counts.team_members,local.result.counts.team_members);
    assert.ok(remote.counts.open_leads>0);
    console.log(JSON.stringify({status:'GOOGLE_POSTGRES_E2E_OK',privateQueue:health.privateQueue,provider:remote.provider,counts:remote.counts,meta:remote.meta,consistency:remote.consistency}));
    return;
  }
  throw new Error('The local worker did not complete the Google request in time.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
