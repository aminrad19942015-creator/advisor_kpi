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

const SERIES=[['talked','لید صحبت‌شده','#3fe0cd'],['opp','فرصت OPP','#f0b95a'],['calls','تماس','#7aa7ff'],['t8','T8','#b08cff'],['tickets','تیکت','#ff8b8b'],['total','فعالیت کل','#ffffff']];
function chart(rows){
 if(!rows||!rows.length)return '<div class="empty">داده‌ای برای نمودار وجود ندارد.</div>';

 const W=900,H=310,p={l:42,r:22,t:34,b:48},iw=W-p.l-p.r,ih=H-p.t-p.b;
 let max=1;
 rows.forEach(r=>SERIES.forEach(([k])=>max=Math.max(max,Number(r[k])||0)));

 const x=i=>p.l+(rows.length===1?iw/2:i*iw/(rows.length-1));
 const y=v=>p.t+ih-(Number(v)||0)/max*ih;

 let grid='';
 for(let i=0;i<=4;i++){
   const val=Math.round(max*i/4),yy=y(val);
   grid+=`<line x1="${p.l}" x2="${W-p.r}" y1="${yy}" y2="${yy}" class="chart-gridline"/><text x="${p.l-8}" y="${yy+4}" text-anchor="end" class="chart-axis">${fa(val)}</text>`;
 }

 let paths='';
 SERIES.forEach(([k,l,c])=>{
   paths+=`<polyline points="${rows.map((r,i)=>`${x(i)},${y(r[k])}`).join(' ')}" fill="none" stroke="${c}" stroke-width="${k==='total'?3.3:2.2}" stroke-linejoin="round" stroke-linecap="round"/>`;
 });

 const labels=rows.map((r,i)=>`<text x="${x(i)}" y="${H-18}" text-anchor="middle" class="chart-axis">${fmt(r.day)}</text>`).join('');

 const band=rows.length>1?iw/(rows.length-1):iw;
 const hitAreas=rows.map((r,i)=>{
   const left=Math.max(p.l,x(i)-band/2);
   const right=Math.min(W-p.r,x(i)+band/2);
   const w=Math.max(12,right-left);
   return `<rect class="chart-hit" x="${left}" y="${p.t}" width="${w}" height="${ih}" fill="transparent" data-i="${i}" />`;
 }).join('');

 return `
   <div class="chart-legend">${SERIES.map(([k,l,c])=>`<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>
   <div class="chart-stage hover-stage" data-chart='${safe(JSON.stringify(rows))}'>
     <div class="chart-tooltip"></div>
     <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${paths}${labels}${hitAreas}</svg>
   </div>`;
}


const filterState={
  team:{search:'',teamLead:[],team:[],gender:[],role:[],businessUnit:[]},
  open:{advisor:[],role:[],team:[],personUnit:[],age:'',leadType:['حقیقی'],nextCallReason:[],customerRank:[],campaign:['Ayar','LeadAdvice'],source:[],lastStatus:[]},
  daily:{advisor:[],teamLead:[],team:[],role:[],campaign:[]},
  weekly:{advisor:[],teamLead:[],team:[],role:[],campaign:[]},
  monthly:{advisor:[],teamLead:[],team:[],role:[],campaign:[]}
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
    const vals=[...new Set(rows.map(r=>r[memberKey]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'fa',{numeric:true}));
    const selected=Array.isArray(current[stateKey])?current[stateKey].filter(Boolean):[];
    out[stateKey]=[...new Set([...selected,...vals])];
  }
  return out;
}

// Default state is intentionally empty = "همه".
// No filter should be selected automatically on first load.
function resetAllFilterState(){
  filterState.team={search:'',teamLead:[],team:[],gender:[],role:[],businessUnit:[]};
  filterState.open={advisor:[],role:[],team:[],personUnit:[],age:'',leadType:['حقیقی'],nextCallReason:[],customerRank:[],campaign:['Ayar','LeadAdvice'],source:[],lastStatus:[]};
  filterState.daily={advisor:[],teamLead:[],team:[],role:[],campaign:[]};
  filterState.weekly={advisor:[],teamLead:[],team:[],role:[],campaign:[]};
  filterState.monthly={advisor:[],teamLead:[],team:[],role:[],campaign:[]};
}
resetAllFilterState();

function optionHtml(vals,selected){
  const chosen=Array.isArray(selected)?selected.filter(Boolean):[];
  const set=new Set(chosen);
  return (vals||[]).map(v=>`<option value="${safe(v)}"${set.has(v)?' selected':''}>${safe(v)}</option>`).join('');
}
