/* ทดสอบ dividendCalendar() / divFrequency() ใน shared.js (v66)
 *   node scripts/test_dividends.cjs shared.js
 */
const fs = require('fs');
global.window = {}; global.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };
eval(fs.readFileSync(process.argv[2] || 'shared.js', 'utf8'));
let fail = 0;
const chk = (n, c, d) => { console.log(`  ${c?'✓':'✗'} ${n}${d?'  '+d:''}`); if(!c) fail++; };
const near = (a,b,t=0.01) => Math.abs(a-b) <= t;
const TODAY = '2026-09-28';
const q = (y) => ['02-10','05-10','08-10','11-10'].map(md => ({date:`${y}-${md}`, amount:0.25}));
const monthly = []; for(let m=1;m<=12;m++) monthly.push({date:`2025-${String(m).padStart(2,'0')}-03`, amount:0.4});
for(let m=1;m<=9;m++) monthly.push({date:`2026-${String(m).padStart(2,'0')}-03`, amount:0.45});
const fund = {
  AAPL:  { profile:{currency:'USD'}, dividends:[...q(2024), ...q(2025), ...q(2026).slice(0,3)] },   // ex ล่าสุด 2026-08-10
  JEPI:  { profile:{currency:'USD'}, dividends: monthly },
  KBANK: { profile:{currency:'THB'}, dividends:[{date:'2025-04-20',amount:4},{date:'2025-08-25',amount:2},{date:'2026-04-22',amount:5},{date:'2026-08-26',amount:2.5}] },
  NODIV: { profile:{currency:'USD'}, dividends:[] },
};
const holdings = [{ticker:'AAPL',qty:10},{ticker:'JEPI',qty:100},{ticker:'KBANK',qty:200},{ticker:'NODIV',qty:5},{ticker:'X',qty:1}];
const received = [{ticker:'KBANK', date:'2026-09-12', amtTHB:450}];   // จ่ายรอบ ex 2026-08-26 แล้ว (หลังหักภาษี)
const fx = { USD: 34 };

console.log('\n═══ ความถี่ ═══');
chk('รายไตรมาส', divFrequency(fund.AAPL.dividends.map(d=>d.date)).en === 'Quarterly');
chk('รายเดือน', divFrequency(fund.JEPI.dividends.map(d=>d.date)).en === 'Monthly');
chk('ครึ่งปี', divFrequency(fund.KBANK.dividends.map(d=>d.date)).en === 'Semi-annual');
chk('ไม่มีประวัติ → null', divFrequency([]) === null);

console.log('\n═══ dividendCalendar ═══');
const c = dividendCalendar(holdings, fund, received, fx, TODAY);
const ev = (t,s) => c.events.filter(e=>e.ticker===t && (!s || e.status===s));
chk('ไม่เดาปันผลให้ตัวที่ไม่มีประวัติ', !ev('NODIV').length && !ev('X').length);
chk('AAPL ฉายภาพ 4 รอบใน 12 เดือนข้างหน้า', ev('AAPL','estimated').length === 4, ev('AAPL','estimated').map(e=>e.exDate).join(' '));
chk('AAPL รอบ ex 2026-08-10 ยังไม่เจอเงินเข้า → รอรับ (declared)', ev('AAPL','declared').length === 1 && ev('AAPL','declared')[0].exDate === '2026-08-10');
chk('ยอด = DPS × หุ้น × FX', near(ev('AAPL','estimated')[0].amount, 0.25*10*34));
chk('KBANK ที่ได้รับแล้ว ใช้ยอดจริงจากชีต', ev('KBANK','received').length === 1 && ev('KBANK','received')[0].amount === 450);
chk('KBANK ไม่ขึ้นรอรับซ้ำกับที่ได้รับแล้ว', !ev('KBANK','declared').length);
chk('หุ้นไทยไม่คูณ FX', near(ev('KBANK','estimated').find(e=>e.exDate.startsWith('2027-04')).amount, 5*200));
chk('JEPI รายเดือนฉายภาพ ≥ 11 รอบ', ev('JEPI','estimated').length >= 11, ev('JEPI','estimated').length);
const payIn12 = c.events.filter(e => e.status!=='received' && e.payDate > TODAY && e.payDate <= '2027-09-28');
chk('รายได้ต่อปี = ยอดที่วันจ่ายอยู่ใน 12 เดือนข้างหน้า', near(c.annual, payIn12.reduce((s,e)=>s+e.amount,0)));
chk('รายเดือน/รายวันสอดคล้อง', near(c.monthly, c.annual/12) && near(c.daily, c.annual/365));
chk('ยังไม่ได้รับ = ผลรวม declared', near(c.yetToReceive, c.events.filter(e=>e.status==='declared').reduce((s,e)=>s+e.amount,0)) && c.yetToReceive > 0);
chk('12 เดือนเริ่มเดือนปัจจุบัน', c.months.length === 12 && c.months[0].key === '2026-09' && c.months[11].key === '2027-08');
const aapl4 = ev('AAPL').filter(e=>e.payDate > TODAY && e.payDate <= '2027-09-28').length;
chk('ไม่นับรอบเดียวกันซ้ำ (declared + ฉายภาพ) ในรายได้ต่อปีของ AAPL', aapl4 === 4, aapl4);
chk('ไม่มี FX ของสกุลนั้น → ข้าม ไม่ใช่นับเป็น 1:1', !dividendCalendar([{ticker:'AAPL',qty:10}], fund, [], {}, TODAY).events.length);
console.log(fail ? `\n❌ ไม่ผ่าน ${fail} ข้อ` : '\n✅ ผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
