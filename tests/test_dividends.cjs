/* ทดสอบ dividendCalendar() / divFrequency() ใน shared.js (v66)
 *   node tests/test_dividends.cjs shared.js
 */
const fs = require('fs');
global.window = {}; global.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };
eval(fs.readFileSync(process.argv[2] || 'js/shared.js', 'utf8'));
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

console.log('\n═══ v82 — byTicker + กราฟ Yield/Payout ═══');
const bt = c.byTicker;
chk('byTicker รวมกัน = annual (ชุดเดียวกัน)', near(Object.values(bt).reduce((a,b)=>a+b,0), c.annual, 1e-6), JSON.stringify(bt));
chk('ตัวไม่มีปันผล/ไม่มีข้อมูลไม่อยู่ใน byTicker', !('NODIV' in bt) && !('X' in bt));
// มูลค่า/ต้นทุน (บาท) · Industry จาก Asset_Tracker · WMT ไม่มีคาดการณ์แต่ได้รับจริง 12 เดือน · TLT ไม่จ่าย
const H = [
  { ticker:'AAPL', group:'US Stock',  industry:'Technology', val:80000,  cost:50000 },
  { ticker:'JEPI', group:'US Stock',  industry:'ETF',        val:190000, cost:200000 },
  { ticker:'KBANK',group:'Thai Stock',industry:'Banking',    val:30000,  cost:25000 },
  { ticker:'WMT',  group:'US Stock',  industry:'Retail',     val:20000,  cost:10000 },
  { ticker:'TLT',  group:'US Stock',  industry:'—',          val:10000,  cost:12000 },
  { ticker:'PF',   group:'Provident Fund', industry:'',      val:50000,  cost:40000 },
];
const fwd = { AAPL:400, JEPI:13300, KBANK:1500 }, rec12 = { WMT:250, JEPI:12000 };
const VH = dividendYieldView(H, fwd, rec12, 'holdings', 'yield');
chk('รายตัว: เฉพาะตัวที่มีปันผล (4 ตัว ไม่มี TLT/PF)', VH.rows.map(r=>r.key).sort().join() === 'AAPL,JEPI,KBANK,WMT', VH.rows.map(r=>r.key).join());
const J = VH.rows.find(r=>r.key==='JEPI');
chk('มีคาดการณ์ → ใช้คาดการณ์ (ไม่ใช้ยอดได้รับจริง)', J.payout === 13300 && J.basis === 'forecast');
chk('JEPI Yield = 13,300 ÷ 190,000 = 7% · YOC = 6.65%', near(J.yield, 0.07, 1e-9) && near(J.yoc, 0.0665, 1e-9));
const Wm = VH.rows.find(r=>r.key==='WMT');
chk('ไม่มีคาดการณ์ → ใช้ที่ได้รับจริง 12 เดือน', Wm.payout === 250 && Wm.basis === 'received');
chk('เรียงตาม Yield มาก → น้อย', VH.rows.map(r=>r.key).join() === 'JEPI,KBANK,WMT,AAPL', VH.rows.map(r=>r.key+':'+r.yield.toFixed(4)).join());
chk('เรียงตามยอดบาท (payout)', dividendYieldView(H, fwd, rec12, 'holdings', 'payout').rows.map(r=>r.key).join() === 'JEPI,KBANK,AAPL,WMT');
const tot = VH.total;
chk('รวมพอร์ต: ปันผล 15,450 ÷ มูลค่าทั้งหมด 380,000', tot.payout === 15450 && tot.val === 380000 && near(tot.yield, 15450/380000, 1e-12) && tot.payers === 4 && tot.fromReceived === 1);
const VC = dividendYieldView(H, fwd, rec12, 'categories', 'yield');
const US = VC.rows.find(r=>r.key==='US Stock');
chk('ประเภท: US Stock หารด้วยมูลค่าทั้งกลุ่ม (รวม TLT ที่ไม่จ่าย)', US.payout === 13950 && US.val === 300000 && near(US.yield, 13950/300000, 1e-12) && US.basis === 'mixed');
chk('ประเภทที่ไม่มีปันผล (Provident Fund) ไม่แสดง', !VC.rows.some(r=>r.key==='Provident Fund') && VC.rows.length === 2);
const VS = dividendYieldView(H, fwd, rec12, 'sectors', 'payout');
chk('อุตสาหกรรม: ใช้ Industry จากชีต', VS.rows.map(r=>r.key).join() === 'ETF,Banking,Technology,Retail', VS.rows.map(r=>r.key).join());
chk('Industry ว่าง/"—" → กลุ่ม "ไม่ระบุ" (ไม่แสดงถ้าไม่มีปันผล)', !VS.rows.some(r=>r.key==='—'));
chk('Industry ว่างแต่จ่ายปันผล → อยู่กลุ่ม "ไม่ระบุ"', dividendYieldView([{ticker:'Z',group:'US Stock',industry:'',val:100,cost:100}], {Z:5}, {}, 'sectors').rows[0].key === '—');
chk('ไม่มีราคา (มูลค่า 0) → Yield = null ไว้ท้าย · ยังเห็นยอดบาท', (() => { const v = dividendYieldView([{ticker:'A',val:0,cost:0},{ticker:'B',val:100,cost:100}], {A:9, B:1}, {}, 'holdings', 'yield'); return v.rows[1].key==='A' && v.rows[1].yield===null && v.rows[1].payout===9; })());
chk('ไม่มีข้อมูล → ว่าง', dividendYieldView([], {}, {}, 'holdings').rows.length === 0 && dividendYieldView(null).total.yield === null);
console.log(fail ? `\n❌ ไม่ผ่าน ${fail} ข้อ` : '\n✅ ผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
