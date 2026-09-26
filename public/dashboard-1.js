// Google Apps Script compatibility bridge for the migrated Next.js backend.
(function(){
  function makeRunner(success, failure){
    const target={
      withSuccessHandler(fn){ return makeRunner(fn, failure); },
      withFailureHandler(fn){ return makeRunner(success, fn); }
    };
    return new Proxy(target,{
      get(obj,prop){
        if(prop in obj) return obj[prop].bind(obj);
        if(typeof prop!=='string') return obj[prop];
        return async (...args)=>{
          try{
            const res=await fetch('/api/rpc',{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({method:prop,args})
            });
            const payload=await res.json().catch(()=>({ok:false,error:'Invalid JSON response'}));
            if(!res.ok || !payload.ok) throw new Error(payload.error||('HTTP '+res.status));
            if(success) success(payload.result);
            return payload.result;
          }catch(err){
            if(failure) failure(err); else console.error(err);
            return undefined;
          }
        };
      }
    });
  }
  window.google=window.google||{};
  window.google.script=window.google.script||{};
  window.google.script.run=makeRunner(null,null);
})();

const $=id=>document.getElementById(id);
const state={data:null};
const fa=v=>Number(v||0).toLocaleString('fa-IR');
const safe=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
const fmt=v=>{const d=new Date(v);return isNaN(d)?'—':d.toLocaleDateString('fa-IR',{year:'numeric',month:'2-digit',day:'2-digit'})};
const norm=v=>String(v??'').replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/[\u200c\u200f]/g,' ').replace(/\s+/g,' ').trim();

function toast(t){const el=$('toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2400)}
function bars(entries){if(!entries||!entries.length)return '<div class="empty">داده‌ای وجود ندارد.</div>';const max=entries[0][1]||1;return `<div class="bars">`+entries.map(([k,v])=>`<div class="bar-row clickable" data-v="${safe(k)}" title="${safe(k)}"><div class="bar-label">${safe(k)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,v/max*100)}%"></div></div><div class="bar-value">${fa(v)}</div></div>`).join('')+`</div>`}
function bindBars(root,handler){root.querySelectorAll('.bar-row').forEach(r=>r.onclick=()=>handler(r.dataset.v))}
function donut(entries){
 const rows=(entries||[]).filter(x=>Number(x[1])>0);
 if(!rows.length)return '<div class="empty">داده‌ای برای نمودار وجود ندارد.</div>';
 const total=rows.reduce((s,x)=>s+Number(x[1]||0),0),r=72,cx=100,cy=100,sw=28,C=2*Math.PI*r;
 let off=0;
 const segs=rows.map(([label,value],i)=>{
  const n=Number(value||0),len=n/total*C,pct=n/total*100;
  const html=`<circle class="donut-segment" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--donut-${i%8})" stroke-width="${sw}" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-off}" data-v="${safe(label)}" data-count="${n}" data-pct="${pct.toFixed(1)}"><title>${safe(label)}: ${fa(n)} (${pct.toFixed(1)}٪)</title></circle>`;
  off+=len;return html;
 }).join('');
 const legend=rows.map(([label,value],i)=>`<button class="donut-legend-item" data-v="${safe(label)}"><i style="background:var(--donut-${i%8})"></i><span>${safe(label)}</span><b>${fa(value)}</b><small>${(Number(value)/total*100).toFixed(1)}٪</small></button>`).join('');
 return `<div class="donut-wrap"><div class="donut-chart"><svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="${sw}"/>${segs}</svg><div class="donut-center"><b>${fa(total)}</b><span>سرنخ</span></div></div><div class="donut-legend">${legend}</div></div>`;
}
function bindDonut(root,handler){
 if(!root)return;
 root.querySelectorAll('.donut-segment,.donut-legend-item').forEach(el=>el.onclick=()=>handler(el.dataset.v));
}
function rangeText(s){if(!s||!s.days||!s.days.length)return '—';return s.days.length===1?fmt(s.days[0]):fmt(s.days[0])+' تا '+fmt(s.days[s.days.length-1])}
function reportBadge(label,text){return `<div class="report-date-badge"><span>${label}</span><b>${safe(text)}</b></div>`}
function makeTableSortable(root=document){root.querySelectorAll('table.table').forEach(table=>{[...table.querySelectorAll('thead th')].forEach((th,col)=>{if(th.dataset.bound)return;th.dataset.bound='1';th.classList.add('sortable');th.onclick=()=>{const tbody=table.tBodies[0];if(!tbody)return;const asc=th.dataset.dir!=='asc';[...table.querySelectorAll('thead th')].forEach(h=>{h.dataset.dir='';h.classList.remove('sort-asc','sort-desc')});th.dataset.dir=asc?'asc':'desc';th.classList.add(asc?'sort-asc':'sort-desc');const rows=[...tbody.rows];rows.sort((a,b)=>{let x=a.cells[col]?.textContent?.trim()||'',y=b.cells[col]?.textContent?.trim()||'';const nx=Number(x.replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٬,]/g,'')),ny=Number(y.replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٬,]/g,''));let c=Number.isFinite(nx)&&Number.isFinite(ny)?nx-ny:x.localeCompare(y,'fa',{numeric:true});return asc?c:-c});rows.forEach(r=>tbody.appendChild(r))}})})}

const TREND_METRICS={
 talked:{label:'لید صحبت‌شده',line:'#3fe0cd',avg:'#f6c85f'},
 opp:{label:'فرصت OPP',line:'#f0b95a',avg:'#63b3ff'},
 calls:{label:'تماس',line:'#7aa7ff',avg:'#ff9f68'},
 t8:{label:'T8',line:'#b08cff',avg:'#65d68e'},
 tickets:{label:'تیکت',line:'#ff8b8b',avg:'#6edbd0'},
 total:{label:'فعالیت کل',line:'#ffffff',avg:'#f0b95a'}
};
const trendMetricState={weekly:'total',monthly:'total'};
function smoothPath(points){
 if(!points.length)return '';
 if(points.length===1)return `M ${points[0][0]} ${points[0][1]}`;
 let d=`M ${points[0][0]} ${points[0][1]}`;
 for(let i=0;i<points.length-1;i++){
  const p0=points[i-1]||points[i],p1=points[i],p2=points[i+1],p3=points[i+2]||p2;
  const c1x=p1[0]+(p2[0]-p0[0])/6,c1y=p1[1]+(p2[1]-p0[1])/6;
  const c2x=p2[0]-(p3[0]-p1[0])/6,c2y=p2[1]-(p3[1]-p1[1])/6;
  d+=` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
 }
 return d;
}
function trendChart(rows,metric='total',unitRows=[],roleTrend={},roleCounts={},perPersonMode=false){
 if(!rows||!rows.length)return '<div class="empty">داده‌ای برای نمودار وجود ندارد.</div>';
 const meta=TREND_METRICS[metric]||TREND_METRICS.total;
 const W=1100,H=330,p={l:48,r:24,t:34,b:52},iw=W-p.l-p.r,ih=H-p.t-p.b;
 let benchmarks=[];
 if(perPersonMode){
  const defs=[
   {key:'guide',label:'میانگین راهنما',color:'#f6c85f'},
   {key:'advisor',label:'میانگین مشاور',color:'#63b3ff'},
   {key:'senior',label:'میانگین مشاور ارشد و سرتیم',color:'#b08cff'}
  ];
  benchmarks=defs.map(d=>{const rr=roleTrend[d.key]||[],daily=rr.length?rr.reduce((s,r)=>s+Number(r[metric]||0),0)/rr.length:0,count=Number(roleCounts[d.key]||0);return {...d,value:count?daily/count:0,count}});
 }else{
  const defs=[
   {key:'guide',label:'میانگین کل راهنماها',color:'#f6c85f'},
   {key:'advisor',label:'میانگین کل مشاوران',color:'#63b3ff'},
   {key:'senior',label:'میانگین کل مشاور ارشد و سرتیم',color:'#b08cff'}
  ];
  benchmarks=defs.map(d=>{const rr=roleTrend[d.key]||[],daily=rr.length?rr.reduce((s,r)=>s+Number(r[metric]||0),0)/rr.length:0,count=Number(roleCounts[d.key]||0);return {...d,value:daily,count}});
 }
 let max=Math.max(1,...benchmarks.map(x=>x.value),...rows.map(r=>Number(r[metric]||0)));max*=1.08;
 const x=i=>p.l+(rows.length===1?iw/2:i*iw/(rows.length-1)),y=v=>p.t+ih-(Number(v)||0)/max*ih;
 let grid='';for(let i=0;i<=4;i++){const val=max*i/4,yy=y(val);grid+=`<line x1="${p.l}" x2="${W-p.r}" y1="${yy}" y2="${yy}" class="chart-gridline"/><text x="${p.l-8}" y="${yy+4}" text-anchor="end" class="chart-axis">${fa(Math.round(val))}</text>`}
 const pts=rows.map((r,i)=>[x(i),y(r[metric])]),path=smoothPath(pts);
 const labels=rows.map((r,i)=>`<text x="${x(i)}" y="${H-18}" text-anchor="middle" class="chart-axis">${fmt(r.day)}</text>`).join('');
 const band=rows.length>1?iw/(rows.length-1):iw;
 const hit=rows.map((r,i)=>{const left=Math.max(p.l,x(i)-band/2),right=Math.min(W-p.r,x(i)+band/2);return `<rect class="trend-hit" x="${left}" y="${p.t}" width="${Math.max(12,right-left)}" height="${ih}" fill="transparent" data-i="${i}"/>`}).join('');
 const benchmarkLines=benchmarks.filter(a=>a.count>0).map(a=>`<line x1="${p.l}" x2="${W-p.r}" y1="${y(a.value)}" y2="${y(a.value)}" stroke="${a.color}" stroke-width="2" stroke-dasharray="9 7"/>`).join('');
 const legend=benchmarks.filter(a=>a.count>0).map(a=>`<span><i class="dash" style="border-color:${a.color}"></i>${a.label}: <b>${fa(a.value.toFixed(1))}</b></span>`).join('');
 return `<div class="trend-chart-wrap" data-metric="${metric}" data-benchmarks='${safe(JSON.stringify(benchmarks))}' data-rows='${safe(JSON.stringify(rows))}' data-label="${safe(meta.label)}">
  <div class="trend-legend"><span><i style="background:${meta.line}"></i>${meta.label}</span>${legend}</div>
  <div class="chart-stage trend-hover-stage"><div class="chart-tooltip"></div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${benchmarkLines}<path d="${path}" fill="none" stroke="${meta.line}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>${pts.map(([px,py])=>`<circle cx="${px}" cy="${py}" r="4" fill="${meta.line}" />`).join('')}${labels}${hit}</svg></div>
 </div>`;
}
function bindTrendChartHover(root=document){
 root.querySelectorAll('.trend-hover-stage').forEach(stage=>{
  const wrap=stage.closest('.trend-chart-wrap');if(!wrap)return;
  let rows=[];try{rows=JSON.parse(wrap.dataset.rows||'[]')}catch(e){}
  let benchmarks=[];try{benchmarks=JSON.parse(wrap.dataset.benchmarks||'[]')}catch(e){}const metric=wrap.dataset.metric||'total',label=wrap.dataset.label||'',tip=stage.querySelector('.chart-tooltip');if(!tip)return;
  stage.querySelectorAll('.trend-hit').forEach(hit=>{
   hit.onmouseenter=hit.onmousemove=e=>{const r=rows[Number(hit.dataset.i)]||{},benchHtml=benchmarks.filter(x=>x.count>0).map(x=>`<span>${safe(x.label)}</span><b>${fa(Number(x.value||0).toFixed(1))}</b>`).join('');tip.innerHTML=`<div class="ct-date">${fmt(r.day)}</div><div class="ct-grid"><span>${safe(label)}</span><b>${fa(r[metric])}</b>${benchHtml}</div>`;const rect=stage.getBoundingClientRect();tip.style.display='block';tip.style.left=Math.min(rect.width-210,Math.max(8,e.clientX-rect.left-90))+'px';tip.style.top='52px';};
   hit.onmouseleave=()=>{tip.style.display='none'};
  });
 });
}

const filterState={
  team:{search:'',teamLead:[],seniorLead:[],team:[],gender:[],role:[],businessUnit:[]},
  open:{advisor:[],seniorLead:[],role:[],team:[],personUnit:[],age:'',leadType:['حقیقی'],nextCallReason:[],customerRank:[],campaign:['Ayar','LeadAdvice'],source:[],lastStatus:[]},
  daily:{advisor:[],teamLead:[],seniorLead:[],team:[],role:[],campaign:[]},
  weekly:{advisor:[],teamLead:[],seniorLead:[],team:[],role:[],campaign:[]},
  monthly:{advisor:[],teamLead:[],seniorLead:[],team:[],role:[],campaign:[]}
};
let filterOptions={team:{},open:{},periodCampaign:{daily:[],weekly:[],monthly:[]}};

function syncedTeamOptions(current,mapping){
  const members=(filterOptions.team&&filterOptions.team.members)||[];
  const out={};
  const entries=Object.entries(mapping);
  for(const [stateKey,memberKey] of entries){
    let rows=members;
    for(const [otherStateKey,otherMemberKey] of entries){
      if(otherStateKey===stateKey) continue;
      const selected=Array.isArray(current[otherStateKey])?current[otherStateKey].filter(Boolean):[];
      if(selected.length) rows=rows.filter(r=>selected.includes(r[otherMemberKey]||''));
    }
    let vals=[...new Set(rows.map(r=>r[memberKey]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'fa',{numeric:true}));
    if(stateKey==='seniorLead') vals=[...new Set([...(filterOptions.team?.seniorLead||[]),...vals])].sort((a,b)=>String(a).localeCompare(String(b),'fa',{numeric:true}));
    const selected=Array.isArray(current[stateKey])?current[stateKey].filter(Boolean):[];
    out[stateKey]=[...new Set([...selected,...vals])];
  }
  return out;
}

// Default state is intentionally empty = "همه".
// No filter should be selected automatically on first load.
function resetAllFilterState(){
  filterState.team={search:'',teamLead:[],seniorLead:[],team:[],gender:[],role:[],businessUnit:[]};
  filterState.open={advisor:[],seniorLead:[],role:[],team:[],personUnit:[],age:'',leadType:['حقیقی'],nextCallReason:[],customerRank:[],campaign:['Ayar','LeadAdvice'],source:[],lastStatus:[]};
  filterState.daily={advisor:[],teamLead:[],seniorLead:[],team:[],role:[],campaign:[]};
  filterState.weekly={advisor:[],teamLead:[],seniorLead:[],team:[],role:[],campaign:[]};
  filterState.monthly={advisor:[],teamLead:[],seniorLead:[],team:[],role:[],campaign:[]};
}
resetAllFilterState();

function optionHtml(vals,selected){
  const chosen=Array.isArray(selected)?selected.filter(Boolean):[];
  const set=new Set(chosen);
  return (vals||[]).map(v=>`<option value="${safe(v)}"${set.has(v)?' selected':''}>${safe(v)}</option>`).join('');
}
