/* v74 — True Performance: เทียบฝากธนาคาร · ผลรายตัว · ไม่ annualize ช่วงสั้น
   รัน:  node scripts/test_perf.cjs shared.js                                  */
const fs = require('fs');
let FAIL = 0;
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { FAIL++; console.log('  ✗ ' + n + '  ' + d); } };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.window = {}; global.document = { getElementById: () => null, querySelector: () => null };
const src = fs.readFileSync(process.argv[2] || 'shared.js', 'utf8');
const { flowsFutureValue, holdingPerf, twrView, xirrJS, DEPOSIT_RATE_DEFAULT, analystPortfolio, perfQuote } =
  new Function(src + '; return {flowsFutureValue, holdingPerf, twrView, xirrJS, DEPOSIT_RATE_DEFAULT, analystPortfolio, perfQuote};')();
const DAY = 86400e3, YR = 365 * DAY, now = Date.UTC(2026, 9, 22);
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

console.log('\n═══ flowsFutureValue ═══');
chk('ใส่ 100,000 เมื่อ 1 ปีก่อน ที่ 1.5% → 101,500', near(flowsFutureValue([{t: now - YR, v: -100000}], now, 0.015), 101500));
chk('ใส่ 100,000 วันนี้ → 100,000', near(flowsFutureValue([{t: now, v: -100000}], now, 0.015), 100000));
chk('ใส่ 100k 2 ปีก่อน ถอน 50k 1 ปีก่อน (2%) → 104,040 − 51,000',
    near(flowsFutureValue([{t: now - 2 * YR, v: -100000}, {t: now - YR, v: 50000}], now, 0.02), 104040 - 51000));
chk('rate 0 = เงินสุทธิที่ใส่', near(flowsFutureValue([{t: now - YR, v: -300}, {t: now - 10 * DAY, v: 100}], now, 0), 200));
chk('ไม่มี flow → 0', flowsFutureValue([], now, 0.015) === 0);
// ความสอดคล้องกับ XIRR: ฝากที่อัตรา = XIRR ต้องได้มูลค่าเท่าพอร์ตพอดี
const fl = [{t: now - 2 * YR, v: -50000}, {t: now - 400 * DAY, v: -30000}, {t: now - 90 * DAY, v: 5000}];
const r = xirrJS([...fl, {t: now, v: 96000}]);
chk('ฝากที่อัตรา = XIRR → เท่ามูลค่าพอร์ต', near(flowsFutureValue(fl, now, r), 96000, 1), String(flowsFutureValue(fl, now, r)));

console.log('\n═══ holdingPerf ═══');
const short = holdingPerf([{t: now - 90 * DAY, v: -10000}], 11200, now, 0.015);
chk('ถือ 90 วัน → ไม่มี %/ปี', short.annual === null && short.days === 90);
chk('ถือ 90 วัน → ผลสะสม +12%', near(short.simple, 0.12, 1e-9));
chk('กำไร ฿1,200', near(short.gain, 1200));
chk('เทียบฝาก: 11,200 − 10,000×1.015^(90/365)', near(short.vsDeposit, 11200 - 10000 * Math.pow(1.015, 90 / 365)));
const long = holdingPerf([{t: now - 2 * YR, v: -10000}, {t: now - YR, v: 300}], 11000, now, 0.015);
chk('ถือ 2 ปี → มี %/ปี (XIRR)', long.annual !== null && long.annual > 0.05 && long.annual < 0.08, String(long.annual));
chk('รวมเงินที่ได้คืนในกำไร', near(long.gain, 1300) && near(long.outs, 300));
const loser = holdingPerf([{t: now - 400 * DAY, v: -20000}], 19800, now, 0.015);
chk('ขาดทุน → แพ้ฝากธนาคาร (vsDeposit < 0)', loser.vsDeposit < -500 && loser.gain < 0);
const meh = holdingPerf([{t: now - 2 * YR, v: -10000}], 10150, now, 0.015);
chk('กำไรน้อยกว่าดอกเบี้ย → ยังนับว่าแพ้ฝาก', meh.gain > 0 && meh.vsDeposit < 0);
chk('ค่าเริ่มต้น rate = 1.5%', DEPOSIT_RATE_DEFAULT === 0.015 && near(holdingPerf(fl, 96000, now).vsDeposit, holdingPerf(fl, 96000, now, 0.015).vsDeposit, 1e-9));

console.log('\n═══ twrView ═══');
chk('60 วัน → ผลสะสม ไม่ annualize', twrView({total: 0.228, annual: 2.48, days: 60}).kind === 'total' && twrView({total: 0.228, annual: 2.48, days: 60}).v === 0.228);
chk('364 วัน → ยังเป็นผลสะสม', twrView({total: 0.1, annual: 0.1003, days: 364}).kind === 'total');
chk('400 วัน → %/ปี', twrView({total: 0.2, annual: 0.181, days: 400}).kind === 'annual' && twrView({total: 0.2, annual: 0.181, days: 400}).v === 0.181);
chk('null → null', twrView(null) === null);

console.log('\n═══ Analyst — ตัวถ่วงรายตัว (v74 รอบ 2) ═══');
// ไม่ annualize ตัวที่ถือ < 1 ปี: ถือ 120 วันลง 12% เดิมโชว์ ≈ −32%/ปี
const mkA = (tk, flows, val) => ({tk, val, ...holdingPerf(flows, val, now, 0.015)});
const pa = [
  mkA('SHORT', [{t: now - 120 * DAY, v: -100000}], 88000),        // ถือ 4 เดือน −12%
  mkA('OLD',   [{t: now - 2 * YR,   v: -100000}], 90000),         // ถือ 2 ปี −10%
  mkA('NEW',   [{t: now - 20 * DAY, v: -100000}], 80000),         // ถือ 20 วัน → ยังไม่ตัดสิน
  mkA('WIN',   [{t: now - 90 * DAY, v: -100000}], 112000),        // ขึ้น 12% ใน 90 วัน
];
const cA = {assets: pa.map(a => ({ticker: a.tk, val: a.val})), perAsset: pa, totalVal: pa.reduce((s, a) => s + a.val, 0)};
const rep = analystPortfolio(cA);
const drag = rep.findings.find(f => /ตัวถ่วง/.test(f.t));
chk('มี finding ตัวถ่วง', !!drag);
chk('หนักสุดเรียงตามบาทที่แพ้ฝาก (SHORT ไม่ใช่ OLD เพราะ OLD แพ้ฝากมากกว่า)', drag && /หนักสุด OLD/.test(drag.t), drag && drag.t);
chk('OLD ถือ 2 ปี → แสดง %/ปี', drag && /\/ปี/.test(drag.t));
chk('NEW ถือ 20 วัน → ไม่ถูกนับ', drag && !/NEW/.test(drag.d) && /^2 /.test(drag.t), drag && drag.d);
chk('WIN ไม่อยู่ในรายชื่อ', drag && !/WIN/.test(drag.d));
const sq = perfQuote(pa[0]);
chk('ถือ 4 เดือน → ผลสะสม + ระยะเวลา ไม่มี /ปี', /−12\.0% ใน 4 เดือน/.test(sq) && !/ปี/.test(sq), sq);
chk('ถือ 90 วันขึ้น 12% → "+12.0% ใน 3 เดือน" ไม่ใช่ ~+57%/ปี', perfQuote(pa[3]) === '+12.0% ใน 3 เดือน', perfQuote(pa[3]));
const allTxt = rep.findings.map(f => f.t + ' ' + f.d).join(' ');
chk('ไม่มี %/ปี ของตัวที่ถือ < 1 ปีที่ใดเลย', !/SHORT[^·]*\/ปี/.test(allTxt));
// ภาษาอังกฤษ
global.window.I18N = {lang: 'en'};
const repEn = analystPortfolio(cA), dragEn = repEn.findings.find(f => /drag/.test(f.t));
chk('อังกฤษ: มี finding + %/yr เฉพาะ OLD', dragEn && /worst OLD/.test(dragEn.t) && /\/yr/.test(dragEn.t), dragEn && dragEn.t);
chk('อังกฤษ: ผลสะสม "over 4 mo"', /over 4 mo/.test(perfQuote(pa[0])), perfQuote(pa[0]));
chk('อังกฤษ: action', /^Review OLD/.test(repEn.actions[0] || ''), repEn.actions[0]);
delete global.window.I18N;

console.log(FAIL ? `\n✗ ไม่ผ่าน ${FAIL} ข้อ` : '\n✓ ผ่านทั้งหมด');
process.exit(FAIL ? 1 : 0);
