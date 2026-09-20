function loadOpenDeadlineDetail(leadType,owner){
 const box=$('openDetail');
 box.style.display='block';

 const title=leadType==='حقیقی'?'حقیقی نزدیک سررسید':'حقوقی نزدیک سررسید';
 $('openDetailSub').textContent='در حال دریافت '+title+'...';
 $('openDetailBody').innerHTML='<div class="empty">در حال خواندن جزئیات...</div>';

 google.script.run
  .withFailureHandler(e=>{
    $('openDetailBody').innerHTML='<div class="data-note">'+safe(e.message||e)+'</div>';
  })
  .withSuccessHandler(rows=>{
    $('openDetailSub').textContent=title+(owner?' — '+owner:'')+' — '+fa(rows.length)+' رکورد';
    $('openDetailBody').innerHTML=`<div class="table-wrap activity-detail-wrap"><table class="table"><thead><tr><th>مشاور</th><th>شماره سرنخ</th><th>نام مشتری</th><th>نوع</th><th>تاریخ ثبت</th><th>سن</th><th>روز باقی‌مانده</th><th>رتبه</th><th>کمپین</th><th>منشا</th><th>آخرین وضعیت</th><th>دلیل تماس بعدی</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${safe(r.owner||'—')}</td><td>${safe(r.leadNumber||'—')}</td><td>${safe(r.customerName||'—')}</td><td>${safe(r.leadType||'—')}</td><td>${fmt(r.createdDate)}</td><td>${fa(r.ageDays)} روز</td><td><b>${fa(r.remainingDays)} روز</b></td><td>${safe(r.customerRank||'—')}</td><td>${safe(r.campaign||'—')}</td><td>${safe(r.source||'—')}</td><td>${safe(r.lastStatus||'—')}</td><td>${safe(r.nextCallReason||'بدون تسک')}</td></tr>`).join('')}</tbody></table></div>`;
    makeTableSortable(box);
    box.scrollIntoView({behavior:'smooth',block:'start'});
  })
  .getOpenNearDeadlineDetails(leadType,owner,filterState.open);
}

function loadOpenDetail(field,value){
 const box=$('openDetail');box.style.display='block';$('openDetailSub').textContent='در حال دریافت...';$('openDetailBody').innerHTML='<div class="empty">در حال خواندن جزئیات...</div>';
 google.script.run.withFailureHandler(e=>{$('openDetailBody').innerHTML='<div class="data-note">'+safe(e.message||e)+'</div>'}).withSuccessHandler(rows=>{
  $('openDetailSub').textContent=fa(rows.length)+' رکورد';
  $('openDetailBody').innerHTML=`<div class="table-wrap activity-detail-wrap"><table class="table"><thead><tr><th>مشاور</th><th>شماره سرنخ</th><th>نام مشتری</th><th>تاریخ ثبت</th><th>سن</th><th>نوع</th><th>رتبه</th><th>کمپین</th><th>منشا</th><th>نرم‌افزار منشا</th><th>آخرین وضعیت</th><th>دلیل تماس بعدی</th><th>واحد تجاری</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${safe(r.owner||'—')}</td><td>${safe(r.leadNumber||'—')}</td><td>${safe(r.customerName||'—')}</td><td>${fmt(r.createdDate)}</td><td>${fa(r.ageDays)}</td><td>${safe(r.leadType||'—')}</td><td>${safe(r.customerRank||'—')}</td><td>${safe(r.campaign||'—')}</td><td>${safe(r.source||'—')}</td><td>${safe(r.sourceSoftware||'—')}</td><td>${safe(r.lastStatus||'—')}</td><td>${safe(r.nextCallReason||'بدون تسک')}</td><td>${safe(r.businessUnit||'—')}</td></tr>`).join('')}</tbody></table></div>`;
  makeTableSortable(box);box.scrollIntoView({behavior:'smooth',block:'start'});
 }).getOpenLeadDetails(field,value);
}

function activityCards(k,period){
 const title=period==='daily'?'فعالیت کل':period==='weekly'?'فعالیت کل هفته':'فعالیت کل ماه';
 return `<div class="activity-kpis weekly-kpis"><div class="kpi"><div class="kpi-label">${title}</div><div class="kpi-value">${fa(k.total)}</div><div class="kpi-sub">لید صحبت‌شده + فرصت OPP + T8 + تیکت</div></div><div class="kpi"><div class="kpi-label">لید بسته‌شده</div><div class="kpi-value">${fa(k.closed)}</div><div class="kpi-sub">میانگین زمان بستن ${k.closeAvg==null?'—':Number(k.closeAvg).toFixed(1)+' روز'}</div></div><div class="kpi"><div class="kpi-label">لید صحبت‌شده</div><div class="kpi-value">${fa(k.talked)}</div><div class="kpi-sub">مبنای فعالیت</div></div><div class="kpi"><div class="kpi-label">فرصت از LEAD</div><div class="kpi-value">${fa(k.oppLead)}</div><div class="kpi-sub">صرفاً آماری</div></div><div class="kpi"><div class="kpi-label">فرصت از OPP</div><div class="kpi-value">${fa(k.opp)}</div><div class="kpi-sub">داخل فعالیت کل</div></div><div class="kpi"><div class="kpi-label">کل تماس</div><div class="kpi-value">${fa(k.calls)}</div><div class="kpi-sub">${fa(k.uniqueCalls)} لید یکتا / ${fa(k.repeatCalls)} تماس اضافه</div></div><div class="kpi"><div class="kpi-label">تماس ورودی T8</div><div class="kpi-value">${fa(k.t8)}</div><div class="kpi-sub">زیرمجموعه تماس‌ها</div></div><div class="kpi"><div class="kpi-label">تیکت</div><div class="kpi-value">${fa(k.tickets)}</div><div class="kpi-sub">رسیدگی‌شده</div></div>${period==='daily'?'':`<div class="kpi accent-kpi"><div class="kpi-label">سرانه تماس روزانه واحد</div><div class="kpi-value">${Number(k.callAvg||0).toFixed(2)}</div></div><div class="kpi accent-kpi"><div class="kpi-label">سرانه لید بسته در روز</div><div class="kpi-value">${Number(k.closedAvg||0).toFixed(2)}</div></div><div class="kpi accent-kpi"><div class="kpi-label">سرانه لید صحبت‌شده در روز</div><div class="kpi-value">${Number(k.talkedAvg||0).toFixed(2)}</div></div>`}</div>`;
}

function renderPeriod(period,pageId,title){
 const s=state.data[period]||{},k=s.kpis||{},d=s.dimensions||{};
 $(pageId).innerHTML=`
  ${reportBadge(period==='daily'?'تاریخ گزارش':'بازه گزارش',rangeText(s))}
  <div class="topbar"><div class="title"><h2>${title}</h2><p>نمای مدیریتی یکپارچه فعالیت، روند روزانه و سرانه عملکرد مشاوران</p></div><div class="pill">۴ منبع ${period==='daily'?'روزانه':period==='weekly'?'هفتگی':'ماهانه'}</div></div>
  ${periodFiltersHtml(period)}
  ${activityCards(k,period)}
  ${period==='daily'?'':`<div class="panel trend-main-panel"><div class="panel-head trend-panel-head"><div><h3>روند روزانه فعالیت</h3><p>نمودار با فیلترهای بالای صفحه همگام است و خط‌چین، میانگین روزانه کل واحد را نشان می‌دهد.</p></div><div class="chart-select"><select id="${period}TrendMetric"><option value="talked">لید صحبت‌شده</option><option value="opp">فرصت OPP</option><option value="calls">تماس</option><option value="t8">T8</option><option value="tickets">تیکت</option><option value="total">فعالیت کل</option></select></div></div><div id="${period}TrendChart" class="line-chart">${trendChart(s.teamTrend||[],trendMetricState[period]||'total',s.unitTrend||[])}</div></div>`}
  <div class="panel activity-main-panel"><div class="panel-head"><div><h3>${period==='daily'?'فعالیت به تفکیک مشاور':'فعالیت و سرانه به تفکیک مشاور'}</h3><p>مقایسه حجم فعالیت و تشخیص افراد کم‌فعال/پرفعال</p></div><span class="badge">${fa((s.advisors||[]).length)} نفر</span></div><div class="table-wrap activity-table-wrap"><table class="table"><thead><tr><th>مشاور</th><th>تیم لید</th><th>تیم</th><th>لید بسته</th><th>لید صحبت‌شده ⓘ</th><th>فرصت OPP</th><th>تماس</th><th>T8</th><th>تیکت</th><th>فعالیت کل</th>${period==='daily'?'':'<th>روز حضور</th><th>سرانه تماس</th><th>سرانه لید بسته</th><th>سرانه لید صحبت‌شده</th><th>سرانه OPP</th><th>سرانه T8</th><th>سرانه تیکت</th><th>سرانه فعالیت</th>'}</tr></thead><tbody>${(s.advisors||[]).map(r=>`<tr><td><b>${safe(r.name)}</b></td><td>${safe(r.teamLead||'—')}</td><td>${safe(r.team||'—')}</td><td><span class="activity-num" data-p="${period}" data-t="lead" data-u="${safe(r.name)}">${fa(r.leads)}</span></td><td><span class="activity-num" data-p="${period}" data-t="talked" data-u="${safe(r.name)}">${fa(r.talked)}</span></td><td><span class="activity-num" data-p="${period}" data-t="opp" data-u="${safe(r.name)}">${fa(r.opps)}</span></td><td><span class="activity-num" data-p="${period}" data-t="call" data-u="${safe(r.name)}">${fa(r.calls)}</span></td><td><span class="activity-num" data-p="${period}" data-t="t8" data-u="${safe(r.name)}">${fa(r.t8)}</span></td><td><span class="activity-num" data-p="${period}" data-t="ticket" data-u="${safe(r.name)}">${fa(r.tickets)}</span></td><td><b>${fa(r.total)}</b></td>${period==='daily'?'':`<td><b>${fa(r.attendanceDays||0)}</b></td><td>${Number(r.callAvg||0).toFixed(2)}</td><td>${Number(r.leadAvg||0).toFixed(2)}</td><td>${Number(r.talkedAvg||0).toFixed(2)}</td><td>${Number(r.oppAvg||0).toFixed(2)}</td><td>${Number(r.t8Avg||0).toFixed(2)}</td><td>${Number(r.ticketAvg||0).toFixed(2)}</td><td><b>${Number(r.activityAvg||0).toFixed(2)}</b></td>`}</tr>`).join('')}</tbody></table></div></div>
  <div class="panel activity-detail-panel" id="${period}Detail" style="display:none"><div class="panel-head"><div><h3>جزئیات فعالیت</h3><p id="${period}DetailSub">—</p></div><button class="clear" onclick="$('${period}Detail').style.display='none'">بستن</button></div><div id="${period}DetailBody"></div></div>
  <div class="grid2" id="${period}Dims1"><div class="panel" data-source="lead" data-field="lastStatus"><div class="panel-head"><div><h3>آخرین وضعیت لیدها</h3><p>توزیع وضعیت نهایی</p></div></div>${bars(d.leadState)}</div><div class="panel" data-source="lead" data-field="customerRank"><div class="panel-head"><div><h3>رتبه مشتری لیدها</h3><p>توزیع رتبه مشتری</p></div></div>${bars(d.rank)}</div><div class="panel" data-source="lead" data-field="source"><div class="panel-head"><div><h3>لید از منشا</h3><p>تعداد به تفکیک منشا</p></div></div>${bars(d.leadSource)}</div><div class="panel" data-source="lead" data-field="campaign"><div class="panel-head"><div><h3>کمپین لیدها</h3><p>کمپین‌های پرتکرار</p></div></div>${bars(d.campaign)}</div></div>
  <div class="grid2" id="${period}Dims2"><div class="panel" data-source="opp" data-field="registrationType"><div class="panel-head"><div><h3>فرصت‌ها: LEAD در برابر OPP</h3><p>نوع ایجاد فرصت</p></div></div>${bars(d.oppKind)}</div><div class="panel" data-source="opp" data-field="status"><div class="panel-head"><div><h3>وضعیت فرصت‌ها</h3><p>Open / Won / Lost و سایر وضعیت‌ها</p></div></div>${bars(d.oppStatus)}</div><div class="panel" data-source="ticket" data-field="statusReason"><div class="panel-head"><div><h3>علت وضعیت تیکت</h3><p>خروجی تیکت‌ها</p></div></div>${bars(d.ticketState)}</div><div class="panel" data-source="ticket" data-field="contactTopic"><div class="panel-head"><div><h3>موضوع تیکت</h3><p>موضوعات پرتکرار</p></div></div>${bars(d.ticketSubject)}</div><div class="panel" data-source="call" data-field="subject"><div class="panel-head"><div><h3>موضوع تماس</h3><p>موضوع تماس‌های ثبت‌شده</p></div></div>${bars(d.callSubject)}</div><div class="panel" data-source="lead" data-field="sourceTicketContactTopic"><div class="panel-head"><div><h3>موضوع تماس (تیکت منشأ)</h3><p>موضوع تیکت منشأ ثبت‌شده روی لیدها</p></div></div>${bars(d.leadTicketTopic)}</div></div>
  <div class="panel dimension-detail-panel" id="${period}DimensionDetail" style="display:none"><div class="panel-head"><div><h3>جزئیات شاخص</h3><p id="${period}DimensionDetailSub">—</p></div><button class="clear" onclick="$('${period}DimensionDetail').style.display='none'">بستن</button></div><div id="${period}DimensionDetailBody"></div></div>
  <div class="panel"><div class="panel-head"><div><h3>شاخص‌های کیفیت تماس</h3><p>لید یکتا و تماس اضافه روی لید تکراری</p></div></div><div class="mini-stats"><div><b>${fa(k.uniqueCalls)}</b><span>لید یکتای تماس‌شده</span></div><div><b class="period-clickable" data-repeat="${period}">${fa(k.repeatCalls)}</b><span>تماس اضافه روی لید تکراری</span></div><div><b>${k.closeAvg==null?'—':Number(k.closeAvg).toFixed(1)}</b><span>میانگین زمان بستن لید (روز)</span></div><div><b>${fa(s.dayCount)}</b><span>روز موجود در گزارش</span></div></div></div>`;
 document.querySelectorAll(`#${pageId} .activity-num`).forEach(el=>el.onclick=()=>loadActivityDetail(el.dataset.p,el.dataset.t,el.dataset.u));
 document.querySelectorAll(`#${pageId} [data-source]`).forEach(panel=>bindBars(panel,v=>loadDimension(period,panel.dataset.source,panel.dataset.field,v)));
 const repeat=document.querySelector(`#${pageId} [data-repeat]`);if(repeat)repeat.onclick=()=>loadRepeated(period);
 if(period!=='daily'){
  const sel=$(period+'TrendMetric');
  if(sel){
   sel.value=trendMetricState[period]||'total';
   sel.onchange=()=>{trendMetricState[period]=sel.value;$(period+'TrendChart').innerHTML=trendChart((state.data[period]||{}).teamTrend||[],sel.value,(state.data[period]||{}).unitTrend||[]);bindTrendChartHover($(period+'TrendChart'));};
  }
  bindTrendChartHover($(period+'TrendChart'));
 }
 bindPeriodFilters(period);
 makeTableSortable($(pageId));
}
