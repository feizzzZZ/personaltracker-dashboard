/* v75 — autobot.js: กฎ · รอบ DCA · พัก · วงเงิน · เงินสด · ขาย · พอร์ตจำลอง
   รัน:  node scripts/test_autobot.cjs autobot.js                              */
const fs = require('fs');
let FAIL = 0;
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { FAIL++; console.log('  ✗ ' + n + '  ' + d); } };
new Function(fs.readFileSync(process.argv[2] || 'autobot.js', 'utf8'))();
const B = globalThis.AutoBot;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const BKK = (y, m, d, h = 10) => Date.UTC(y, m - 1, d, h - 7);          // เวลาไทย → epoch
const mk = (now, extra = {}) => Object.assign({ now, fx: { USD: 34, THB: 1 },
  prices: { BTC: { price: 60000, ccy: 'USD' }, PTT: { price: 32, ccy: 'THB' } },
  signals: { BTC: { rsi: 28, drawdown: -22 }, PTT: { rsi: 55, drawdown: -5 } } }, extra);
const rule = (o) => Object.assign({ id: 'r1', name: 'test', enabled: true, broker: 'binance', symbol: 'BTC', side: 'buy',
  trigger: { kind: 'rsi_below', value: 30 }, amountTHB: 1000, cooldownDays: 0, maxTotalTHB: '' }, o);

console.log('\n═══ validateRule ═══');
chk('กฎปกติผ่าน', B.validateRule(rule()) === '');
chk('ไม่มีชื่อ', B.validateRule(rule({ name: ' ' })) !== '');
chk('โบรกเกอร์แปลก', B.validateRule(rule({ broker: 'robinhood' })) !== '');
chk('สัญลักษณ์มีช่องว่าง', B.validateRule(rule({ symbol: 'BT C' })) !== '');
chk('เงินต่อครั้ง 0', B.validateRule(rule({ amountTHB: 0 })) !== '');
chk('วงเงินรวมน้อยกว่าต่อครั้ง', B.validateRule(rule({ maxTotalTHB: 500 })) !== '');
chk('DCA รายเดือนวันที่ 31 ไม่ได้', B.validateRule(rule({ trigger: { kind: 'schedule', every: 'month', day: 31 } })) !== '');
chk('DCA รายสัปดาห์วัน 8 ไม่ได้', B.validateRule(rule({ trigger: { kind: 'schedule', every: 'week', day: 8 } })) !== '');
chk('RSI 150 ไม่ได้', B.validateRule(rule({ trigger: { kind: 'rsi_below', value: 150 } })) !== '');

console.log('\n═══ เงื่อนไข ═══');
let s = B.newState(10000);
chk('RSI 28 ≤ 30 → ยิง', B.evaluate([rule()], s, mk(BKK(2026, 10, 22))).orders.length === 1);
chk('RSI 28 ≥ 70 → ไม่ยิง', B.evaluate([rule({ trigger: { kind: 'rsi_above', value: 70 } })], s, mk(BKK(2026, 10, 22))).orders.length === 0);
chk('ต่ำกว่าจุดสูงสุด 22% ≥ 20% → ยิง', B.evaluate([rule({ trigger: { kind: 'drop_from_high', pct: 20 } })], s, mk(BKK(2026, 10, 22))).orders.length === 1);
chk('ต่ำกว่าจุดสูงสุด 22% < 25% → ไม่ยิง', B.evaluate([rule({ trigger: { kind: 'drop_from_high', pct: 25 } })], s, mk(BKK(2026, 10, 22))).orders.length === 0);
chk('ราคา 32 ≤ 33 → ยิง', B.evaluate([rule({ symbol: 'PTT', broker: 'settrade', trigger: { kind: 'price_below', value: 33 } })], s, mk(BKK(2026, 10, 22))).orders.length === 1);
chk('ราคา 32 ≥ 33 → ไม่ยิง', B.evaluate([rule({ symbol: 'PTT', trigger: { kind: 'price_above', value: 33 } })], s, mk(BKK(2026, 10, 22))).orders.length === 0);
chk('ปิดกฎ → ไม่ยิง', B.evaluate([rule({ enabled: false })], s, mk(BKK(2026, 10, 22))).orders.length === 0);
chk('ไม่มีราคา → ไม่ยิง + บอกเหตุผล', (() => { const e = B.evaluate([rule({ symbol: 'XYZ' })], s, mk(BKK(2026, 10, 22))); return !e.orders.length && /RSI|ราคา/.test(e.skipped[0].why); })());

console.log('\n═══ ตัวเลขคำสั่ง (ซื้อ) ═══');
const o = B.evaluate([rule()], s, mk(BKK(2026, 10, 22))).orders[0];
chk('จำนวน = 1000×(1−0.1%) ÷ (60000×34)', near(o.qty, 1000 * 0.999 / (60000 * 34), 1e-12));
chk('ค่าธรรมเนียม ฿1', near(o.feeTHB, 1));
chk('โหมด paper', o.mode === 'paper');
const s1 = B.applyPaper(s, [o]);
chk('เงินสดลด ฿1,000', near(s1.cash, 9000));
chk('ต้นทุนรวมค่าธรรมเนียม', near(s1.positions.BTC.costTHB, 1000));
chk('state เดิมไม่ถูกแก้', s.cash === 10000 && !s.positions.BTC);
const v = B.valuate(s1, mk(BKK(2026, 10, 22)));
chk('มูลค่ารวม = 9000 + 999 (เสียค่าธรรมเนียม)', near(v.equity, 9999, 1e-6) && near(v.pnlTHB, -1, 1e-6));

console.log('\n═══ ระยะพัก · วงเงิน · เงินสด ═══');
const r2 = rule({ cooldownDays: 3 });
let st = B.runPaper([r2], B.newState(10000), mk(BKK(2026, 10, 22))).state;
chk('พัก 3 วัน: วันถัดไปไม่ยิง', B.evaluate([r2], st, mk(BKK(2026, 10, 23))).orders.length === 0);
chk('พัก 3 วัน: ครบ 3 วันยิงได้', B.evaluate([r2], st, mk(BKK(2026, 10, 25))).orders.length === 1);
const r3 = rule({ maxTotalTHB: 2500 });
st = B.newState(10000);
for (let d = 1; d <= 5; d++) st = B.runPaper([r3], st, mk(BKK(2026, 10, d))).state;
chk('วงเงินรวม ฿2,500 → ซื้อได้ 2 ครั้ง', st.ledger.length === 2 && near(st.spent.r1, 2000));
st = B.newState(1500);
const two = B.evaluate([rule({ id: 'a' }), rule({ id: 'b' })], st, mk(BKK(2026, 10, 22)));
chk('เงินสด ฿1,500 กฎซื้อ 2 กฎ ฿1,000 → ซื้อได้กฎเดียว', two.orders.length === 1 && /เงินสด/.test(two.skipped[0].why));

console.log('\n═══ ขาย ═══');
st = B.runPaper([rule({ amountTHB: 5000 })], B.newState(10000), mk(BKK(2026, 10, 22))).state;
const sell = rule({ id: 's', side: 'sell', amountTHB: 100000, trigger: { kind: 'rsi_below', value: 30 } });
const so = B.evaluate([sell], st, mk(BKK(2026, 10, 23))).orders[0];
chk('ขายเกินที่ถือ → ขายเท่าที่มี', near(so.qty, st.positions.BTC.qty, 1e-15));
const st2 = B.applyPaper(st, [so]);
chk('ขายหมดแล้วไม่เหลือตำแหน่ง', !st2.positions.BTC);
chk('เงินสดกลับมาหักค่าธรรมเนียมสองขา', near(st2.cash, 5000 + 4995 * 0.999, 1e-6), String(st2.cash));
chk('ไม่มีของ → ขายไม่ได้', B.evaluate([sell], B.newState(1000), mk(BKK(2026, 10, 23))).orders.length === 0);
const half = B.applyPaper(st, [B.evaluate([rule({ id: 's2', side: 'sell', amountTHB: 2000 })], st, mk(BKK(2026, 10, 23))).orders[0]]);
chk('ขายบางส่วน: ต้นทุนลดตามสัดส่วน', near(half.positions.BTC.costTHB, 5000 * (1 - 2000 / 4995), 1e-6), String(half.positions.BTC.costTHB));

console.log('\n═══ DCA ตามรอบ (เวลาไทย) ═══');
const dcaM = rule({ trigger: { kind: 'schedule', every: 'month', day: 5 } });
st = B.newState(100000);
chk('ก่อนวันที่ 5 ไม่ยิง', B.evaluate([dcaM], st, mk(BKK(2026, 10, 4, 23))).orders.length === 0);
st = B.runPaper([dcaM], st, mk(BKK(2026, 10, 5, 0))).state;
chk('วันที่ 5 (00:xx เวลาไทย) ยิง', st.ledger.length === 1);
st = B.runPaper([dcaM], st, mk(BKK(2026, 10, 20))).state;
chk('เดือนเดียวกันไม่ยิงซ้ำ', st.ledger.length === 1);
st = B.runPaper([dcaM], st, mk(BKK(2026, 11, 9))).state;
chk('เดือนถัดไป (เลยวันที่ 5 แล้ว) ยิงตามหลัง', st.ledger.length === 2);
const dcaW = rule({ trigger: { kind: 'schedule', every: 'week', day: 1 } });   // จันทร์
st = B.newState(100000);
st = B.runPaper([dcaW], st, mk(BKK(2026, 10, 19))).state;   // จันทร์ 19 ต.ค. 2026
st = B.runPaper([dcaW], st, mk(BKK(2026, 10, 25))).state;   // อาทิตย์ สัปดาห์เดียวกัน
chk('รายสัปดาห์: สัปดาห์เดียวกันยิงครั้งเดียว', st.ledger.length === 1);
st = B.runPaper([dcaW], st, mk(BKK(2026, 10, 26))).state;   // จันทร์ถัดไป
chk('รายสัปดาห์: จันทร์ถัดไปยิงอีก', st.ledger.length === 2);
chk('รอบรายเดือนใช้เวลาไทย (31 ต.ค. 20:00 UTC = 1 พ.ย. ไทย)', B.periodKey({ every: 'month' }, Date.UTC(2026, 9, 31, 20)) === '2026-11');

console.log(FAIL ? `\n✗ ไม่ผ่าน ${FAIL} ข้อ` : '\n✓ ผ่านทั้งหมด');
process.exit(FAIL ? 1 : 0);
