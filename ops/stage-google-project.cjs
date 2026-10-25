'use strict';
// Builds an ignored publication directory. Credentials never enter Git sources.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
process.loadEnvFile(path.join(root,'.env.local'));
const project = process.argv[2];
if (!['dashboard','relay'].includes(project)) throw new Error('Choose dashboard or relay.');
const bootstrap = process.argv.includes('--bootstrap');
const targets = require('./apps-script-targets.json');
const source = path.join(root, project === 'relay' ? 'gas-relay' : 'gas');
const output = path.join(root,'runtime','gas-' + project + '-deploy');
fs.mkdirSync(output,{recursive:true});
for (const name of fs.readdirSync(source)) {
  if (/\.(gs|html)$/.test(name)) fs.copyFileSync(path.join(source,name),path.join(output,name));
}
const manifest = JSON.parse(fs.readFileSync(path.join(source,'appsscript.json'),'utf8'));
if (project === 'dashboard') manifest.webapp.access = targets.dashboard.access;
fs.writeFileSync(path.join(output,'appsscript.json'), JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(output,'.clasp.json'), JSON.stringify({scriptId:targets[project].scriptId,rootDir:'.'},null,2));
const setupFile = path.join(output,'OwnerSetup.gs');
if (bootstrap) {
  if ((process.env.GAS_RELAY_SECRET || '').length < 32) throw new Error('Relay secret is missing.');
  const properties = {GAS_RELAY_SECRET:process.env.GAS_RELAY_SECRET};
  if (project === 'dashboard') {
    if (!process.env.GAS_RELAY_URL?.startsWith('https://script.google.com/macros/s/')) throw new Error('Relay URL is missing.');
    properties.GAS_RELAY_URL = process.env.GAS_RELAY_URL;
    properties.DASHBOARD_CACHE_REV = String(Date.now());
  }
  const body = 'function ownerSetupOnce() {\n' +
    '  PropertiesService.getScriptProperties().setProperties(' + JSON.stringify(properties) + ', false);\n' +
    (project === 'relay' ? '  setupPrivateRelayQueue();\n' : '') +
    '  console.log("LOCAL_POSTGRES_' + project.toUpperCase() + '_SETUP_OK");\n' +
    '  return {ok:true};\n}\n';
  fs.writeFileSync(setupFile,body);
} else if (fs.existsSync(setupFile)) {
  fs.unlinkSync(setupFile);
}
console.log('GOOGLE_PROJECT_STAGED project=' + project + ' bootstrap=' + bootstrap);
