function rowsTable(rows){if(!rows||!rows.length)return '<div class="empty">رکوردی وجود ندارد.</div>';const cols=Object.keys(rows[0]);return `<div class="table-wrap activity-detail-wrap"><table class="table"><thead><tr>${cols.map(c=>`<th>${safe(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${safe(r[c]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
function loadActivityDetail(period,type,user){const box=$(`${period}Detail`);box.style.display='block';$(`${period}DetailSub`).textContent='در حال دریافت...';$(`${period}DetailBody`).innerHTML='<div class="empty">در حال دریافت...</div>';google.script.run.withFailureHandler(e=>{$(`${period}DetailBody`).innerHTML='<div class="data-note">'+safe(e.message||e)+'</div>'}).withSuccessHandler(rows=>{$(`${period}DetailSub`).textContent=fa(rows.length)+' رکورد — '+user;$(`${period}DetailBody`).innerHTML=rowsTable(rows);makeTableSortable(box);box.scrollIntoView({behavior:'smooth',block:'start'})}).getActivityDetails(period,type,user)}
function loadDimension(period,source,field,value){const box=$(`${period}DimensionDetail`);box.style.display='block';$(`${period}DimensionDetailSub`).textContent='در حال دریافت...';$(`${period}DimensionDetailBody`).innerHTML='<div class="empty">در حال دریافت...</div>';google.script.run.withFailureHandler(e=>{$(`${period}DimensionDetailBody`).innerHTML='<div class="data-note">'+safe(e.message||e)+'</div>'}).withSuccessHandler(rows=>{$(`${period}DimensionDetailSub`).textContent=`${field}: ${value} — ${fa(rows.length)} رکورد`;$(`${period}DimensionDetailBody`).innerHTML=rowsTable(rows);makeTableSortable(box);box.scrollIntoView({behavior:'smooth',block:'start'})}).getDimensionDetails(period,source,field,value)}
function loadRepeated(period){const box=$(`${period}DimensionDetail`);box.style.display='block';$(`${period}DimensionDetailSub`).textContent='تماس‌های تکراری';$(`${period}DimensionDetailBody`).innerHTML='<div class="empty">در حال دریافت...</div>';google.script.run.withSuccessHandler(rows=>{$(`${period}DimensionDetailSub`).textContent='تماس‌های تکراری — '+fa(rows.length)+' رکورد';$(`${period}DimensionDetailBody`).innerHTML=rowsTable(rows);makeTableSortable(box)}).getRepeatedCallDetails(period)}
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

function switchPage(id){document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===id));document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.page===id))}
document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>switchPage(b.dataset.page));

function renderAll(){
 const meta=state.data.meta||{};
 $('lastSyncText').textContent=meta.lastSyncAt?new Date(meta.lastSyncAt).toLocaleString('fa-IR'):'—';
 $('dataVersionText').textContent=meta.dataVersion?String(meta.dataVersion).slice(-16):'—';
 let done=0;
 function finish(){
   done++;
   if(done<5)return;
   google.script.run
    .withFailureHandler(e=>{document.querySelector('.loading-card p').textContent='خطا در اعمال فیلتر پیش‌فرض سرنخ‌های باز: '+(e.message||e)})
    .withSuccessHandler(openSummary=>{
      state.data.open=openSummary;
      renderTeam();renderOpen();renderPeriod('daily','dailyPage','فعالیت دیروز');renderPeriod('weekly','weeklyPage','فعالیت هفته');renderPeriod('monthly','monthlyPage','فعالیت ماهانه');makeTableSortable();bindChartHover();
      $('loadingScreen').style.display='none';
    })
    .getOpenFilteredSummary(filterState.open);
 }
 google.script.run.withSuccessHandler(o=>{filterOptions.team=o||{};finish()}).getTeamFilterOptions();
 google.script.run.withSuccessHandler(o=>{filterOptions.open=o||{};finish()}).getOpenFilterOptions();
 ['daily','weekly','monthly'].forEach(period=>{
   google.script.run.withSuccessHandler(o=>{filterOptions.periodCampaign[period]=o||[];finish()}).getPeriodCampaignOptions(period);
 });
}

google.script.run
 .withFailureHandler(e=>{document.querySelector('.loading-card p').textContent='خطا در دریافت اطلاعات: '+(e.message||e)})
 .withSuccessHandler(data=>{state.data=data;renderAll()})
 .getDashboardBootstrap();
