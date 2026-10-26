'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

function load(){
 const statements=[];
 const adapter={
  tursoBatch:async items=>items.map(item=>{
   statements.push(item);
   const s=item.sql;
   if(s.includes('FROM team_members')&&s.startsWith('SELECT name,team_lead'))return [{name:'A',role:'مشاور'}];
   if(s.includes('AS "uniqueCalls"'))return [{calls:9,aml:2,t8:1,uniqueCalls:8}];
   if(s.includes('COUNT(*) handled'))return [{handled:3,closed:3,talked:3}];
   if(s.startsWith('SELECT SUM(CASE WHEN registration_type'))return [{opp:1}];
   if(s.startsWith('SELECT COUNT(*) tickets'))return [{tickets:4}];
   if(s.startsWith('SELECT owner name,SUM'))return [{name:'A',leads:3,talked:3}];
   if(s.startsWith('SELECT creator name'))return [{name:'A',opps:1}];
   if(s.startsWith('SELECT "user" name,'))return [{name:'A',calls:9,aml:2,t8:1}];
   if(s.startsWith('SELECT owner name,COUNT'))return [{name:'A',tickets:4}];
   if(s.includes('AS "attendanceDays"'))return [];
   if(s.includes('SELECT "day" FROM'))return [{day:'2026-10-25'}];
   if(s.includes('GROUP BY "day"')&&s.includes('FROM weekly_calls'))return [{day:'2026-10-25',calls:9,aml:2,t8:1,roleGroup:'advisor'}];
   return [];
  }),
  tursoSelect:async(sql,args)=>{statements.push({sql,args});return [{name:'A',subject:'تکمیل فرم شناسایی مضاعف',phone_number:'test'}]}
 };
 const mod={exports:{}};
 const source=fs.readFileSync(path.join(__dirname,'../lib/period.ts'),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
  {exports:mod.exports,require:id=>{assert.equal(id,'./turso');return adapter}});
 return {api:mod.exports,statements};
}

test('AML survives summary, advisor averages, totals and every trend without forcing one attendance day',async()=>{
 const {api,statements}=load();
 const result=await api.getFilteredPeriodSummary('weekly',{});
 assert.equal(result.kpis.aml,2);assert.equal(result.kpis.calls,9);
 assert.equal(result.kpis.total,11);assert.equal(result.kpis.amlAvg,2);assert.equal(result.kpis.amlAvgPerPerson,2);
 const a=result.advisors[0];
 assert.equal(a.aml,2);assert.equal(a.total,11);assert.equal(a.amlAvg,2);assert.equal(a.attendanceDays,0);
 assert.ok(Number.isFinite(a.activityAvg));
 for(const trend of [result.trend,result.teamTrend,result.unitTrend,result.roleTrend.advisor]){
  assert.equal(trend[0].aml,2);assert.equal(trend[0].total,3);
 }
 const calls=statements.find(s=>s.sql.includes('AS "uniqueCalls"')).sql;
 for(const subject of ['تکمیل فرم شناسایی مضاعف','بروز رسانی اطلاعات فرم مشخصات','بروز رسانی اطلاعات مشخصات و تکمیل فرم شناسایی'])assert.ok(calls.includes(subject));
 assert.ok(calls.includes("'ي','ی'"));assert.ok(calls.includes("'ك','ک'"));
 assert.match(calls,/CASE WHEN NOT/);
});

test('attendance restores talked + T8 + AML + tickets >= 5 and preserves campaign and advisor filters',async()=>{
 const {api,statements}=load();
 await api.getFilteredPeriodSummary('weekly',{advisor:['A'],campaign:['C']});
 const attendance=statements.find(s=>s.sql.includes('AS "attendanceDays"'));
 assert.match(attendance.sql,/HAVING SUM\(activity_count\)>=5/);
 for(const table of ['weekly_leads','weekly_calls','weekly_tickets'])assert.ok(attendance.sql.includes(table));
 assert.ok(attendance.sql.includes('تکمیل فرم شناسایی مضاعف'));
 assert.ok(attendance.sql.includes("AT TIME ZONE 'Asia/Tehran'"));
 assert.deepEqual(Array.from(attendance.args),['A','C','A','C','A']);
 assert.ok(!attendance.sql.includes('weekly_opportunities'));
});

test('AML drilldowns accept both advisor and KPI routes; ordinary and repeated calls exclude AML',async()=>{
 const {api,statements}=load();
 for(const period of ['daily','weekly','monthly','reportMonth']){
  const details=await api.getActivityDetails(period,'aml','A',{campaign:['C']});
  assert.equal(details.length,1);assert.equal(details[0].phone_number,undefined);
  assert.match(statements.at(-1).sql,/AND REPLACE\(REPLACE/);
  assert.deepEqual(Array.from(statements.at(-1).args),['A','C']);
  await api.getPeriodKpiDetails(period,'aml',{});
  assert.match(statements.at(-1).sql,/AND REPLACE\(REPLACE/);
 }
 await api.getActivityDetails('weekly','call','A',{});
 assert.match(statements.at(-1).sql,/AND NOT \(/);
 await api.getPeriodKpiDetails('weekly','calls',{});
 assert.match(statements.at(-1).sql,/AND NOT \(/);
 await api.getRepeatedCallDetails('weekly',{});
 assert.equal((statements.at(-1).sql.match(/NOT \(/g)||[]).length,2);
});
