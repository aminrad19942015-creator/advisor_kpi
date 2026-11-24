'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
function createCheckpoint(directory,identity,{now=Date.now,maxAgeMs=6*3600000}={}){
 const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const prefix=hash(identity);fs.mkdirSync(directory,{recursive:true});
 const file=key=>path.join(directory,prefix+'-'+hash(key)+'.json');
 return {
  read(key){const target=file(key);try{const entry=JSON.parse(fs.readFileSync(target,'utf8'));if(entry.key!==key||now()-entry.savedAt<0||now()-entry.savedAt>maxAgeMs||!Array.isArray(entry.rows))return null;return entry.rows;}catch{return null;}},
  write(key,rows){const target=file(key);fs.writeFileSync(target+'.tmp',JSON.stringify({key,savedAt:now(),rows}));fs.renameSync(target+'.tmp',target);},
  clear(){for(const name of fs.readdirSync(directory)){if(name.startsWith(prefix+'-')&&name.endsWith('.json'))fs.unlinkSync(path.join(directory,name));}}
 };
}
module.exports={createCheckpoint};
