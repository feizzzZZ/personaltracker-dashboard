/* ทดสอบ rebalancePlan() ใน shared.js (v66 · v69 นับ PVD ในฐานพอร์ต)
 *   node scripts/test_rebalance.cjs shared.js
 */
const fs = require('fs');
const store = {};
global.window = {}; global.localStorage = { getItem:k=>store[k]??null, setItem:(k,v)=>{store[k]=String(v)}, removeItem:k=>{delete store[k]} };
eval(fs.readFileSync(process.argv[2] || 'shared.js', 'utf8'));
let fail = 0;
const chk = (n, c, d) => { console.log(`  ${c?'✓':'✗'} ${n}${d?'  '+d:''}`); if(!c) fail++; };
const near = (a,b,t=1) => Math.abs(a-b) <= t;
const H = [
  {ticker:'VOO',   group:'US Stock',       qty:10,   price:18000, val:180000, cost:150000},
  {ticker:'KBANK', group:'Thai Stock',     qty:500,  price:150,   val:75000,  cost:70000},
  {ticker:'BTC',   group:'Crypto',         qty:0.01, price:3.5e6, val:35000,  cost:30000},
  {ticker:'GOLD',  group:'Gold',           qty:1,    price:60000, val:60000,  cost:50000},
  {ticker:'PVD',   group:'Provident Fund', qty:1000, price:100,   val:100000, cost:90000},
];
const T = { VOO:40, KBANK:30, BTC:10, GOLD:20, PVD:50 };   // PVD ขายไม่ได้ (illiquid): นับในพอร์ต แต่ไม่ซื้อขาย · เป้าที่ใส่ถูกเมิน
const by = (p,t) => p.rows.find(r=>r.ticker===t);

console.log('\n═══ Top up ═══');
{
  const p = rebalancePlan(H, T, 50000, 'topup');
  // v69 — PVD นับเข้าพอร์ต (แถว locked) แต่ไม่มีคำสั่งซื้อขาย
  chk('PVD อยู่ในตาราง แบบ locked ไม่ซื้อขาย', by(p,'PVD') && by(p,'PVD').locked && by(p,'PVD').tradeUnits === 0);
  chk('มูลค่าก่อนปรับ = ทั้งพอร์ตรวม PVD (450,000)', near(p.totalBefore, 450000, 0.01) && near(p.liquidBefore, 350000, 0.01), p.totalBefore);
  chk('มูลค่าหลังปรับรวม PVD', near(p.totalAfter, 450000 + p.totalBuy, 0.01), p.totalAfter);
  chk('สัดส่วน PVD ตอนนี้ = 100k/450k = 22.2%', near(by(p,'PVD').shareNow, 22.22, 0.01), by(p,'PVD').shareNow);
  chk('สัดส่วน VOO ตอนนี้คิดบนทั้งพอร์ต (180k/450k = 40%)', near(by(p,'VOO').shareNow, 40, 0.01), by(p,'VOO').shareNow);
  chk('สัดส่วนตอนนี้รวม 100', near(p.rows.reduce((s,r)=>s+r.shareNow,0), 100, 0.01));
  chk('ไม่ขายอะไรเลย', p.rows.every(r=>r.tradeTHB >= 0));
  chk('ใช้เงินไม่เกินที่เติม', p.totalBuy <= 50000 + 0.01, p.totalBuy.toFixed(2));
  chk('ใช้เงินเกือบหมด (เหลือ < 1 lot หุ้นไทย)', p.leftover < 150*100, p.leftover.toFixed(2));
  chk('KBANK ซื้อทีละ 100 หุ้น', by(p,'KBANK').tradeUnits % 100 === 0, by(p,'KBANK').tradeUnits);
  chk('ตัวที่เกินเป้า (VOO 51.7% vs 40%) ไม่ถูกซื้อ', by(p,'VOO').tradeTHB === 0, by(p,'VOO').tradeTHB);
  chk('share target รวม 100', near(p.rows.reduce((s,r)=>s+r.shareTarget,0), 100, 0.01));
}
console.log('\n═══ Withdraw ═══');
{
  const p = rebalancePlan(H, T, 40000, 'withdraw');
  chk('ขายอย่างเดียว', p.rows.every(r=>r.tradeTHB <= 0));
  chk('ได้เงินอย่างน้อยเท่าที่ถอน', p.totalSell >= 40000 - 0.01, p.totalSell.toFixed(2));
  chk('ขายตัวที่เกินเป้ามากสุด (VOO) ก่อน', by(p,'VOO').tradeTHB < 0);
  chk('ตัวที่ขาดเป้า (KBANK 21.6% vs 30%) ไม่ถูกขาย', by(p,'KBANK').tradeTHB === 0);
  chk('ขายไม่เกินจำนวนที่ถือ', p.rows.every(r => -r.tradeUnits <= r.qty + 1e-9));
  // ขายเกินได้ไม่เกินหน่วยใหญ่สุดหนึ่งหน่วย (หุ้นไทย 100 หุ้น) — ไม่ใช่ปัดขึ้นทุกตัวสะสม
  const H2 = [ {ticker:'KBANK', group:'Thai Stock', qty:5000, price:150, val:750000, cost:1},
               {ticker:'SCC',   group:'Thai Stock', qty:3000, price:230, val:690000, cost:1},
               {ticker:'VOO',   group:'US Stock',   qty:10,   price:18000, val:180000, cost:1} ];
  const w2 = rebalancePlan(H2, {KBANK:25, SCC:25, VOO:50}, 301234, 'withdraw');
  chk('ได้เงินเกินไม่ถึง 1 lot ที่ใหญ่สุด (ไม่ปัดเกินสะสมทุกตัว)', w2.totalSell >= 301234 && w2.leftover < 230*100,
      `ขาย ${w2.totalSell.toFixed(0)} เกิน ${w2.leftover.toFixed(0)} · ${w2.rows.map(r=>r.ticker+':'+r.tradeUnits).join(' ')}`);
}
console.log('\n═══ Rebalance ═══');
{
  const p = rebalancePlan(H, T, 0, 'rebalance');
  chk('มีทั้งซื้อและขาย', p.totalBuy > 0 && p.totalSell > 0);
  chk('หลังปรับเข้าใกล้เป้า (±2pp)', p.rows.every(r => near(r.shareAfter, r.shareTarget, 2)),
      p.rows.map(r=>r.ticker+':'+r.shareAfter.toFixed(1)+'/'+r.shareTarget.toFixed(1)).join(' '));
}
console.log('\n═══ ขอบเขต ═══');
{
  chk('ไม่มีเป้า → ว่าง ไม่ throw', rebalancePlan(H, {}, 1000, 'topup').rows.length === 0);
  chk('ไม่มีเป้า → ยังบอกมูลค่าทั้งพอร์ตรวม PVD', rebalancePlan(H, {}, 1000, 'topup').totalBefore === 450000);
  chk('holdings ว่าง', rebalancePlan([], T, 1000, 'topup').rows.length === 0);
  const d = defaultRebalTargets(H);
  chk('เป้าเริ่มต้นรวม ~100 และไม่มี PVD', near(Object.values(d).reduce((a,b)=>a+b,0), 100, 0.3) && !('PVD' in d), JSON.stringify(d));
  const lot = rebalancePlan(H, T, 50000, 'topup', {lots:{'Thai Stock':1}});
  const k1 = by(lot,'KBANK').tradeUnits, k100 = by(rebalancePlan(H, T, 50000, 'topup'),'KBANK').tradeUnits;
  chk('ตั้ง lot หุ้นไทย = 1 → ได้จำนวนเต็มและซื้อได้ละเอียดกว่า lot 100', Number.isInteger(k1) && k1 >= k100, `lot1=${k1} lot100=${k100}`);
  chk('lot 1 เงินเหลือน้อยกว่า lot 100', lot.leftover <= rebalancePlan(H, T, 50000, 'topup').leftover + 1e-6);
}
console.log(fail ? `\n❌ ไม่ผ่าน ${fail} ข้อ` : '\n✅ ผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
