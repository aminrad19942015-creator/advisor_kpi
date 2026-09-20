let teamDebounce;
function debouncedApplyTeam(){clearTimeout(teamDebounce);teamDebounce=setTimeout(applyTeamFilters,350)}
function applyTeamFilters(){
  setPageLoading('teamPage',true);
  google.script.run.withSuccessHandler(s=>{state.data.team=s;renderTeam();setPageLoading('teamPage',false)}).getTeamFilteredSummary(filterState.team);
}
let openDebounce;
function debouncedApplyOpen(){clearTimeout(openDebounce);openDebounce=setTimeout(applyOpenFilters,300)}
function bindOpenFilters(){
  const dataOptions=filterOptions.open||{},f=filterState.open;
  const teamOptions=syncedTeamOptions(f,{advisor:'name',role:'role',team:'team',personUnit:'businessUnit'});
  simpleMulti('ofAdvisor',teamOptions.advisor,f.advisor,v=>{f.advisor=v;debouncedApplyOpen()});
  simpleMulti('ofRole',teamOptions.role,f.role,v=>{f.role=v;debouncedApplyOpen()});
  simpleMulti('ofTeam',teamOptions.team,f.team,v=>{f.team=v;debouncedApplyOpen()});
  simpleMulti('ofUnit',teamOptions.personUnit,f.personUnit,v=>{f.personUnit=v;debouncedApplyOpen()});
  simpleMulti('ofType',dataOptions.leadType,f.leadType,v=>{f.leadType=v;debouncedApplyOpen()});
  simpleMulti('ofReason',dataOptions.nextCallReason,f.nextCallReason,v=>{f.nextCallReason=v;debouncedApplyOpen()});
  simpleMulti('ofRank',dataOptions.customerRank,f.customerRank,v=>{f.customerRank=v;debouncedApplyOpen()});
  simpleMulti('ofCampaign',dataOptions.campaign,f.campaign,v=>{f.campaign=v;debouncedApplyOpen()});
  simpleMulti('ofSource',dataOptions.source,f.source,v=>{f.source=v;debouncedApplyOpen()});
  simpleMulti('ofStatus',dataOptions.lastStatus,f.lastStatus,v=>{f.lastStatus=v;debouncedApplyOpen()});
  setTimeout(()=>{
    const a=$('ofAge');if(a){a.value=f.age||'';a.onchange=()=>{f.age=a.value;applyOpenFilters()}}
    $('ofClear').onclick=()=>{filterState.open={advisor:[],role:[],team:[],personUnit:[],age:'',leadType:[],nextCallReason:[],customerRank:[],campaign:[],source:[],lastStatus:[]};applyOpenFilters()}
  },0);
}
function applyOpenFilters(){
  setPageLoading('openPage',true);
  google.script.run.withSuccessHandler(s=>{state.data.open=s;renderOpen();setPageLoading('openPage',false)}).getOpenFilteredSummary(filterState.open);
}
const periodDebounce={};
function debouncedApplyPeriod(period){clearTimeout(periodDebounce[period]);periodDebounce[period]=setTimeout(()=>applyPeriodFilters(period),300)}
function bindPeriodFilters(period){
  const f=filterState[period];
  const o=syncedTeamOptions(f,{advisor:'name',teamLead:'teamLead',team:'team',role:'role'});
  simpleMulti(period+'FAdvisor',o.advisor,f.advisor,v=>{f.advisor=v;debouncedApplyPeriod(period)});
  simpleMulti(period+'FLead',o.teamLead,f.teamLead,v=>{f.teamLead=v;debouncedApplyPeriod(period)});
  simpleMulti(period+'FTeam',o.team,f.team,v=>{f.team=v;debouncedApplyPeriod(period)});
  simpleMulti(period+'FRole',o.role,f.role,v=>{f.role=v;debouncedApplyPeriod(period)});
  simpleMulti(period+'FCampaign',(filterOptions.periodCampaign||{})[period]||[],f.campaign,v=>{f.campaign=v;debouncedApplyPeriod(period)});
  setTimeout(()=>{$(period+'FClear').onclick=()=>{filterState[period]={advisor:[],teamLead:[],team:[],role:[],campaign:[]};applyPeriodFilters(period)}},0);
}
function applyPeriodFilters(period){
  const pageId=period+'Page';
  setPageLoading(pageId,true);
  google.script.run
    .withFailureHandler(e=>{setPageLoading(pageId,false);toast('خطا در اعمال فیلتر: '+(e?.message||e||'خطای نامشخص'));})
    .withSuccessHandler(s=>{state.data[period]=s;renderPeriod(period,pageId,period==='daily'?'فعالیت دیروز':period==='weekly'?'فعالیت هفته':'فعالیت ماهانه');bindChartHover($(pageId));setPageLoading(pageId,false)})
    .getFilteredPeriodSummary(period,filterState[period]);
}

function bindChartHover(root=document){
 root.querySelectorAll('.hover-stage').forEach(stage=>{
   let rows=[];
   try{rows=JSON.parse(stage.dataset.chart||'[]')}catch(e){}
   const tip=stage.querySelector('.chart-tooltip');
   if(!tip)return;

   stage.querySelectorAll('.chart-hit').forEach(hit=>{
     hit.onmouseenter=hit.onmousemove=e=>{
       const r=rows[Number(hit.dataset.i)]||{};
       tip.innerHTML=`
         <div class="ct-date">${fmt(r.day)}</div>
         <div class="ct-grid">
           <span>لید صحبت‌شده</span><b>${fa(r.talked)}</b>
           <span>فرصت OPP</span><b>${fa(r.opp)}</b>
           <span>تماس</span><b>${fa(r.calls)}</b>
           <span>T8</span><b>${fa(r.t8)}</b>
           <span>تیکت</span><b>${fa(r.tickets)}</b>
           <span>فعالیت کل</span><b>${fa(r.total)}</b>
         </div>`;
       const rect=stage.getBoundingClientRect();
       tip.style.display='block';
       tip.style.left=Math.min(rect.width-210,Math.max(8,e.clientX-rect.left-90))+'px';
       tip.style.top='52px';
     };
     hit.onmouseleave=()=>{tip.style.display='none'};
   });
 });
}
function renderTeam(){
  const s=state.data.team||{},k=s.kpis||{};
  $('teamPage').innerHTML=`
    ${reportBadge('وضعیت داده',fa(k.total)+' نفر')}
    <div class="topbar"><div class="title"><h2>نمای کلی واحد مشاورین</h2><p>ساختار افراد، تیم‌ها و واحدهای تجاری</p></div><div class="pill">تیم مشاورین</div></div>
    ${teamFiltersHtml()}
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">کل افراد</div><div class="kpi-value">${fa(k.total)}</div></div>
      <div class="kpi"><div class="kpi-label">تیم لیدها</div><div class="kpi-value">${fa(k.teamLeads)}</div></div>
      <div class="kpi"><div class="kpi-label">مشاور / راهنما</div><div class="kpi-value">${fa(k.advisors)}</div></div>
      <div class="kpi"><div class="kpi-label">تعداد تیم</div><div class="kpi-value">${fa(k.teams)}</div></div>
      <div class="kpi"><div class="kpi-label">خانم‌ها</div><div class="kpi-value">${fa(k.women)}</div></div>
    </div>
    <div class="grid2"><div class="panel"><div class="panel-head"><h3>ترکیب رده‌ها</h3></div>${bars(s.roleCounts)}</div><div class="panel"><div class="panel-head"><h3>واحدهای تجاری</h3></div>${bars(s.unitCounts)}</div></div>
    <div class="panel"><div class="panel-head"><h3>فهرست افراد</h3><span class="badge">${fa((s.rows||[]).length)} ردیف</span></div><div class="table-wrap"><table class="table"><thead><tr><th>نام</th><th>تیم لید</th><th>تیم</th><th>جنسیت</th><th>رده</th><th>واحد تجاری</th></tr></thead><tbody>${(s.rows||[]).map(r=>`<tr><td><b>${safe(r.name)}</b></td><td>${safe(r.teamLead||'—')}</td><td>${safe(r.team||'—')}</td><td>${safe(r.gender||'—')}</td><td>${safe(r.role||'—')}</td><td>${safe(r.businessUnit||'—')}</td></tr>`).join('')}</tbody></table></div></div>`;
  bindTeamFilters();
  makeTableSortable($('teamPage'));
}

function renderOpen(){
 const s=state.data.open||{},k=s.kpis||{},d=s.dimensions||{};
 $('openPage').innerHTML=`
  ${reportBadge('تاریخ امروز',new Date().toLocaleDateString('fa-IR'))}
  <div class="topbar"><div class="title"><h2>سرنخ‌های باز روزانه</h2><p>تعداد و سن سرنخ‌های باز در دست اعضای واحد مشاورین</p></div><div class="pill">کل باز روزانه</div></div>
  <div class="hint">مبنای انتساب سرنخ به مشاور، ستون <b>«مالک»</b> است. سن از تاریخ ثبت محاسبه می‌شود. مهلت رسیدگی لید: <b>حقیقی ۱۸ روز کامل</b> و <b>حقوقی ۶۰ روز کامل</b>. «نزدیک سررسید» یعنی حداکثر ۳ روز تا پایان این مهلت باقی مانده باشد.</div>
  ${openFiltersHtml()}
  <div class="kpis">
   <div class="kpi"><div class="kpi-label">کل سرنخ‌های باز</div><div class="kpi-value">${fa(k.allTotal)}</div><div class="kpi-sub">تمام رکوردهای منطبق با فیلتر</div></div>
   <div class="kpi"><div class="kpi-label">سرنخ‌های باز دست مشاوران</div><div class="kpi-value">${fa(k.total)}</div><div class="kpi-sub">منتسب به اعضای واحد</div></div>
   <div class="kpi"><div class="kpi-label">لیدهای اختصاص‌نیافته</div><div class="kpi-value">${fa(k.unassigned)}</div><div class="kpi-sub">واحد تجاری خالی</div></div>

   <div class="kpi deadline-kpi clickable" data-deadline-type="حقیقی"><div class="kpi-label">حقیقی نزدیک سررسید</div><div class="kpi-value">${fa(k.nearDeadlineReal)}</div><div class="kpi-sub">سن ۱۵ تا ۱۸ روز</div></div>
   <div class="kpi deadline-kpi clickable" data-deadline-type="حقوقی"><div class="kpi-label">حقوقی نزدیک سررسید</div><div class="kpi-value">${fa(k.nearDeadlineLegal)}</div><div class="kpi-sub">سن ۵۷ تا ۶۰ روز</div></div>
  </div>
  <div class="panel" style="margin-bottom:18px"><div class="panel-head"><div><h3>سرنخ‌های باز به تفکیک مشاور</h3><div class="section-note">برای مشاهده جزئیات، روی اعداد و نمودارهای پایین کلیک کنید.</div></div><span class="badge">${fa((s.advisors||[]).length)} نفر</span></div><div class="table-wrap"><table class="table"><thead><tr>
    <th>مشاور</th><th>رده</th><th>تیم لید</th><th>تیم</th><th>تعداد باز</th><th>قدیمی‌ترین لید</th><th title="لید حقیقی با سن ۱۵ تا ۱۸ روز">حقیقی نزدیک سررسید ⓘ</th><th title="لید حقوقی با سن ۵۷ تا ۶۰ روز">حقوقی نزدیک سررسید ⓘ</th>
  </tr></thead><tbody>${(s.advisors||[]).map(r=>`<tr><td><b>${safe(r.name)}</b></td><td>${safe(r.role||'—')}</td><td>${safe(r.teamLead||'—')}</td><td>${safe(r.team||'—')}</td><td class="activity-num" data-open-owner="${safe(r.name)}">${fa(r.count)}</td><td>${fa(r.oldest)} روز</td><td><span class="activity-num deadline-num" data-deadline-type="حقیقی" data-deadline-owner="${safe(r.name)}">${fa(r.nearDeadlineReal)}</span></td><td><span class="activity-num deadline-num" data-deadline-type="حقوقی" data-deadline-owner="${safe(r.name)}">${fa(r.nearDeadlineLegal)}</span></td></tr>`).join('')}</tbody></table></div></div>
  <div class="grid4" id="openDims"><div class="panel dim-panel" data-f="businessUnit"><div class="panel-head"><h3>واحد تجاری سرنخ</h3></div>${bars(d.businessUnit)}</div><div class="panel dim-panel" data-f="leadType"><div class="panel-head"><h3>نوع سرنخ</h3></div>${bars(d.leadType)}</div><div class="panel dim-panel" data-f="nextCallReason"><div class="panel-head"><h3>دلیل تماس بعدی</h3></div>${bars(d.nextCallReason)}</div><div class="panel dim-panel" data-f="customerRank"><div class="panel-head"><h3>رتبه مشتری</h3></div>${bars(d.customerRank)}</div></div>
  <div class="grid4" id="openDims2"><div class="panel dim-panel" data-f="campaign"><div class="panel-head"><h3>کمپین</h3></div>${bars(d.campaign)}</div><div class="panel dim-panel" data-f="source"><div class="panel-head"><h3>منشا</h3></div>${bars(d.source)}</div><div class="panel dim-panel" data-f="sourceSoftware"><div class="panel-head"><h3>نرم‌افزار منشا</h3></div>${bars(d.sourceSoftware)}</div><div class="panel dim-panel" data-f="lastStatus"><div class="panel-head"><h3>آخرین وضعیت</h3></div>${bars(d.lastStatus)}</div></div>
  <div class="panel open-lead-detail-panel" id="openDetail" style="display:none"><div class="panel-head"><div><h3>جزئیات سرنخ‌های باز</h3><p id="openDetailSub">—</p></div><button class="clear" onclick="$('openDetail').style.display='none'">بستن</button></div><div id="openDetailBody"></div></div>`;

 document.querySelectorAll('#openPage [data-f]').forEach(panel=>bindBars(panel,v=>loadOpenDetail(panel.dataset.f,v)));
 document.querySelectorAll('[data-open-owner]').forEach(el=>el.onclick=()=>loadOpenDetail('owner',el.dataset.openOwner));
 document.querySelectorAll('#openPage [data-deadline-type]').forEach(el=>{el.onclick=()=>loadOpenDeadlineDetail(el.dataset.deadlineType,el.dataset.deadlineOwner||'');});
 bindOpenFilters();
 makeTableSortable($('openPage'));
}
