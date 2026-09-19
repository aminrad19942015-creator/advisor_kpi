function selectedValues(el){return [...el.options].filter(o=>o.selected).map(o=>o.value).filter(Boolean)}

function ensureDropdownMulti(id,onchange){
  const sel=$(id);
  if(!sel || sel.dataset.multiReady==='1') return;

  sel.dataset.multiReady='1';
  sel.multiple=true;
  sel.classList.add('multi-host');

  const box=document.createElement('div');
  box.className='multi';
  box.dataset.for=id;
  box.innerHTML=`
    <button type="button" class="multi-btn">
      <span class="multi-label">همه</span>
      <span class="multi-count"></span>
      <span>⌄</span>
    </button>
    <div class="multi-menu"></div>
  `;
  sel.insertAdjacentElement('afterend',box);

  const btn=box.querySelector('.multi-btn');

  btn.onclick=e=>{
    e.stopPropagation();

    document.querySelectorAll('.multi.open').forEach(x=>{
      if(x!==box) x.classList.remove('open');
    });

    box.classList.toggle('open');
  };

  box.querySelector('.multi-menu').onclick=e=>e.stopPropagation();
  box._changeHandler=onchange;
}

function syncDropdownMulti(id){
  const sel=$(id);
  if(!sel) return;

  const box=sel.nextElementSibling;
  if(!box || !box.classList.contains('multi')) return;

  const menu=box.querySelector('.multi-menu');

  menu.innerHTML=`
    <div class="multi-tools">
      <button type="button" class="multi-tool all">انتخاب همه</button>
      <button type="button" class="multi-tool none">پاک کردن</button>
    </div>
  ` + [...sel.options].map((o,i)=>`
    <label class="multi-option">
      <input type="checkbox" data-i="${i}" ${o.selected?'checked':''}>
      <span>${safe(o.textContent)}</span>
    </label>
  `).join('');

  menu.querySelectorAll('input[type="checkbox"]').forEach(cb=>{
    cb.onchange=()=>{
      sel.options[Number(cb.dataset.i)].selected=cb.checked;
      updateDropdownLabel(id);
      if(box._changeHandler) box._changeHandler(selectedValues(sel));
    };
  });

  menu.querySelector('.all').onclick=()=>{
    [...sel.options].forEach(o=>o.selected=true);
    syncDropdownMulti(id);
    if(box._changeHandler) box._changeHandler(selectedValues(sel));
  };

  menu.querySelector('.none').onclick=()=>{
    [...sel.options].forEach(o=>o.selected=false);
    syncDropdownMulti(id);
    if(box._changeHandler) box._changeHandler([]);
  };

  updateDropdownLabel(id);
}

function updateDropdownLabel(id){
  const sel=$(id);
  const box=sel?.nextElementSibling;
  if(!sel || !box) return;

  const vals=selectedValues(sel);
  const label=box.querySelector('.multi-label');
  const count=box.querySelector('.multi-count');

  box.classList.toggle('has-selection',vals.length>0);

  if(count) count.textContent=fa(vals.length);

  if(!vals.length){
    label.textContent='همه';
  }else if(vals.length===1){
    label.textContent=vals[0];
  }else{
    label.textContent=`${fa(vals.length)} مورد انتخاب شده`;
  }
}

function simpleMulti(id,vals,selected,onchange){
  setTimeout(()=>{
    const el=$(id);
    if(!el) return;

    const chosen=Array.isArray(selected)?selected.filter(Boolean):[];
    el.innerHTML=optionHtml(vals,chosen);
    el.multiple=true;

    if(!chosen.length){
      [...el.options].forEach(o=>o.selected=false);
      el.selectedIndex=-1;
    }else{
      const set=new Set(chosen);
      [...el.options].forEach(o=>o.selected=set.has(o.value));
    }

    ensureDropdownMulti(id,onchange);

    const box=el.nextElementSibling;
    if(box && box.classList.contains('multi')) box._changeHandler=onchange;

    syncDropdownMulti(id);
  },0);
}

document.addEventListener('click',()=>{
  document.querySelectorAll('.multi.open').forEach(x=>x.classList.remove('open'));
});
function setPageLoading(pageId,on){
  const el=$(pageId);if(el)el.classList.toggle('filter-loading',on);
}
function teamFiltersHtml(){
  const o=filterOptions.team||{},f=filterState.team;
  return `<div class="filters">
    <div class="field"><label>جست‌وجوی نام</label><input id="tfSearch" value="${safe(f.search||'')}" placeholder="نام و نام خانوادگی..."></div>
    <div class="field"><label>تیم لید</label><select id="tfLead"></select></div>
    <div class="field"><label>تیم</label><select id="tfTeam"></select></div>
    <div class="field"><label>جنسیت</label><select id="tfGender"></select></div>
    <div class="field"><label>رده</label><select id="tfRole"></select></div>
    <div class="field"><label>واحد تجاری</label><select id="tfUnit"></select></div>
    <button class="clear" id="tfClear">پاک کردن</button>
  </div>`;
}
function openFiltersHtml(){
  const f=filterState.open;
  return `<div class="lead-filter-section">
   <div class="lead-filter-row">
    <div class="field"><label>مشاور / مالک</label><select id="ofAdvisor"></select></div>
    <div class="field"><label>رده</label><select id="ofRole"></select></div>
    <div class="field"><label>تیم</label><select id="ofTeam"></select></div>
    <div class="field"><label>واحد تجاری فرد</label><select id="ofUnit"></select></div>
    <div class="field"><label>بازه سن</label><select id="ofAge">
      <option value="">همه</option><option value="0-3">۰ تا ۳ روز</option><option value="4-7">۴ تا ۷ روز</option>
      <option value="8-14">۸ تا ۱۴ روز</option><option value="15-30">۱۵ تا ۳۰ روز</option><option value="31+">بیشتر از ۳۰ روز</option>
    </select></div>
   </div>
   <div class="lead-filter-row">
    <div class="field"><label>نوع سرنخ</label><select id="ofType"></select></div>
    <div class="field"><label>دلیل تماس بعدی</label><select id="ofReason"></select></div>
    <div class="field"><label>رتبه مشتری</label><select id="ofRank"></select></div>
    <div class="field"><label>کمپین</label><select id="ofCampaign"></select></div>
    <div class="field"><label>منشا</label><select id="ofSource"></select></div>
    <div class="field"><label>آخرین وضعیت</label><select id="ofStatus"></select></div>
   </div>
   <div class="lead-filter-actions">
    <button class="clear" id="ofClear">پاک کردن فیلترها</button>
   </div>
  </div>`;
}
function periodFiltersHtml(period){
  return `<div class="filters activity-filters">
    <div class="field"><label>مشاور</label><select id="${period}FAdvisor"></select></div>
    <div class="field"><label>تیم لید</label><select id="${period}FLead"></select></div>
    <div class="field"><label>تیم</label><select id="${period}FTeam"></select></div>
    <div class="field"><label>رده</label><select id="${period}FRole"></select></div>
    <div class="field"><label>کمپین</label><select id="${period}FCampaign"></select></div>
    <button class="clear" id="${period}FClear">پاک کردن</button>
  </div>`;
}
function bindTeamFilters(){
  const o=filterOptions.team||{},f=filterState.team;
  const s=$('tfSearch');if(s)s.oninput=()=>{filterState.team.search=s.value;debouncedApplyTeam()};
  simpleMulti('tfLead',o.teamLead,f.teamLead,v=>{f.teamLead=v;applyTeamFilters()});
  simpleMulti('tfTeam',o.team,f.team,v=>{f.team=v;applyTeamFilters()});
  simpleMulti('tfGender',o.gender,f.gender,v=>{f.gender=v;applyTeamFilters()});
  simpleMulti('tfRole',o.role,f.role,v=>{f.role=v;applyTeamFilters()});
  simpleMulti('tfUnit',o.businessUnit,f.businessUnit,v=>{f.businessUnit=v;applyTeamFilters()});
  setTimeout(()=>{$('tfClear').onclick=()=>{filterState.team={search:'',teamLead:[],team:[],gender:[],role:[],businessUnit:[]};applyTeamFilters()}},0);
}
