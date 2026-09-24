const path=require('path');
require('dotenv').config({path:path.join(__dirname,'.env.local')});
const {status}=require('./local-backup');
const {restoreOpen,restoreActivity,restoreAll}=require('./recovery-lib');
const token=process.env.CRM_CONNECTOR_TOKEN;
if(!token){console.error('Missing CRM_CONNECTOR_TOKEN in .env.local');process.exit(1);}
(async()=>{
 const scope=String(process.argv[2]||'all').toLowerCase();
 console.log('Local backup root:',status().root);
 if(scope==='open')console.log('Open Leads restored:',await restoreOpen(token));
 else if(scope==='activity')console.log('Activity restored:',await restoreActivity(token));
 else console.log('All snapshots restored:',await restoreAll(token));
 console.log('=== LOCAL SNAPSHOT RECOVERY SUCCESS ===');
})().catch(e=>{console.error('Local recovery failed:',e.message);process.exitCode=1;});
