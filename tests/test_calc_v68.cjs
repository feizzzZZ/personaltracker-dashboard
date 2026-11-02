/* ทดสอบการแก้ตัวเลขรอบ v68 (ฟังก์ชันใน shared.js)
 *
 *   node tests/test_calc_v68.cjs shared.js
 *
 * ทุกกรณีคิดมือไว้ก่อน แล้วเทียบกับผลจริง — กรณีแรกของแต่ละหัวข้อคือบั๊กที่เจอจริงรอบตรวจ
 */
const fs = require('fs');
const store = {};
global.window = {};
global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
eval(fs.readFileSync(process.argv[2] || 'js/shared.js', 'utf8'));

let FAIL = 0;
const chk = (name, cond, detail) => { console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : '  ' + JSON.stringify(detail)}`); if (!cond) FAIL++; };
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const d = s => new Date(s + 'T00:00:00');
const COST = new Set(['Buy', 'Split']), SELL = ['Sell'];

console.log('\n═══ #1 ต้นทุนของที่ถืออยู่ = running WACC ═══');
{
  // ซื้อ 10@100 → ขาย 5 ได้ 600 → ซื้อ 5@200 · ราคาตอนนี้ 150
  const rows = [
    { ticker: 'X', txType: 'Buy', qty: 10, trueCost: 1000, amtTHB: -1000, date: d('2026-01-01') },
    { ticker: 'X', txType: 'Sell', qty: 5, amtTHB: 600, date: d('2026-02-01') },
    { ticker: 'X', txType: 'Buy', qty: 5, trueCost: 1000, amtTHB: -1000, date: d('2026-03-01') },
  ];
  const r = runningCostBasis(rows, COST, SELL);
  const h = r.holdings.X;
  chk('ต้นทุนเฉลี่ย 150 (เดิม 133.33)', near(h.wacc, 150), h);
  chk('ต้นทุนที่ถือ 1,500', near(h.cost, 1500), h);
  chk('Realized +100', near(r.realized[0].pnl, 100), r.realized[0]);
  const unreal = 10 * 150 - h.wacc * 10;
  chk('Realized + Unrealized = เงินได้จริง (2,100 − 2,000 = +100)', near(r.realized[0].pnl + unreal, 100));
  chk('ชื่อเดิม computeRunningWaccRealized ยังให้ผลเดียวกัน',
    near(computeRunningWaccRealized(rows, COST, SELL)[0].pnl, 100));
}
{
  // ไม่เคยขาย → เท่ากับเฉลี่ยยอดซื้อแบบเดิม (ไม่เปลี่ยนพฤติกรรมของพอร์ตส่วนใหญ่)
  const rows = [
    { ticker: 'Y', txType: 'Buy', qty: 2, trueCost: 200, date: d('2026-01-01') },
    { ticker: 'Y', txType: 'Buy', qty: 3, trueCost: 600, date: d('2026-02-01') },
  ];
  chk('ไม่เคยขาย = เฉลี่ยยอดซื้อ (160)', near(runningCostBasis(rows, COST, SELL).holdings.Y.wacc, 160));
}
{
  // ขายหมดแล้วซื้อใหม่ → ต้นทุนเริ่มใหม่ ไม่ปนรอบก่อน
  const rows = [
    { ticker: 'Z', txType: 'Buy', qty: 1, trueCost: 50, date: d('2026-01-01') },
    { ticker: 'Z', txType: 'Sell', qty: 1, amtTHB: 80, date: d('2026-02-01') },
    { ticker: 'Z', txType: 'Buy', qty: 1, trueCost: 120, date: d('2026-03-01') },
  ];
  chk('ขายหมดแล้วซื้อใหม่ = ต้นทุนรอบใหม่ (120)', near(runningCostBasis(rows, COST, SELL).holdings.Z.wacc, 120));
}

console.log('\n═══ #19 Stake / โอนระหว่างกระเป๋า / Used ═══');
{
  const rows = [
    { ticker: 'ETH', txType: 'Buy', qty: 10, trueCost: 1000, date: d('2026-01-01') },
    { ticker: 'ETH', txType: 'Stake', qty: 1, date: d('2026-02-01') },
  ];
  const h = runningCostBasis(rows, COST, SELL).holdings.ETH;
  chk('Stake = หน่วยต้นทุน 0 → ต้นทุนรวมยัง 1,000 (เดิม 1,100)', near(h.cost, 1000) && near(h.qty, 11), h);
}
{
  const rows = [
    { ticker: 'BTC', txType: 'Buy', qty: 2, trueCost: 2000, date: d('2026-01-01') },
    { ticker: 'BTC', txType: 'Send', qty: 2, date: d('2026-01-05') },
    { ticker: 'BTC', txType: 'Recieved', qty: 2, date: d('2026-01-05') },
  ];
  const h = runningCostBasis(rows, COST, SELL).holdings.BTC;
  chk('Send+Recieved คู่กัน (ย้ายกระเป๋า) ไม่กระทบต้นทุน', near(h.cost, 2000) && near(h.wacc, 1000), h);
}
{
  const rows = [
    { ticker: 'SOL', txType: 'Buy', qty: 4, trueCost: 400, date: d('2026-01-01') },
    { ticker: 'SOL', txType: 'Used', qty: 1, date: d('2026-01-02') },
  ];
  const r = runningCostBasis(rows, COST, SELL);
  chk('Used หักต้นทุนตามสัดส่วน ไม่นับเป็นการขาย', near(r.holdings.SOL.cost, 300) && r.realized.length === 0, r);
}

console.log('\n═══ #9 ค่าธรรมเนียมฝั่งขาย ═══');
// ขาย 10 หน่วย @100 ค่าธรรมเนียม 15
chk('ยอดในชีตเป็นยอดก่อนหัก (1,000) → หัก 15', sellFeeToDeduct(1000, 10, 100, 1, 15) === 15);
chk('ยอดในชีตหักแล้ว (985) → ไม่หักซ้ำ', sellFeeToDeduct(985, 10, 100, 1, 15) === 0);
chk('ไม่มีค่าธรรมเนียม → 0', sellFeeToDeduct(1000, 10, 100, 1, 0) === 0);
{
  const rows = [
    { ticker: 'A', txType: 'Buy', qty: 10, trueCost: 900, date: d('2026-01-01') },
    { ticker: 'A', txType: 'Sell', qty: 10, amtTHB: 1000, netProceeds: 985, sellFee: 15, date: d('2026-02-01') },
  ];
  const x = runningCostBasis(rows, COST, SELL).realized[0];
  chk('Realized ใช้ยอดขายสุทธิ (985 − 900 = 85)', near(x.pnl, 85) && x.fee === 15, x);
}

console.log('\n═══ #2 Reconcile นับรายการหลังวันที่จด ═══');
{
  const recDate = '2026-10-01';
  // ยอดคำนวณวันนี้ 40,000 = ยอด ณ 1 ต.ค. 50,000 − จ่าย 10,000 วันที่ 5 ต.ค.
  const bals = [{ name: 'SCB', balance: 40000, type: 'Account #' }];
  const rows = [
    { dateStr: '2026-10-01', acct: { SCB: -300 } },          // วันเดียวกับที่จด → รวมในยอดจริงแล้ว
    { dateStr: '2026-10-05', acct: { SCB: -10000 } },
  ];
  // ยอดจริงที่จด = ยอดคำนวณ ณ สิ้นวันที่ 1 = 50,000 (ไม่มีส่วนต่าง)
  const rec = { SCB: { date: recDate, actual: 50000 } };
  const now = Date.now; Date.now = () => Date.parse('2026-10-08T05:00:00Z');
  const eff = applyReconciliation(bals, rec, null, rows).bals[0];
  const cr = computeReconciliation(bals, rec, null, rows).accounts[0];
  Date.now = now;
  chk('ยอดที่ใช้ = 50,000 − 10,000 = 40,000 (เดิมค้างที่ 50,000)', near(eff.balance, 40000), eff);
  chk('ไม่มีผลต่างที่ "ยอมรับ" เข้ามา', near(eff.reconDiff, 0), eff);
  chk('หน้าเทียบยอด: ต่าง 0 (เดิมฟ้อง ฿10,000)', near(cr.diff, 0) && cr.ok, cr);
  chk('บอกยอดคำนวณ ณ วันที่จด + ยอดหลังจากนั้น', near(cr.computed, 50000) && near(cr.after, -10000), cr);
  // ผลต่างจริง (ลืมกรอกรายจ่าย 200 ก่อนวันจด) ยังจับได้
  const cr2 = computeReconciliation(bals, { SCB: { date: recDate, actual: 49800 } }, null, rows).accounts[0];
  chk('ผลต่างจริงยังจับได้ (−200)', near(cr2.diff, -200) && !cr2.ok, cr2);
  // ไม่ส่ง rows (ผู้เรียกเก่า) = พฤติกรรมเดิม ไม่พัง
  chk('ไม่ส่ง rows → ทำงานแบบเดิม', near(applyReconciliation(bals, rec).bals[0].balance, 50000));
}

console.log('\n═══ v84 Reconcile: รายการวันเดียวกันที่กรอกหลังจดยอด (บั๊ก SCB 2026-11-02) ═══');
{
  // ผู้ใช้จดยอด SCB จากแอปธนาคารตอนเช้า 1 พ.ย. = 17,734.53 แล้วกรอกรายจ่ายวันนั้นผ่านเว็บแอป รวม 2,000
  // ชีต (Current Balance) = 15,734.53 · เดิมแอปโชว์ 17,734.53 (≈ ฿17,735) เพราะถือว่ายอดจริง = สิ้นวัน
  const day = [-30, -69, -12, -40, -900, -60, -170, -719];
  const rows = [{ dateStr: '2026-10-30', acct: { SCB: -500 }, sheetRow: 4710 }]
    .concat(day.map((v, i) => ({ dateStr: '2026-11-01', acct: { SCB: v }, sheetRow: 4718 + i })));
  const bals = [{ name: 'SCB', balance: 15734.53, type: 'Account #' }, { name: 'KBank', balance: 4221.47, type: 'Account #' }];
  const rec = { SCB: { date: '2026-11-01', actual: 17734.53 }, KBank: { date: '2026-11-01', actual: 4221.47 } };
  const now = Date.now; Date.now = () => Date.parse('2026-11-02T05:00:00Z');
  const ap = applyReconciliation(bals, rec, null, rows);
  const cr = computeReconciliation(bals, rec, null, rows);
  const eff = ap.bals[0], c = cr.accounts[0];
  chk('ยอดในแอป = ชีต 15,734.53 (เดิม 17,734.53)', near(eff.balance, 15734.53), eff);
  chk('ไม่มีผลต่างที่ "ยอมรับ" เข้ามา', near(eff.reconDiff, 0) && near(ap.adopted, 0), eff);
  chk('ตารางเทียบยอด: ตรง · นับ 8 รายการวันเดียวกันเป็นหลังจดยอด', c.ok && near(c.diff, 0) && c.sameDayN === 8 && near(c.after, -2000), c);
  chk('บัญชีที่ไม่มีรายการวันนั้นไม่เปลี่ยน', near(ap.bals[1].balance, 4221.47) && cr.accounts[1].sameDayN === 0, ap.bals[1]);

  // จดยอดหลังกรอกไปแล้ว 3 แถวแรกของวัน → แถวที่เหลือ 5 แถวเป็น "หลังจดยอด"
  const rec3 = { SCB: { date: '2026-11-01', actual: 17734.53 - 30 - 69 - 12 } };
  const c3 = computeReconciliation(bals, rec3, null, rows).accounts[0];
  chk('จดยอดกลางวัน → 5 แถวท้ายเป็นหลังจดยอด', c3.ok && c3.sameDayN === 5, c3);
  chk('ยอดในแอปยังเท่าชีต', near(applyReconciliation(bals, rec3, null, rows).bals[0].balance, 15734.53));

  // ลำดับ = เลขแถวในชีต ไม่ใช่ลำดับใน array
  const c4 = computeReconciliation(bals, rec3, null, rows.slice().reverse()).accounts[0];
  chk('ใช้ลำดับแถวในชีต (array กลับด้านก็ได้ผลเดิม)', c4.ok && c4.sameDayN === 5, c4);

  // จดยอดสิ้นวัน (ตรงกับยอดคำนวณสิ้นวัน) → เหมือนเดิมทุกอย่าง
  const recE = { SCB: { date: '2026-11-01', actual: 15734.53 } };
  const cE = computeReconciliation(bals, recE, null, rows).accounts[0];
  chk('ยอดสิ้นวันตรง → ไม่ย้ายรายการ', cE.ok && cE.sameDayN === 0 && near(cE.after, 0), cE);

  // ผลต่างจริง (ไม่ตรงกับจุดไหนของวันเลย) ยังฟ้องเท่าเดิม และยอดที่ใช้ = ยอดจริงแบบสิ้นวัน
  const recX = { SCB: { date: '2026-11-01', actual: 16234.53 } };
  const cX = computeReconciliation(bals, recX, null, rows).accounts[0];
  chk('ผลต่างจริง +500 ยังฟ้อง', !cX.ok && near(cX.diff, 500) && cX.sameDayN === 0, cX);
  chk('ยอดที่ใช้ = ยอดจริง (16,234.53)', near(applyReconciliation(bals, recX, null, rows).bals[0].balance, 16234.53));

  // มีรายการวันถัดไปด้วย: จดเช้า 1 พ.ย. · 1 พ.ย. −1,000 · 2 พ.ย. −200 → ยอดวันนี้ 8,800
  const rowsN = [{ dateStr: '2026-11-01', acct: { SCB: -1000 }, sheetRow: 30 }, { dateStr: '2026-11-02', acct: { SCB: -200 }, sheetRow: 31 }];
  const balsN = [{ name: 'SCB', balance: 8800, type: 'Account #' }];
  const recN = { SCB: { date: '2026-11-01', actual: 10000 } };
  const eN = applyReconciliation(balsN, recN, null, rowsN).bals[0];
  chk('รายการวันถัดไปยังนับ + วันเดียวกันที่กรอกหลังจด → 8,800', near(eN.balance, 8800) && eN.reconSameDayN === 1, eN);
  Date.now = now;
}

console.log('\n═══ #7 งบ: เงินคืนหักออกจากหมวด ═══');
{
  const b = budgetSpendMap([
    { type: 'Expense', category: 'Food', amount: -2000, acct: {} },
    { type: 'Expense', category: 'Food', amount: 500, acct: {} },
    { type: 'Expense', category: 'Gift', amount: 300, acct: {} },   // คืนอย่างเดียว
  ], []);
  chk('จ่าย 2,000 คืน 500 → ใช้ไป 1,500 (เดิม 2,500)', b.map.Food === 1500, b.map);
  chk('หมวดที่มีแต่เงินคืน → 0 ไม่ติดลบ', b.map.Gift === 0, b.map);
}

console.log('─────────────────────────────────────────────');
if (FAIL) { console.log(`❌ ไม่ผ่าน ${FAIL} ข้อ`); process.exit(1); }
console.log('✅ ผ่านทั้งหมด');
