/* v81 — หน้า Transactions (ประเภทที่มีจริง · ค้นหา) + การ์ด IRR หน้า Holdings
   รัน:  node tests/test_invest_tx.cjs js/shared.js                           */
const fs = require('fs');
let FAIL = 0;
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { FAIL++; console.log('  ✗ ' + n + '  ' + d); } };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.window = {}; global.document = { getElementById: () => null, querySelector: () => null };
const src = fs.readFileSync(process.argv[2] || 'js/shared.js', 'utf8');
const { investTxTypes, filterInvestTx, irrSummary, holdingPerf, xirrJS, perfQuote } =
  new Function(src + '; return {investTxTypes, filterInvestTx, irrSummary, holdingPerf, xirrJS, perfQuote};')();
const DAY = 86400e3, YR = 365 * DAY, now = Date.UTC(2026, 9, 29);
const near = (a, b, tol = 1e-9) => a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// แถวแบบ tracker ของแอป (gsParseAssetTracker) — ข้อมูลจากภาพของผู้ใช้
const d = s => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };
const R = [
  { date: d('2025-08-27'), txType: 'Buy', ticker: 'GOOGL', platform: 'Dime', group: 'US Stock', assetTypeRaw: 'US Stock', commTHB: 0 },
  { date: d('2025-08-27'), txType: 'Buy', ticker: 'COKE', platform: 'Dime', group: 'US Stock', assetTypeRaw: 'US Stock', commTHB: 0 },
  { date: d('2025-08-27'), txType: 'Buy', ticker: 'PF4103', platform: 'KTAM', group: 'Provident Fund', assetTypeRaw: 'Provident Fund', commTHB: 0 },
  { date: d('2025-08-15'), txType: 'Dividend Payout', ticker: 'AAPL', platform: 'Dime', group: 'US Stock', assetTypeRaw: 'US Stock' },
  { date: d('2025-08-08'), txType: 'Dividend Payout', ticker: 'COKE', platform: 'Dime', group: 'US Stock', assetTypeRaw: 'US Stock' },
  { date: d('2025-07-22'), txType: 'Sell', ticker: 'BTC', platform: 'Binance', group: 'Crypto', assetTypeRaw: 'Crypto', commTHB: 12.5 },
  { date: d('2025-07-01'), txType: 'Recieved', ticker: 'BNB', platform: 'Binance', group: 'Crypto', assetTypeRaw: 'Crypto' },
];

console.log('\n═══ investTxTypes — ประเภทที่มีจริงในชีต ═══');
const T = investTxTypes(R);
chk('มาจากข้อมูลจริง (ไม่มีประเภทที่ไม่มีในชีต)', T.map(t => t.type).join('|') === 'Buy|Dividend Payout|Recieved|Sell', JSON.stringify(T));
chk('นับจำนวนถูก · เรียงมาก → น้อย', T[0].n === 3 && T[1].n === 2 && T[2].n === 1);
chk('ค่าว่าง/ช่องว่างไม่ถูกนับเป็นประเภท', investTxTypes([{ txType: '' }, { txType: '  ' }, {}]).length === 0);
chk('ไม่มีข้อมูล → []', investTxTypes(null).length === 0);

console.log('\n═══ filterInvestTx — กรอง + ค้นหา ═══');
chk('ไม่กรอง → ครบ', filterInvestTx(R, '', '').length === R.length);
chk('ประเภท Buy → 3', filterInvestTx(R, '', 'Buy').length === 3);
chk('ประเภท Dividend Payout → 2', filterInvestTx(R, '', 'Dividend Payout').length === 2);
chk('ค้นหา ticker (ตัวเล็ก) "coke" → 2 (ซื้อ + ปันผล)', filterInvestTx(R, 'coke', '').length === 2);
chk('ค้นหา + ประเภท: "coke" + Buy → 1', filterInvestTx(R, 'coke', 'Buy').length === 1);
chk('ค้นหาตามแพลตฟอร์ม "binance" → 2', filterInvestTx(R, 'binance', '').length === 2);
chk('ค้นหาตามวันที่ YYYY-MM-DD "2025-08-27" → 3', filterInvestTx(R, '2025-08-27', '').length === 3);
chk('ค้นหาตามเดือน "2025-08" → 5', filterInvestTx(R, '2025-08', '').length === 5);
chk('หลายคำ = ต้องเจอทุกคำ: "dime 2025-08-27" → 2', filterInvestTx(R, 'dime 2025-08-27', '').length === 2);
chk('ค้นหาตามกลุ่ม "provident" → PF4103', filterInvestTx(R, 'provident', '').map(r => r.ticker).join() === 'PF4103');
chk('ไม่เจอ → []', filterInvestTx(R, 'zzz', '').length === 0);
chk('ไม่แก้แถวต้นฉบับ (คืน array ใหม่)', filterInvestTx(R, '', '') !== R && R.length === 7);

console.log('\n═══ irrSummary — การ์ด IRR หน้า Holdings ═══');
// A: ซื้อ 100k เมื่อ 2 ปีก่อน ตอนนี้ 121k (ยังถือ) · B: ซื้อ 50k 2 ปีก่อน ขายหมด 1 ปีก่อน ได้ 40k (ขาดทุน)
const byTk = {
  A: [{ t: now - 2 * YR, v: -100000 }],
  B: [{ t: now - 2 * YR, v: -50000 }, { t: now - YR, v: 40000 }],
};
const hold = [{ ticker: 'A', val: 121000 }];
const S = irrSummary(byTk, hold, now);
chk('เฉพาะที่ถือ (A): 100k → 121k ใน 2 ปี = 10%/ปี', near(S.cur.annual, 0.10, 1e-4), String(S.cur.annual));
const allX = xirrJS([{ t: now - 2 * YR, v: -150000 }, { t: now - YR, v: 40000 }, { t: now, v: 121000 }]);
chk('ทั้งพอร์ตรวมตัวที่ขายหมดแล้ว (B ขาดทุน) = XIRR ของทุก flow', near(S.all.annual, allX, 1e-9) && S.all.annual < S.cur.annual,
    `${S.all.annual} vs ${allX}`);
chk('ทั้งพอร์ตใช้มูลค่าทุกตัวที่ถือ · เงินใส่ 150k ได้คืน 40k', S.all.ins === 150000 && S.all.outs === 40000);
// ถือไม่ถึง 1 ปี → ไม่ annualize (กฎ v74)
const Y = irrSummary({ C: [{ t: now - 120 * DAY, v: -10000 }] }, [{ ticker: 'C', val: 10800 }], now);
chk('ถือ 120 วัน → ไม่มี %/ปี · ผลสะสม +8%', Y.all.annual === null && near(Y.all.simple, 0.08) && Y.cur.days === 120);
chk('perfQuote ของช่วงสั้นบอกว่า "ใน …" ไม่ใช่ "/ปี"', !/\/ปี|\/yr/.test(perfQuote(Y.all)) && /\+8\.0%/.test(perfQuote(Y.all)), perfQuote(Y.all));
chk('perfQuote ของ ≥ 1 ปี เป็น "/ปี"', /\+10\.0%\/ปี/.test(perfQuote(S.cur)), perfQuote(S.cur));
// ตัวที่ถือแต่ไม่มี flow (เช่น ได้มาจากการโอน) ไม่เข้า "เฉพาะที่ถือ" แต่มูลค่ายังนับใน "ทั้งพอร์ต" (เหมือนการ์ดเดิมของหน้าผลตอบแทนจริง)
const Z = irrSummary({ A: byTk.A }, [{ ticker: 'A', val: 121000 }, { ticker: 'AIR', val: 5000 }], now);
chk('ตัวไม่มี flow: นับมูลค่าในทั้งพอร์ต ไม่นับใน "เฉพาะที่ถือ"', near(Z.cur.annual, 0.10, 1e-4) && Z.all.annual > Z.cur.annual);
chk('ไม่มีธุรกรรม → null ทั้งคู่', (() => { const n = irrSummary({}, hold, now); return n.all === null && n.cur === null; })());
chk('ขายหมดทุกตัว → ทั้งพอร์ตยังคิดได้ · เฉพาะที่ถือ = null', (() => { const n = irrSummary({ B: byTk.B }, [], now); return n.all !== null && n.cur === null; })());
chk('ตัวที่มูลค่า 0 (ไม่มีราคา) ไม่ถูกนับเป็น "ที่ถือ"', irrSummary(byTk, [{ ticker: 'A', val: 0 }], now).cur === null);

console.log(FAIL ? `\n✗ ไม่ผ่าน ${FAIL} ข้อ` : '\n✓ ผ่านทั้งหมด');
process.exit(FAIL ? 1 : 0);
