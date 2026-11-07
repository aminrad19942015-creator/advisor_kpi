'use strict';
// Read-only production verification; prints aggregate counts, never ticket data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
process.loadEnvFile(process.env.ADVISOR_ENV_FILE||path.join(root,'.env.local'));
function load(file){
 const mod={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
 vm.runInNewContext(js,{module:mod,exports:mod.exports,process,console,setTimeout,clearTimeout,Buffer,require:id=>id.startsWith('.')?load(path.resolve(path.dirname(file),id+'.ts')):require(id)},{filename:file});
 return mod.exports;
}
(async()=>{
 const ready=await require('./portable-postgres.cjs').ensurePortablePostgres({databaseUrl:process.env.DATABASE_URL,dataDir:process.env.PORTABLE_POSTGRES_DATA_DIR,startIfStopped:false});
 process.env.DATABASE_URL=ready.databaseUrl;
 const db=load(path.join(root,'lib/turso.ts')),api=load(path.join(root,'lib/period.ts')),facts=load(path.join(root,'lib/report-facts.ts'));
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'gas/FilterEngine.html'),'utf8').replace(/^<script>\s*|\s*<\/script>\s*$/g,''),ctx);
 const calculate=vm.runInContext('ReportEngine.period',ctx);
 for(const [period,prefix] of Object.entries({daily:'daily',weekly:'weekly',monthly:'monthly',reportMonth:'report_month'})){
  const [counts]=await db.tursoSelect(`SELECT COUNT(*) AS raw,COUNT(*) FILTER (WHERE owner IN (SELECT name FROM team_members)) AS eligible FROM ${prefix}_tickets`);
  const expected=Number(counts.eligible),summary=await api.getFilteredPeriodSummary(period,{}),snapshot=await facts.getReportFacts(period),browser=calculate(snapshot);
  assert.equal(summary.kpis.tickets,expected);
  assert.equal(snapshot.tickets.length,expected);
  assert.equal(browser.kpis.tickets,expected);
  assert.equal(summary.advisors.reduce((n,r)=>n+r.tickets,0),expected);
  assert.equal(summary.trend.reduce((n,r)=>n+r.tickets,0),expected);
  const outsiders=await db.tursoSelect(`SELECT owner FROM ${prefix}_tickets WHERE COALESCE(owner,'')<>'' AND owner NOT IN (SELECT name FROM team_members) LIMIT 1`);
  if(outsiders.length){
   assert.equal((await api.getFilteredPeriodSummary(period,{advisor:[outsiders[0].owner]})).kpis.tickets,0);
   assert.equal((await api.getActivityDetails(period,'ticket',outsiders[0].owner,{})).length,0);
  }
  const exported=await api.getPeriodExportChunk(period,'tickets',{},0,10000);
  assert.equal(exported.length,Math.min(expected,10000));
  console.log(JSON.stringify({period,raw:Number(counts.raw),eligible:expected,excluded:Number(counts.raw)-expected,status:'TICKET_ROSTER_OK'}));
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
