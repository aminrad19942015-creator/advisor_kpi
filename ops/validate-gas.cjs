'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function validate(source = path.join(root, 'gas')) {
  const names = fs.readdirSync(source);
  for (const name of ['Code.gs','Index.html','Styles.html','Scripts.html','Admin.html','AdminStyles.html','AdminScripts.html','appsscript.json']) {
    assert(names.includes(name), `Missing GAS file: ${name}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(source,'appsscript.json'),'utf8'));
  assert.equal(manifest.runtimeVersion, 'V8');
  for (const name of names.filter(n => /\.(gs|html)$/.test(n))) {
    assert(!/OwnerSetup|bootstrap/i.test(name), `Refusing setup source: ${name}`);
    const body = fs.readFileSync(path.join(source,name),'utf8');
    if (name.endsWith('.gs')) new vm.Script(body, {filename:name});
    else {
      for (const match of body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
        new vm.Script(match[1], {filename:name});
      }
      for (const match of body.matchAll(/include\(['"]([^'"]+)['"]\)/g)) {
        assert(names.includes(match[1]+'.html'), `Missing include ${match[1]} in ${name}`);
      }
    }
  }
  console.log('GAS_VALIDATION_OK: server, browser scripts, manifest and all includes');
}
if (require.main === module) validate();
module.exports = {validate};
