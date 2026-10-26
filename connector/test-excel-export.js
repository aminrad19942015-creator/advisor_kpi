'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const vendor=fs.readFileSync(path.join(root,'gas/ExcelVendor.html'),'utf8');
const scripts=fs.readFileSync(path.join(root,'gas/Scripts.html'),'utf8');
function browser(){
 const c=vm.createContext({console,Date,Intl,Uint8Array,ArrayBuffer,setTimeout,clearTimeout});
 vm.runInContext(vendor,c);
 vm.runInContext(scripts.slice(scripts.indexOf('function loadXlsxModule(){'),scripts.indexOf('function gasExportChunk(')),c);
 vm.runInContext(scripts.slice(scripts.indexOf('const EXCEL_DATE_COLUMNS='),scripts.indexOf('async function exportDashboardTab(')),c);
 return c;
}
test('pinned Excel library loads inside the page without any network import',async()=>{
 assert.equal(crypto.createHash('sha256').update(vendor).digest('hex'),'0cb353f830d7288385492c83d277b058ddeac664ca51cf1393aa1fd3e2b70939');
 const index=fs.readFileSync(path.join(root,'gas/Index.html'),'utf8');
 assert.ok(index.indexOf("include('ExcelVendor')")<index.indexOf("include('Scripts')"));
 assert.ok(!vendor.toLowerCase().includes('</script'));
 assert.ok(!scripts.includes('cdn.sheetjs.com'));
 const XLSX=await browser().loadXlsxModule();
 assert.equal(XLSX.version,'0.20.3');assert.equal(typeof XLSX.writeFile,'function');
});
test('actual export helpers round-trip six Persian sheets, AML numbers, dates and more than one data chunk',()=>{
 const c=browser(),X=c.XLSX,wb=X.utils.book_new();
 c.appendExportSheet(X,wb,'خلاصه مشاوران',c.exportAdvisorRows([{name:'آزمون',aml:7,amlAvg:3.5,total:12,attendanceDays:2}]));
 c.appendExportSheet(X,wb,'لیدها',[{created_date:'2026-10-25T07:30:00Z',lead_number:'00123',description:'=1+1'}]);
 c.appendExportSheet(X,wb,'فرصت ها',[]);
 c.appendExportSheet(X,wb,'تماس ها',Array.from({length:10001},(_,i)=>({ردیف:i+1,موضوع:'تکمیل فرم شناسایی مضاعف'})));
 c.appendExportSheet(X,wb,'تیکت ها',[{تعداد:5}]);
 c.appendExportSheet(X,wb,'فیلترها',c.exportFilterRows({advisor:['آزمون']}));
 const bytes=X.write(wb,{type:'array',bookType:'xlsx',compression:true});
 assert.equal(new Uint8Array(bytes)[0],0x50);assert.equal(new Uint8Array(bytes)[1],0x4b);
 const read=X.read(bytes,{type:'array'});assert.equal(read.SheetNames.length,6);
 const summary=X.utils.sheet_to_json(read.Sheets['خلاصه مشاوران'])[0];
 assert.equal(summary['پولشویی'],7);assert.equal(summary['سرانه پولشویی'],3.5);
 const leads=X.utils.sheet_to_json(read.Sheets['لیدها']);
 assert.equal(leads[0].lead_number,'00123');assert.equal(leads[0].description,'=1+1');
 assert.ok(leads[0].created_date.includes('۱۴۰۵/۰۸/۰۳'));
 assert.equal(read.Sheets['لیدها'].C2.f,undefined);
 assert.equal(X.utils.sheet_to_json(read.Sheets['تماس ها']).length,10001);
});
