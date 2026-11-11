'use strict';
// Dashboard-only release. IDs are public configuration; OAuth stays outside Git.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {validate} = require('./validate-gas.cjs');
const root = path.resolve(__dirname, '..');
const branch = 'monthly-report-v1';
function run(file, args, cwd = root) {
  return execFileSync(file, args, {cwd, encoding:'utf8', timeout:180000, stdio:['ignore','pipe','pipe']}).trim();
}
function git(...args) { return run('git', args); }
function assertReleaseBranch(actual) {
  if (actual !== branch) throw new Error(`Release requires ${branch}; current branch is ${actual}.`);
}
function assertClean(status) {
  if (status) throw new Error('Commit or preserve working tree changes before deployment.');
}
function assertTarget(deployments, target) {
  const previous = deployments.find(d => d.deploymentId === target.deploymentId);
  if (!Number.isInteger(previous?.versionNumber)) throw new Error('Configured deployment is missing or has no immutable version. No push performed.');
  return previous;
}
function verifyDeployment(read, target, version) {
  // Google's deployment list can briefly report the old version after an update.
  for (let attempt=0; attempt<5; attempt++) {
    const deployed = assertTarget(read(),target);
    if (deployed.versionNumber === version) return deployed;
  }
  throw new Error('Deployment version verification failed; inspect receipt and remote deployment.');
}
function digest(directory) {
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
  return Object.fromEntries(fs.readdirSync(directory).filter(n=>/\.(gs|js|html|json)$/.test(n) && !n.startsWith('.')).sort().map(n=>[
    n.replace(/\.gs$/,'.js'), crypto.createHash('sha256').update(n.endsWith('.json') ? JSON.stringify(canonical(JSON.parse(fs.readFileSync(path.join(directory,n),'utf8')))) : fs.readFileSync(path.join(directory,n),'utf8').replace(/\r\n/g,'\n').trim()).digest('hex')
  ]).sort(([a],[b])=>a.localeCompare(b)));
}
function main() {
  const args = process.argv.slice(2);
  if (args.some(a=>!['--plan','--check-access'].includes(a))) throw new Error('Usage: deploy-gas.cjs [--plan | --check-access]');
  assertReleaseBranch(git('branch','--show-current'));
  fs.mkdirSync(path.join(root,'runtime'),{recursive:true});
  const lock = path.join(root,'runtime/gas-dashboard-release.lock');
  const fd = fs.openSync(lock,'wx');
  try {
  validate();
  if (!args.length) {
    assertClean(git('status','--porcelain'));
    console.log(run(process.execPath,['--test',path.join(__dirname,'test-gas-deploy.cjs'),...fs.readdirSync(path.join(root,'connector')).filter(n=>/^test-.*\.js$/.test(n)).map(n=>path.join(root,'connector',n))]));
  }
  const target = JSON.parse(fs.readFileSync(path.join(root,'ops/apps-script-targets.json'),'utf8')).dashboard;
  if (!/^[\w-]{20,}$/.test(target.scriptId) || !/^AKfy[\w-]+$/.test(target.deploymentId)) throw new Error('Missing or invalid dashboard IDs in ops/apps-script-targets.json.');
  run(process.execPath, [path.join(__dirname,'stage-google-project.cjs'),'dashboard']);
  const stage = path.join(root,'runtime/gas-dashboard-deploy');
  validate(stage);
  console.log(`GAS_PLAN branch=${branch} commit=${git('rev-parse','--short','HEAD')} files=${Object.keys(digest(stage)).length} access=${target.access}`);
  if (args.includes('--plan')) return;
  const cli = path.join(root,'gas/node_modules/@google/clasp/build/src/index.js');
  if (!fs.existsSync(cli)) throw new Error('Install pinned tools once: npm ci --prefix gas');
  const auth = process.env.GAS_CLASP_AUTH || path.join(os.homedir(),'.clasprc.json');
  if (!fs.existsSync(auth)) throw new Error('Google authorization needed once: npm run login --prefix gas. Enable Apps Script API at https://script.google.com/home/usersettings if prompted.');
  // Do not print subprocess stderr or token-bearing environment on failure.
  const clasp = (directory, ...command) => run(process.execPath, [cli,'--auth',auth,'--project',directory,'--json',...command], directory);
  const previous = assertTarget(JSON.parse(clasp(stage,'list-deployments')),target);
  console.log(`GAS_ACCESS_OK currentVersion=${previous.versionNumber}`);
  if (args.includes('--check-access')) return;
  assertClean(git('status','--porcelain'));
    const release = path.join(root,'runtime/gas-releases',new Date().toISOString().replace(/[:.]/g,'-'));
    const backup = path.join(release,'remote-before');
    fs.mkdirSync(backup,{recursive:true});
    fs.copyFileSync(path.join(stage,'.clasp.json'),path.join(backup,'.clasp.json'));
    clasp(backup,'pull');
    const remoteManifest = JSON.parse(fs.readFileSync(path.join(backup,'appsscript.json'),'utf8'));
    const localManifest = JSON.parse(fs.readFileSync(path.join(stage,'appsscript.json'),'utf8'));
    if (JSON.stringify(remoteManifest.webapp) !== JSON.stringify(localManifest.webapp)) {
      // Compare properties independently so JSON key order cannot change policy.
      if (remoteManifest.webapp?.access !== localManifest.webapp?.access || remoteManifest.webapp?.executeAs !== localManifest.webapp?.executeAs) {
        throw new Error('Remote access/executeAs differs from reviewed configuration. Backup saved; no push performed.');
      }
    }
    const receipt = {commit:git('rev-parse','HEAD'),branch,scriptId:target.scriptId,deploymentId:target.deploymentId,previousVersion:previous.versionNumber,files:digest(stage)};
    const receiptFile = path.join(release,'receipt.json');
    fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
    console.log(`Remote source backup: ${backup}`);
    // Recheck immediately before the first remote write.
    assertClean(git('status','--porcelain'));
    if (git('rev-parse','HEAD') !== receipt.commit) throw new Error('Commit changed during preflight.');
    clasp(stage,'push','--force');
    const verify = path.join(release,'remote-after');
    fs.mkdirSync(verify);
    fs.copyFileSync(path.join(stage,'.clasp.json'),path.join(verify,'.clasp.json'));
    clasp(verify,'pull');
    if (JSON.stringify(digest(verify)) !== JSON.stringify(receipt.files)) throw new Error('Remote source verification failed. Existing published version retained.');
    const description = `advisor-kpi ${branch} ${receipt.commit.slice(0,12)}`;
    const version = JSON.parse(clasp(stage,'create-version',description)).versionNumber;
    if (!Number.isInteger(version)) throw new Error('Version creation did not return a version number.');
    receipt.newVersion = version;
    fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
    clasp(stage,'create-deployment','--deploymentId',target.deploymentId,'--versionNumber',String(version),'--description',description);
    verifyDeployment(()=>JSON.parse(clasp(stage,'list-deployments')),target,version);
    receipt.verified = true;
    fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
    console.log(`GAS_DEPLOY_OK version=${version} previous=${previous.versionNumber}\nhttps://script.google.com/macros/s/${target.deploymentId}/exec\nReceipt: ${receiptFile}`);
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.status !== undefined ? 'GAS command failed. Published version may be unchanged; inspect the release receipt. Check Google OAuth/API access and network, then rerun --check-access. Child output suppressed to protect credentials.' : error.message);
    process.exitCode = 1;
  }
}
module.exports = {assertReleaseBranch,assertClean,assertTarget,digest,verifyDeployment};
