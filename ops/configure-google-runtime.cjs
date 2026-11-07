'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const envFile = path.join(root,'.env.local');
process.loadEnvFile(envFile);
const relay = new URL(process.argv[2] || '');
if (relay.origin !== 'https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(relay.pathname) || relay.search || relay.hash) throw new Error('A deployed Google Apps Script queue URL is required.');
const database = new URL(process.env.DATABASE_URL || '');
if (!['127.0.0.1','localhost','[::1]'].includes(database.hostname)) throw new Error('PostgreSQL must be local.');
let sql;
(async () => {
  try {
    const ready=await require('./portable-postgres.cjs').ensurePortablePostgres({databaseUrl:process.env.DATABASE_URL,dataDir:process.env.PORTABLE_POSTGRES_DATA_DIR,startIfStopped:false});
    sql=require('postgres')(ready.databaseUrl,{ssl:false,max:1,connect_timeout:5});
    const rows = await sql.unsafe('SHOW data_directory');
    const values = {
      GAS_RELAY_URL:relay.href,
      GAS_RELAY_POLL_MS:'5000',
      LOCAL_DASHBOARD_RPC_URL:'http://127.0.0.1:3010/api/rpc',
      PORTABLE_POSTGRES_BIN:process.env.PORTABLE_POSTGRES_BIN || 'D:/Users/m.bashirirad/Desktop/pgsql/bin',
      PORTABLE_POSTGRES_DATA_DIR:rows[0].data_directory
    };
    let text = fs.readFileSync(envFile,'utf8');
    for (const [key,value] of Object.entries(values)) {
      const line = key + '=' + value;
      const pattern = new RegExp('^' + key + '=.*$', 'm');
      text = pattern.test(text) ? text.replace(pattern, () => line) : text.trimEnd() + '\r\n' + line + '\r\n';
    }
    fs.writeFileSync(envFile,text);
    console.log('GOOGLE_LOCAL_RUNTIME_CONFIGURED; credentials were not printed.');
  } finally { if(sql)await sql.end({timeout:1}); }
})().catch(error => { console.error(error.message);process.exitCode=1; });
