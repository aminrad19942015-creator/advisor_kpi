'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CrmReadError,createPagedReader,readTimeRange}=require('./crm-read');
const ok=(rows,next)=>({status:200,text:JSON.stringify({value:rows,'@odata.nextLink':next})});
test('transient CRM failures retry the same page without duplicating earlier pages',async()=>{
 const calls=[],waits=[];let failed=false;
 const read=createPagedReader({log:()=>{},sleep:async ms=>waits.push(ms),request:async url=>{
  calls.push(url);if(url==='/first')return ok([{id:1}],'https://mxrm.emofid.com/next');
  if(!failed){failed=true;return {status:503,text:'SQL timeout'};}return ok([{id:2}]);
 }});
 assert.deepEqual(await read('calls','/first'),[{id:1},{id:2}]);
 assert.deepEqual(calls,['/first','/next','/next']);assert.equal(waits.length,1);
});
test('unauthorized reads fail immediately; persistent outage and throttling are bounded',async()=>{
 for(const [status,expected] of [[401,1],[503,3],[429,3]]){
  let calls=0;const read=createPagedReader({log:()=>{},sleep:async()=>{},request:async()=>{calls++;return {status,text:'error'};}});
  await assert.rejects(read('calls','/url'),e=>e.status===status);assert.equal(calls,expected);
 }
});
test('daily partitions preserve month boundaries and deduplicate stable record IDs',async()=>{
 const windows=[],start=Date.parse('2026-09-22T20:30:00Z'),end=start+2.5*86400000;
 const rows=await readTimeRange({log:()=>{},label:'calls',range:{start:new Date(start).toISOString(),end:new Date(end).toISOString()},idField:'id',buildUrl:r=>r,read:async(_,r)=>{windows.push(r);return [{id:String(r.start)},{id:'repeated'}];}});
 assert.equal(windows.length,3);assert.equal(rows.length,4);
 assert.equal(Date.parse(windows[0].start),start);assert.equal(Date.parse(windows.at(-1).end),end);
 for(let i=1;i<windows.length;i++)assert.equal(windows[i-1].end,windows[i].start);
});
test('a timeout on a later page discards the failed window then splits it without missing boundary records',async()=>{
 const start=Date.parse('2026-09-22T20:30:00Z'),end=start+86400000,mid=start+43200000;
 const source=[{id:'first',time:start},{id:'boundary',time:mid},{id:'last',time:end-1},{id:'excluded',time:end}];
 const read=createPagedReader({log:()=>{},sleep:async()=>{},request:async url=>{
  if(url==='/late')return {status:503,text:'timeout'};
  const r=JSON.parse(url),a=Date.parse(r.start),b=Date.parse(r.end);
  if(b-a>43200000)return ok([source[0]],'https://mxrm.emofid.com/late');
  return ok(source.filter(x=>x.time>=a&&x.time<b));
 }});
 const rows=await readTimeRange({read,buildUrl:JSON.stringify,log:()=>{},label:'calls',range:{start:new Date(start).toISOString(),end:new Date(end).toISOString()},idField:'id'});
 assert.deepEqual(rows.map(r=>r.id),['first','boundary','last']);
});
test('minimum window failure, missing IDs and throttling never return an incomplete success',async()=>{
 for(const status of [503,401,429]){
  let calls=0;await assert.rejects(readTimeRange({read:async()=>{calls++;throw new CrmReadError('failed',status);},buildUrl:r=>r,label:'calls',range:{start:'2026-09-22T20:30:00Z',end:'2026-09-22T21:30:00Z'},idField:'id',log:()=>{}}));assert.equal(calls,1);
 }
 await assert.rejects(readTimeRange({read:async()=>[{}],buildUrl:r=>r,label:'calls',range:{start:'2026-09-22T20:30:00Z',end:'2026-09-22T21:30:00Z'},idField:'id',log:()=>{}}),/missing id/);
});
test('malformed and cross-origin pagination cannot silently publish partial data',async()=>{
 for(const result of [{status:200,text:'<html>login</html>'},ok([],'https://example.com/next'),{status:200,text:'{}'}]){
  const read=createPagedReader({request:async()=>result,log:()=>{}});await assert.rejects(read('calls','/url'));
 }
});
