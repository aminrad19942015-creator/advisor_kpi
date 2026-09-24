const fs=require('fs');
const path=require('path');
const zlib=require('zlib');

const ROOT=process.env.CRM_BACKUP_DIR||path.join(__dirname,'data-backup');
const KEEP_DAYS=Math.max(1,Number(process.env.CRM_BACKUP_KEEP_DAYS||7));

function safeName(name){return String(name||'dataset').replace(/[^a-zA-Z0-9_-]/g,'_');}
function ensureDir(p){fs.mkdirSync(p,{recursive:true});}
function stamp(d=new Date()){return d.toISOString().replace(/[:.]/g,'-');}

function writeSnapshot(dataset,rows,meta={}){
  const name=safeName(dataset),dir=path.join(ROOT,name),archive=path.join(dir,'archive');
  ensureDir(archive);
  const payload={version:1,dataset:name,createdAt:new Date().toISOString(),rows:Array.isArray(rows)?rows:[],meta};
  const bytes=zlib.gzipSync(Buffer.from(JSON.stringify(payload),'utf8'),{level:6});
  const latest=path.join(dir,'latest.json.gz');
  const temp=latest+'.tmp';
  fs.writeFileSync(temp,bytes);fs.renameSync(temp,latest);
  fs.writeFileSync(path.join(dir,'latest.meta.json'),JSON.stringify({dataset:name,createdAt:payload.createdAt,rows:payload.rows.length,bytes:bytes.length,...meta},null,2),'utf8');
  fs.writeFileSync(path.join(archive,stamp()+'.json.gz'),bytes);
  cleanupArchive(archive);
  console.log('Local backup '+name+': '+payload.rows.length+' rows, '+Math.round(bytes.length/1024)+' KB');
  return latest;
}

function cleanupArchive(archive){
  if(!fs.existsSync(archive))return;
  const cutoff=Date.now()-KEEP_DAYS*86400000;
  for(const file of fs.readdirSync(archive)){
    const p=path.join(archive,file);
    try{if(fs.statSync(p).mtimeMs<cutoff)fs.unlinkSync(p);}catch{}
  }
}

function readSnapshot(dataset){
  const p=path.join(ROOT,safeName(dataset),'latest.json.gz');
  if(!fs.existsSync(p))throw new Error('Local snapshot not found: '+dataset);
  const payload=JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'));
  if(!Array.isArray(payload.rows))throw new Error('Invalid local snapshot: '+dataset);
  return payload;
}

function status(){
  ensureDir(ROOT);
  const out={root:ROOT,datasets:{}};
  for(const name of fs.readdirSync(ROOT)){
    const meta=path.join(ROOT,name,'latest.meta.json');
    if(fs.existsSync(meta))try{out.datasets[name]=JSON.parse(fs.readFileSync(meta,'utf8'));}catch{}
  }
  return out;
}

module.exports={writeSnapshot,readSnapshot,status,ROOT};
