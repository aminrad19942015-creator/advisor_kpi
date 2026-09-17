import fs from 'node:fs';
import path from 'node:path';

export default function Home(){
  const html=fs.readFileSync(path.join(process.cwd(),'public','dashboard.html'),'utf8');
  return <iframe title="Advisor Dashboard" srcDoc={html} style={{position:'fixed',inset:0,width:'100%',height:'100%',border:0}} />;
}
