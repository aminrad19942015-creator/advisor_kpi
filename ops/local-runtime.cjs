'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {ensurePortablePostgres} = require('./portable-postgres.cjs');
const root = path.resolve(__dirname, '..');
process.chdir(root);
process.loadEnvFile(path.join(root, '.env.local'));
const port = Number(process.env.LOCAL_GATEWAY_PORT || 3010);
const runtime = path.join(root, 'runtime');
fs.mkdirSync(runtime, {recursive:true});
const children = new Map();
const timers = new Set();
let stopping = false;
const guard = net.createServer(socket => socket.end());
function note(message) { console.log(new Date().toISOString(), message); }
function later(fn, ms) {
  const timer = setTimeout(() => { timers.delete(timer); if (!stopping) fn(); }, ms);
  timers.add(timer);
}
function runChild(name, args, extraEnv = {}) {
  if (stopping || children.has(name)) return;
  const output = fs.openSync(path.join(runtime, name + '.log'), 'a');
  const child = spawn(process.execPath, args, {cwd:root, windowsHide:true,
    env:{...process.env,...extraEnv}, stdio:['ignore',output,output]});
  fs.closeSync(output);
  children.set(name, child);
  note(name + ' started pid=' + child.pid);
  child.on('error', error => note(name + ' could not start: ' + error.code));
  child.on('exit', code => {
    children.delete(name);
    note(name + ' exited code=' + code);
    later(() => runChild(name, args, extraEnv), 5000);
  });
}
async function portOpen(targetPort) {
  return new Promise(resolve => {
    const socket = net.connect({host:'127.0.0.1',port:targetPort});
    socket.setTimeout(2000);
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}
async function ensureDatabase() {
  const ready=await ensurePortablePostgres({databaseUrl:process.env.DATABASE_URL,
    dataDir:process.env.PORTABLE_POSTGRES_DATA_DIR,bin:process.env.PORTABLE_POSTGRES_BIN,
    logFile:path.join(runtime,'postgres-start.log'),startIfStopped:true});
  process.env.DATABASE_URL=ready.databaseUrl;
  note('Portable PostgreSQL verified on loopback port='+ready.port+'; existing cluster was not restarted.');
}
async function ensureGateway() {
  if (stopping) return;
  if (!await portOpen(port)) {
    runChild('local-gateway', [require.resolve('next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)]);
  }
  later(() => ensureGateway().catch(error => note('Gateway check failed: ' + error.message)), 10000);
}
async function start() {
  if (!process.env.GAS_RELAY_URL?.startsWith('https://script.google.com/macros/s/') || (process.env.GAS_RELAY_SECRET || '').length < 32) throw new Error('The Google queue URL and secret are not configured.');
  if (!process.env.DASHBOARD_RPC_TOKEN) throw new Error('Dashboard bridge token is missing.');
  await ensureDatabase();
  await ensureGateway();
  runChild('google-relay-worker', [path.join(root,'connector/google-relay-worker.js')], {LOCAL_DASHBOARD_RPC_URL:'http://127.0.0.1:' + port + '/api/rpc'});
  note('LOCAL_POSTGRES_RUNTIME_READY; gateway and database listen only on loopback.');
}
function stop() {
  if (stopping) return;
  stopping = true;
  for (const timer of timers) clearTimeout(timer);
  for (const child of children.values()) child.kill();
  guard.close();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
guard.once('error', error => {
  if (error.code === 'EADDRINUSE') note('A local runtime is already running.');
  else { console.error(error.message); process.exitCode = 1; }
});
async function boot(){
 try{await start();}catch(error){note('Runtime startup waiting: '+error.message);later(boot,15000);}
}
guard.listen(port + 1, '127.0.0.1', boot);
