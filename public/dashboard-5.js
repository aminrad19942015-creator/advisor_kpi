function detailCell(c,v){
 if(v==null||v==='')return '—';
 const key=String(c).toLowerCase();
 const isDate=/(^|_)(date|start|modified|created|closed|resolve|entered|followup|at)($|_)/.test(key)||/(تاریخ|زمان ثبت|زمان بسته|شروع|آخرین تغییر)/.test(String(c));
 if(isDate){
  const d=new Date(v);
  if(!isNaN(d)){
   const hasTime=/\d{1,2}:\d{2}/.test(String(v));
   return hasTime?d.toLocaleString('fa-IR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('fa-IR',{year:'numeric',month:'2-digit',day:'2-digit'});
  }
 }
 return String(v);
}
function rowsTable(rows){if(!rows||!rows.length)return '<div class="empty">رکوردی وجود ندارد.</div>';const cols=Object.keys(rows[0]);return `<div class="table-wrap activity-detail-wrap"><table class="table"><thead><tr>${cols.map(c=>`<th>${safe(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${safe(detailCell(c,r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
async function exportDashboardTab(tab){
 const filters=filterState[tab]||{};
 const btn=document.querySelector(`[data-export-tab="${tab}"]`);
 const oldText=btn?.textContent||'خروجی اکسل';
 try{
  if(btn){btn.disabled=true;btn.textContent='در حال ساخت فایل...';}
  const res=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tab,filters})});
  if(!res.ok){const j=await res.json().catch(()=>({}));throw new Error(j.error||('HTTP '+res.status));}
  const blob=await res.blob();
  const cd=res.headers.get('content-disposition')||'';
  const m=cd.match(/filename\*=UTF-8''([^;]+)/i);
  const filename=m?decodeURIComponent(m[1]):('dashboard-'+tab+'.xlsx');
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  toast('فایل اکسل با فیلترهای فعلی آماده شد.');
 }catch(e){toast('خطا در خروجی اکسل: '+(e?.message||e||'خطای نامشخص'))}
 finally{if(btn){btn.disabled=false;btn.textContent=oldText;}}
}
function loadActivityDetail(period,type,user){const box=$(`${period}Detail`);box.style.display='block';$(`${period}DetailSub`).textContent='در حال دریافت...';$(`${period}DetailBody`).innerHTML='<div class="empty">در حال دریافت...</div>';google.script.run.withFailureHandler(e=>{$(`${period}DetailBody`).innerHTML='<div class="data-note">'+safe(e.message||e)+'</div>'}).withSuccessHandler(rows=>{$(`${period}DetailSub`).textContent=fa(rows.length)+' رکورد — '+user;$(`${period}DetailBody`).innerHTML=rowsTable(rows);makeTableSortable(box);box.scrollIntoView({behavior:'smooth',block:'start'})}).getActivityDetails(period,type,user,filterState[period]||{})}
function loadPeriodKpiDetail(period,type,title){
 const box=$(`${period}Detail`);
 box.style.display='block';
 $(`${period}DetailSub`).textContent='در حال دریافت '+title+'...';
 $(`${period}DetailBody`).innerHTML='<div class="empty">در حال دریافت...</div>';
 google.script.run
  .withFailureHandler(e=>{$(`${period}DetailBody`).innerHTML='<div class="data-note">'+safe(e.message||e)+'</div>'})
  .withSuccessHandler(rows=>{
   $(`${period}DetailSub`).textContent=title+' — '+fa(rows.length)+' رکورد';
   $(`${period}DetailBody`).innerHTML=rowsTable(rows);
   makeTableSortable(box);
   box.scrollIntoView({behavior:'smooth',block:'start'});
  })
  .getPeriodKpiDetails(period,type,filterState[period]||{});
}
function loadLeadStatusKpiDetail(period,type){
 const box=$(`${period}Detail`);
 box.style.display='block';
 const title=type==='noStatus'?'عدم تعیین وضعیت در زمان مقرر':'عدم پاسخ (۲ بار)';
 $(`${period}DetailSub`).textContent='در حال دریافت '+title+'...';
 $(`${period}DetailBody`).innerHTML='<div class="empty">در حال دریافت...</div>';
 google.script.run
  .withFailureHandler(e=>{$(`${period}DetailBody`).innerHTML='<div class="data-note">'+safe(e.message||e)+'</div>'})
  .withSuccessHandler(rows=>{
   $(`${period}DetailSub`).textContent=title+' — '+fa(rows.length)+' رکورد';
   $(`${period}DetailBody`).innerHTML=rowsTable(rows);
   makeTableSortable(box);
   box.scrollIntoView({behavior:'smooth',block:'start'});
  })
  .getLeadStatusKpiDetails(period,type,filterState[period]||{});
}
function loadDimension(period,source,field,value){const box=$(`${period}DimensionDetail`);box.style.display='block';$(`${period}DimensionDetailSub`).textContent='در حال دریافت...';$(`${period}DimensionDetailBody`).innerHTML='<div class="empty">در حال دریافت...</div>';google.script.run.withFailureHandler(e=>{$(`${period}DimensionDetailBody`).innerHTML='<div class="data-note">'+safe(e.message||e)+'</div>'}).withSuccessHandler(rows=>{$(`${period}DimensionDetailSub`).textContent=`${field}: ${value} — ${fa(rows.length)} رکورد`;$(`${period}DimensionDetailBody`).innerHTML=rowsTable(rows);makeTableSortable(box);box.scrollIntoView({behavior:'smooth',block:'start'})}).getDimensionDetails(period,source,field,value,filterState[period]||{})}
function loadRepeated(period){const box=$(`${period}DimensionDetail`);box.style.display='block';$(`${period}DimensionDetailSub`).textContent='تماس‌های تکراری';$(`${period}DimensionDetailBody`).innerHTML='<div class="empty">در حال دریافت...</div>';google.script.run.withSuccessHandler(rows=>{$(`${period}DimensionDetailSub`).textContent='تماس‌های تکراری — '+fa(rows.length)+' رکورد';$(`${period}DimensionDetailBody`).innerHTML=rowsTable(rows);makeTableSortable(box)}).getRepeatedCallDetails(period,filterState[period]||{})}
function loadAdvisorTrend(period,advisor){
 const el=$(`${period}AdvisorChart`);
 if(!el)return;
 if(!advisor || advisor==='__ALL__'){
   el.innerHTML=chart((state.data[period]||{}).teamTrend||[]);
   bindChartHover(el);
   return;
 }
 el.innerHTML='<div class="empty">در حال دریافت روند...</div>';
 google.script.run.withSuccessHandler(rows=>{
   el.innerHTML=chart(rows);
   bindChartHover(el);
 }).getAdvisorTrend(period,advisor);
}

const periodInitialLoaded={daily:false,weekly:false,monthly:false};
function loadInitialPeriod(period){
 const pageId=period+'Page';
 if(periodInitialLoaded[period])return;
 setPageLoading(pageId,true);
 google.script.run
  .withFailureHandler(e=>{setPageLoading(pageId,false);toast('خطا در دریافت فیلترها: '+(e?.message||e||'خطای نامشخص'));})
  .withSuccessHandler(options=>{
    filterOptions.periodCampaign[period]=options||[];
    google.script.run
      .withFailureHandler(e=>{setPageLoading(pageId,false);toast('خطا در دریافت اطلاعات: '+(e?.message||e||'خطای نامشخص'));})
      .withSuccessHandler(summary=>{
        state.data[period]=summary;
        periodInitialLoaded[period]=true;
        renderPeriod(period,pageId,period==='daily'?'فعالیت دیروز':period==='weekly'?'فعالیت هفته':'فعالیت ماهانه');
        bindChartHover($(pageId));
        setPageLoading(pageId,false);
      })
      .getFilteredPeriodSummary(period,filterState[period]);
  })
  .getPeriodCampaignOptions(period);
}
function switchPage(id){
 document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===id));
 document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.page===id));
 if(id==='dailyPage')loadInitialPeriod('daily');
 if(id==='weeklyPage')loadInitialPeriod('weekly');
 if(id==='monthlyPage')loadInitialPeriod('monthly');
}
document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>switchPage(b.dataset.page));

function renderAll(){
 const meta=state.data.meta||{};
 $('lastSyncText').textContent=meta.lastSyncAt?new Date(meta.lastSyncAt).toLocaleString('fa-IR'):'—';
 $('dataVersionText').textContent=meta.dataVersion?String(meta.dataVersion).slice(-16):'—';
 let done=0;
 function finish(){
   done++;
   if(done<2)return;
   google.script.run
    .withFailureHandler(e=>{document.querySelector('.loading-card p').textContent='خطا در اعمال فیلتر پیش‌فرض سرنخ‌های باز: '+(e.message||e)})
    .withSuccessHandler(openSummary=>{
      state.data.open=openSummary;
      renderTeam();
      renderOpen();
      makeTableSortable();
      $('loadingScreen').style.display='none';
    })
    .getOpenFilteredSummary(filterState.open);
 }
 google.script.run
  .withFailureHandler(e=>{document.querySelector('.loading-card p').textContent='خطا در دریافت فیلتر تیم: '+(e.message||e)})
  .withSuccessHandler(o=>{filterOptions.team=o||{};finish()})
  .getTeamFilterOptions();
 google.script.run
  .withFailureHandler(e=>{document.querySelector('.loading-card p').textContent='خطا در دریافت فیلتر سرنخ‌ها: '+(e.message||e)})
  .withSuccessHandler(o=>{filterOptions.open=o||{};finish()})
  .getOpenFilterOptions();
}

google.script.run
 .withFailureHandler(e=>{document.querySelector('.loading-card p').textContent='خطا در دریافت اطلاعات: '+(e.message||e)})
 .withSuccessHandler(data=>{state.data=data;renderAll()})
 .getDashboardBootstrap();
