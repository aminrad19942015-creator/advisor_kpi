'use strict';
// Read-only measurements; logs contain timings/checksums, never records or secrets.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
process.loadEnvFile(path.join(root, '.env.local'));
const {makeEnvelope} = require('../connector/google-relay-protocol');
const combined = process.argv.includes('--combined');
const label = combined ? 'after' : 'before';
const cases = [
  ['getTeamFilteredSummary', [{}]],
  ['getOpenFilteredSummary', [{age:'0-3'}]],
  ['getFilteredPeriodSummary', ['monthly', {team:['3']}]]
];
async function post(url, body, headers = {}) {
  const response = await fetch(url, {method:'POST', headers:{'content-type':'application/json',...headers},
    body:JSON.stringify(body), signal:AbortSignal.timeout(45000)});
  const json = await response.json();
  if (!response.ok || json.ok !== true) throw new Error(json.error || 'Measurement request failed.');
  return json.result;
}
const relay = body => post(process.env.GAS_RELAY_URL, makeEnvelope(process.env.GAS_RELAY_SECRET, body));
function canonical(value) {
  if (Array.isArray(value)) {
    const rows=value.map(canonical);
    // SQL aggregate rows with tied counts may arrive in a different order.
    return rows.every(x=>x && typeof x==='object') ? rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))) : rows;
  }
  if (!value || typeof value!=='object') return value;
  return Object.fromEntries(Object.keys(value).filter(k=>!['generatedAt','durationSeconds','ageMinutes'].includes(k)).sort().map(k=>[k,canonical(value[k])]));
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
(async () => {
  const results = [];
  for (const [method,args] of cases) {
    let started = performance.now();
    const local = await post(process.env.LOCAL_DASHBOARD_RPC_URL, {method,args}, {'x-dashboard-token':process.env.DASHBOARD_RPC_TOKEN});
    const localMs = Math.round(performance.now()-started);
    started = performance.now();
    const first = await relay({action:combined?'request':'enqueue',method,args,waitMs:18000});
    let result = first;
    const deadline = Date.now()+150000;
    while (!result.done && Date.now()<deadline) result = await relay({action:'wait',jobId:first.jobId,waitMs:18000});
    if (!result.done || result.error) throw new Error(result.error || 'Measurement timed out.');
    const row = {method,localMs,remoteMs:Math.round(performance.now()-started),
      sameResult:digest(local)===digest(result.value),checksum:digest(result.value)};
    results.push(row);console.log(JSON.stringify(row));
    fs.mkdirSync(path.join(root,'runtime'),{recursive:true});
    fs.writeFileSync(path.join(root,'runtime','latency-'+label+'.json'),JSON.stringify(results,null,2));
    if (!row.sameResult) throw new Error('Remote result differs from the local database result: '+method);
  }
  fs.mkdirSync(path.join(root,'runtime'),{recursive:true});
  fs.writeFileSync(path.join(root,'runtime','latency-'+label+'.json'),JSON.stringify(results,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
