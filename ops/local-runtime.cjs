'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {spawn, execFileSync} = require('node:child_process');
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
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('A loopback PostgreSQL URL is required.');
  if (!await portOpen(Number(url.port || 5432))) {
    const data = process.env.PORTABLE_POSTGRES_DATA_DIR, bin = process.env.PORTABLE_POSTGRES_BIN;
    if (!data || !bin) throw new Error('Portable PostgreSQL is stopped; its data/bin paths must be configured.');
    execFileSync(path.join(bin,'pg_ctl.exe'), ['-D',data,'-l',path.join(runtime,'postgres-start.log'),'start','-w','-t','30'], {windowsHide:true,stdio:'ignore'});
  }
  const sql = require('postgres')(process.env.DATABASE_URL,{ssl:false,max:1,connect_timeout:5});
  try { await sql.unsafe('SELECT 1'); } finally { await sql.end({timeout:1}); }
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
guard.listen(port + 1, '127.0.0.1', () => start().catch(error => {
  console.error(error.message); process.exitCode = 1; stop();
}));
