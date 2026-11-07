'use strict';
// Read-only parity check against the existing PostgreSQL report implementation.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');process.chdir(root);process.loadEnvFile('.env.local');
function load(file){
 const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
 const mod={exports:{}};vm.runInNewContext(output,{module:mod,exports:mod.exports,process,console,setTimeout,clearTimeout,Buffer,require:id=>id.startsWith('.')?load(path.resolve(path.dirname(file),id+'.ts')):require(id)},{filename:file});return mod.exports;
}
const factsApi=load(path.join(root,'lib/report-facts.ts')),sqlApi=load(path.join(root,'lib/period.ts')),dashboardApi=load(path.join(root,'lib/dashboard.ts'));
const engine=vm.createContext({});vm.runInContext(fs.readFileSync('gas/FilterEngine.html','utf8').replace(/^<script>\s*|\s*<\/script>\s*$/g,''),engine);
const calculate=vm.runInContext('ReportEngine.period',engine);
function canonical(value){if(value&&typeof value.toISOString==='function')return value.toISOString().slice(0,10);if(typeof value==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(value))return value.slice(0,10);if(Array.isArray(value))return value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));if(typeof value==='number')return Math.round(value*1e7)/1e7;return value;}
(async()=>{
 const ready=await require('./portable-postgres.cjs').ensurePortablePostgres({databaseUrl:process.env.DATABASE_URL,dataDir:process.env.PORTABLE_POSTGRES_DATA_DIR,startIfStopped:false});
 process.env.DATABASE_URL=ready.databaseUrl;
 for(const period of ['daily','weekly','monthly','reportMonth']){
 const start=Date.now(),facts=await factsApi.getReportFacts(period);
 const member=facts.members.find(p=>p.role==='مشاور')||facts.members[0];
 const campaign=facts.leads.find(r=>r[2])?.[2];
 const cases=[{}, {advisor:[member.name]}, {team:[member.team]}, {role:[member.role]}, {seniorLead:[member.seniorLead].filter(Boolean)}, {campaign:[campaign].filter(Boolean)}, {advisor:[member.name],campaign:[campaign].filter(Boolean)}, {teamLead:[member.teamLead],role:[member.role]}, {advisor:['not-a-member']}];
 for(const filters of cases){const expected=await sqlApi.getFilteredPeriodSummary(period,filters),actual=calculate(facts,filters);try{assert.equal(JSON.stringify(canonical(actual)),JSON.stringify(canonical(expected)));}catch(e){console.error('PARITY_FAILED',period,JSON.stringify(Object.keys(filters)));const a=canonical(actual),b=canonical(expected);for(const key of Object.keys(a))if(JSON.stringify(a[key])!==JSON.stringify(b[key]))console.error('Mismatch section:',key,JSON.stringify(a[key]).slice(0,350),JSON.stringify(b[key]).slice(0,350));throw e;}}
 console.log(JSON.stringify({period,cases:cases.length,rawBytes:Buffer.byteLength(JSON.stringify(facts)),gzipBytes:zlib.gzipSync(JSON.stringify(facts)).length,ms:Date.now()-start,status:'PARITY_OK'}));
}
 const openFacts=await factsApi.getOpenFacts(),openEngine=vm.runInContext('ReportEngine.open',engine),teamEngine=vm.runInContext('ReportEngine.team',engine);
 const normalize=v=>JSON.parse(JSON.stringify(v,(key,value)=>key==='ageMinutes'?undefined:typeof value==='string'&&/^-?\d+(\.\d+)?$/.test(value)?Number(value):value));
 const openCases=[{}, {campaign:['Ayar','LeadAdvice'],leadType:['حقیقی']},{role:['مشاور']},{age:'31+'},{nextCallReason:['بدون تسک']},{campaign:['not-a-campaign']},{advisor:[openFacts.members[0].name]},{team:[openFacts.members[0].team],age:'8-14'}];
 for(const f of openCases)assert.equal(JSON.stringify(canonical(normalize(openEngine(openFacts,f)))),JSON.stringify(canonical(normalize(await dashboardApi.getOpenSummary(f)))));
 const all=await dashboardApi.getTeamSummary({});for(const f of [{},{role:['مشاور']},{team:[all.rows[0].team]},{search:'محمد'},{gender:['خانم'],role:['راهنما']}])assert.equal(JSON.stringify(canonical(teamEngine(all.rows,f))),JSON.stringify(canonical(await dashboardApi.getTeamSummary(f))));
 console.log(JSON.stringify({status:'OPEN_AND_TEAM_PARITY_OK',openCases:openCases.length,teamCases:5}));
})().catch(e=>{console.error(e.message.slice(0,500));process.exitCode=1});
