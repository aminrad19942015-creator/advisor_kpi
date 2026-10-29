'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{gzipSync,gunzipSync}=require('node:zlib');
function engine(){
 const ctx=vm.createContext({Blob,Response,DecompressionStream,atob});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/FilterEngine.html'),'utf8').replace(/^<script>\s*|\s*<\/script>\s*$/g,''),ctx);
 return {api:vm.runInContext('ReportEngine',ctx),create:ctx.createInteractiveReportClient};
}
function facts(){return {schema:1,period:'weekly',members:[{name:'A',role:'مشاور',team:'one'}],
 leads:[['A',1,'C','موفق','R','S','','2026-10-25',1],['A',2,'D','عدم پاسخ (۲بار)','R','S','','2026-10-26',null]],
 opps:[['A',1,'OPP','موفق','2026-10-25']],
 calls:[['A',1,'تکمیل فرم شناسایی مضاعف','T8','2026-10-25'],['A',1,'بروز رسانی اطلاعات فرم مشخصات','','2026-10-25'],['A',1,'بروز رسانی اطلاعات مشخصات و تکمیل فرم شناسایی','','2026-10-25'],['A',1,'عادی','','2026-10-26'],['A',1,'عادی','','2026-10-26']],
 tickets:[['A','بسته','موضوع','2026-10-25']]};}
test('browser report preserves AML, repeated calls, attendance, and ticket campaign semantics',()=>{
 const {api}=engine(),f=facts(),r=api.period(f,{});
 assert.equal(r.kpis.aml,3);assert.equal(r.kpis.calls,2);assert.equal(r.kpis.uniqueCalls,1);assert.equal(r.kpis.repeatCalls,1);
 assert.equal(r.kpis.talked,1);assert.equal(r.advisors[0].attendanceDays,1);
 const filtered=api.period(f,{campaign:['missing']});
 assert.equal(filtered.kpis.talked,0);assert.equal(filtered.kpis.calls,0);assert.equal(filtered.kpis.tickets,1);assert.equal(filtered.advisors[0].attendanceDays,0);
 assert.equal(api.period(f,{team:['missing']}).kpis.tickets,0);
});
test('interactive payload is memory-only, revision-bound, and expires without authoritative heartbeat',async()=>{
 const {create}=engine();let now=1000000;const c=create({now:()=>now});
 const payload={meta:{generatedAt:new Date(now).toISOString()},team:{rows:[{name:'A',role:'مشاور'}]},interactive:{revision:'r1',encoding:'gzip-base64',body:gzipSync(JSON.stringify({periods:{weekly:facts()},open:{members:[],rows:[],sourceStatus:{source:'test'}}})).toString('base64')}};
 assert.equal(await c.seed(payload),true);
 assert.equal(c.read('getFilteredPeriodSummary',['weekly',{campaign:['C']}]).value.kpis.talked,1);
 assert.equal(c.read('getActivityDetails',[]).hit,false);
 assert.equal(c.read('getTeamFilteredSummary',[{search:'%'}]).hit,false);
 now+=90001;assert.equal(c.read('getFilteredPeriodSummary',['weekly',{}]).hit,false);
 c.confirm({available:true,revision:'different',checkedAt:now});assert.equal(c.read('getTeamFilteredSummary',[{}]).hit,false);
 c.confirm({available:true,revision:'r1',checkedAt:now});assert.equal(c.read('getTeamFilteredSummary',[{}]).hit,true);
});
test('large relay results are compressed losslessly and undefined results terminate with a bounded error',()=>{
 const {completionBody}=require('./google-relay-worker'),value={rows:Array.from({length:1000},(_,i)=>({i,text:'متن نمونه'.repeat(40)}))};
 const body=completionBody('id',value);assert.equal(body.value.__transport,'gzip-json-v1');
 assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(body.value.body,'base64'))),value);
 assert.ok(JSON.stringify(body).length<JSON.stringify(value).length/10);
 assert.ok(completionBody('id',undefined).error);
});
