'use strict';
const assert=require('assert');
const {persianParts,previousPersianMonthRange}=require('./persian-month');

function atTehranNoon(isoBoundary){
  return new Date(new Date(isoBoundary).getTime()+12*3600*1000);
}

const mehr20=new Date('2026-10-12T10:00:00.000Z');
const r=previousPersianMonthRange(mehr20);
assert.strictEqual(r.reportKey,'1405-06');
assert.strictEqual(r.label,'شهریور 1405');
assert.strictEqual(r.currentPersianDay,20);
assert.deepStrictEqual(persianParts(atTehranNoon(r.start)),{year:1405,month:6,day:1});
assert.deepStrictEqual(persianParts(atTehranNoon(r.end)),{year:1405,month:7,day:1});

const farvardin20=new Date('2027-04-09T10:00:00.000Z');
const r2=previousPersianMonthRange(farvardin20);
assert.strictEqual(r2.reportKey,'1405-12');
assert.deepStrictEqual(persianParts(atTehranNoon(r2.start)),{year:1405,month:12,day:1});
assert.deepStrictEqual(persianParts(atTehranNoon(r2.end)),{year:1406,month:1,day:1});

console.log('PERSIAN_MONTH_RANGE_TEST_OK',r);
