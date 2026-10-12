'use strict';

const TEHRAN_TZ='Asia/Tehran';
const TEHRAN_OFFSET='+03:30';
const PERSIAN_MONTHS=[
  '',
  'فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور',
  'مهر','آبان','آذر','دی','بهمن','اسفند'
];

function persianParts(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{
    timeZone:TEHRAN_TZ,
    year:'numeric',
    month:'numeric',
    day:'numeric'
  }).formatToParts(date);
  const obj=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return {
    year:Number(obj.year),
    month:Number(obj.month),
    day:Number(obj.day)
  };
}

function findGregorianDateForPersian(year,month,day){
  const startYear=Number(year)+621;
  const target=`${year}-${month}-${day}`;
  for(let i=0;i<500;i++){
    const probe=new Date(Date.UTC(startYear,0,1+i,12,0,0));
    const p=persianParts(probe);
    if(`${p.year}-${p.month}-${p.day}`===target){
      return {
        year:probe.getUTCFullYear(),
        month:probe.getUTCMonth()+1,
        day:probe.getUTCDate()
      };
    }
  }
  throw new Error('Could not resolve Persian date '+target+' to Gregorian date.');
}

function pad2(v){return String(v).padStart(2,'0');}
function faDigits(v){return String(v).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);}

function tehranMidnightIso(g){
  const local=`${g.year}-${pad2(g.month)}-${pad2(g.day)}T00:00:00${TEHRAN_OFFSET}`;
  const d=new Date(local);
  if(Number.isNaN(d.getTime()))throw new Error('Invalid Tehran date boundary: '+local);
  return d.toISOString();
}

function previousPersianMonthRange(now=new Date()){
  const current=persianParts(now);
  let year=current.year;
  let month=current.month-1;
  if(month<1){month=12;year--;}

  let endYear=year,endMonth=month+1;
  if(endMonth>12){endMonth=1;endYear++;}

  const startGregorian=findGregorianDateForPersian(year,month,1);
  const endGregorian=findGregorianDateForPersian(endYear,endMonth,1);
  const reportKey=`${year}-${pad2(month)}`;

  return {
    reportKey,
    label:`${PERSIAN_MONTHS[month]} ${faDigits(year)}`,
    persianYear:year,
    persianMonth:month,
    currentPersianDay:current.day,
    currentPersianYear:current.year,
    currentPersianMonth:current.month,
    start:tehranMidnightIso(startGregorian),
    end:tehranMidnightIso(endGregorian)
  };
}

module.exports={
  persianParts,
  previousPersianMonthRange,
  PERSIAN_MONTHS
};
