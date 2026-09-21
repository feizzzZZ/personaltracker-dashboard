/* ชุดทดสอบ regime engine + ตัวอ่านสัญญาณ (v51)
   รัน:  node scripts/test_regime.cjs shared.js                                */
const fs = require('fs');
const FILE = process.argv[2] || 'shared.js';

let FAIL = 0;
const chk = (n, c, d = '') => {
  if (c) console.log('  ✓ ' + n);
  else { FAIL++; console.log('  ✗ ' + n + '  ' + d); }
};

// ── สภาพแวดล้อมจำลองขั้นต่ำ ───────────────────────────────────────────
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
global.window = {};
global.document = { getElementById: () => null, querySelector: () => null };
const src = fs.readFileSync(FILE, 'utf8');
const api = new Function(
  src + '; return {computeRegime,loadSignals,loadRisk,signalSummary,' +
        'invalidateMarketCache,APP_BUILD};')();
const { computeRegime, loadSignals, loadRisk, signalSummary,
        invalidateMarketCache } = api;

const iso = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const mk = (v, daysAgo) => ({ value: v, updated: iso(daysAgo),
                              fetched_at: new Date().toISOString() });

function setMarket(data) {
  store.finOS_market = JSON.stringify({ data });
  store.finOS_actions = JSON.stringify({ data: {} });
  delete store.finOS_ext;
  invalidateMarketCache();
}
function setPipeline(obj) {
  store.finOS_actions = JSON.stringify(obj);
  invalidateMarketCache();
}

console.log('build =', api.APP_BUILD);
chk('APP_BUILD เป็น v51', api.APP_BUILD === 'v51', api.APP_BUILD);

console.log('\n═══ 1. computeRegime — ตัดสัญญาณที่เก่าเกิน ═══');
{
  // ทุกตัวสด → ต้องได้ครบ
  setMarket({
    US_CPI: mk(2.9, 20), US3M: mk(3.98, 1), YIELD_CURVE: mk(58, 0),
    VIX: mk(15.1, 1), SP500_MA200: mk('Above', 1), SP500_RSI: mk(54, 1),
    CREDIT_STRESS: mk(0.2, 1), SET_MA200: mk('Above', 2), SET_RSI: mk(60, 2),
    US_UNEMP: mk(4.3, 25), US_REAL10Y: mk(2.03, 20), OIL_WTI: mk(86, 1),
  });
  const r = computeRegime();
  chk('ได้ regime กลับมา', !!r);
  chk('ใช้สัญญาณครบ 12 ตัว', r && r.signals.length === 12,
      r && `ได้ ${r.signals.length}: ` + r.signals.map(s => s.key).join(','));
  chk('ไม่มีตัวไหนถูกตัดทิ้ง', r && r.stale.length === 0,
      r && JSON.stringify(r.stale.map(s => s.key)));

  // ผลตอบแทนพันธบัตร/VIX เก่า 30 วัน = เก่าเกิน (เพดาน 10 วัน)
  setMarket({
    US_CPI: mk(2.9, 20), US3M: mk(3.98, 30), YIELD_CURVE: mk(58, 30),
    VIX: mk(15.1, 30), SP500_MA200: mk('Above', 1), SP500_RSI: mk(54, 1),
    CREDIT_STRESS: mk(0.2, 1), SET_MA200: mk('Above', 2), SET_RSI: mk(60, 2),
    US_UNEMP: mk(4.3, 25), US_REAL10Y: mk(2.03, 20), OIL_WTI: mk(86, 1),
  });
  const r2 = computeRegime();
  const staleKeys = r2 ? r2.stale.map(s => s.key).sort() : [];
  chk('ตัดสัญญาณรายวันที่เก่า 30 วันออก 3 ตัว',
      JSON.stringify(staleKeys) === JSON.stringify(['curve', 'fed', 'vix']),
      JSON.stringify(staleKeys));
  chk('สัญญาณที่เหลือไม่มีตัวเก่าปน',
      r2 && !r2.signals.some(s => ['curve', 'fed', 'vix'].includes(s.key)));
  chk('stale บอกอายุจริงและเพดาน',
      r2 && r2.stale[0].age === 30 && r2.stale[0].limit === 10,
      r2 && JSON.stringify(r2.stale[0]));

  // CPI/ว่างงาน เป็นรายเดือน เพดานต้องกว้างกว่า (75 วัน) ไม่ใช่ 10
  setMarket({
    US_CPI: mk(2.9, 45), US_UNEMP: mk(4.3, 45), US_REAL10Y: mk(2.03, 45),
    VIX: mk(15.1, 1), SP500_MA200: mk('Above', 1), SP500_RSI: mk(54, 1),
  });
  const r3 = computeRegime();
  chk('CPI อายุ 45 วัน ยังใช้ได้ (รายเดือน)',
      r3 && r3.signals.some(s => s.key === 'cpi'),
      r3 && JSON.stringify(r3.stale.map(s => s.key)));
  chk('ว่างงานอายุ 45 วัน ยังใช้ได้',
      r3 && r3.signals.some(s => s.key === 'unemp'));

  // เกิน 75 วัน = อาการเดิมที่ทำให้หน้า Macro โชว์ของเก่าเหมือนของสด
  setMarket({
    US_CPI: mk(3.7, 110), US_UNEMP: mk(4.2, 110), US_REAL10Y: mk(2.44, 110),
    VIX: mk(15.1, 1), SP500_MA200: mk('Above', 1), SP500_RSI: mk(54, 1),
  });
  const r4 = computeRegime();
  chk('CPI อายุ 110 วัน ถูกตัดออก',
      r4 && !r4.signals.some(s => s.key === 'cpi'),
      r4 && JSON.stringify(r4.signals.map(s => s.key)));

  // ข้อมูลน้อยกว่า 3 ตัว = ไม่สรุป regime (ของเดิม ต้องไม่พัง)
  setMarket({ VIX: mk(15.1, 1), SP500_RSI: mk(54, 1) });
  chk('สัญญาณน้อยกว่า 3 ตัว → ไม่สรุป', computeRegime() === null);
}

console.log('\n═══ 2. เครดิต — หน่วย SD ต้องไม่ถูกอ่านเป็น % ═══');
{
  const base = { VIX: mk(15.1, 1), SP500_MA200: mk('Above', 1),
                 SP500_RSI: mk(54, 1) };

  // ความเครียด +2.5 SD = วิกฤต ต้องได้คะแนนลบสูงสุด
  setMarket({ ...base, CREDIT_STRESS: mk(2.5, 1) });
  let c = computeRegime().signals.find(s => s.key === 'credit');
  chk('+2.5 SD → คะแนน −2', c && c.score === -2, JSON.stringify(c));
  chk('แสดงหน่วยเป็น SD ไม่ใช่ %', c && /SD/.test(c.val) && !/%/.test(c.val),
      c && c.val);

  // นี่คือบั๊กที่จะเกิดถ้ายัดค่า z ลง key เดิม: 0.9 ถูกอ่านว่า "ผ่อนคลายมาก"
  setMarket({ ...base, CREDIT_STRESS: mk(0.9, 1) });
  c = computeRegime().signals.find(s => s.key === 'credit');
  chk('+0.9 SD → คะแนน 0 (ไม่ใช่ +1 แบบที่เกณฑ์ % จะให้)', c && c.score === 0,
      JSON.stringify(c));

  setMarket({ ...base, CREDIT_STRESS: mk(-1.2, 1) });
  c = computeRegime().signals.find(s => s.key === 'credit');
  chk('−1.2 SD (ผ่อนคลาย) → คะแนน +1', c && c.score === 1, JSON.stringify(c));

  // ถ้าวันหนึ่งได้ HY OAS ตัวจริงกลับมา ต้องใช้ตัวจริงก่อน
  setMarket({ ...base, CREDIT_SPREAD: mk(5.2, 1), CREDIT_STRESS: mk(0.1, 1) });
  c = computeRegime().signals.find(s => s.key === 'credit');
  chk('มี HY OAS จริง → ใช้ตัวจริง ไม่ใช้ proxy',
      c && /OAS/.test(c.label) && c.score === -1, JSON.stringify(c));
}

console.log('\n═══ 3. ดอกเบี้ยระยะสั้น — ป้ายต้องตรงกับแหล่ง ═══');
{
  const base = { VIX: mk(15.1, 1), SP500_MA200: mk('Above', 1),
                 SP500_RSI: mk(54, 1) };
  setMarket({ ...base, US3M: mk(3.98, 1) });
  let f = computeRegime().signals.find(s => s.key === 'fed');
  chk('ไม่มี FED_RATE → ใช้ ^IRX', f && f.val === '3.98%', JSON.stringify(f));
  chk('ห้ามเขียนว่า Fed Funds Rate เมื่อค่ามาจาก T-bill',
      f && !/Fed Funds/.test(f.label), f && f.label);
  chk('หมายเหตุบอกว่าเป็นตัวแทน', f && /\^IRX/.test(f.note), f && f.note);

  setMarket({ ...base, FED_RATE: mk(4.25, 1), US3M: mk(3.98, 1) });
  f = computeRegime().signals.find(s => s.key === 'fed');
  chk('ถ้ามี FED_RATE จริง ใช้ตัวจริงก่อน',
      f && f.val === '4.25%' && /Fed Funds/.test(f.label), JSON.stringify(f));
}

console.log('\n═══ 4. loadSignals / loadRisk ═══');
{
  const S = (o) => ({ sym: 'X', price: 100, updated: iso(0), rsi: 50,
                      ma50: 'Above', ma200: 'Above', score: 0,
                      action: 'ถือ', why: [], ...o });
  setPipeline({ data: {}, signals: {
    AAPL: S({ score: 3, action: 'ทยอยเข้าเพิ่ม' }),
    TSLA: S({ score: -3, action: 'ชะลอเข้าเพิ่ม', ma200: 'Below' }),
    BTC:  S({ score: 1 }),
    OLD:  S({ score: 4, updated: iso(30) }),
  }, risk: { level: 'elevated', severity: 3, flags: [
    { k: 'breadth', sev: 1, msg: 'a' }, { k: 'vix', sev: 2, msg: 'b' }] } });

  const L = loadSignals();
  chk('อ่านสัญญาณได้ครบ 4 ตัว', L && L.length === 4, L && L.length);
  chk('เรียงตามคะแนนมากไปน้อย',
      L && L.map(x => x.ticker).join(',') === 'OLD,AAPL,BTC,TSLA',
      L && L.map(x => `${x.ticker}:${x.score}`).join(','));
  chk('ตัวที่อัปเดต 30 วันก่อน ถูกติดธง stale',
      L && L.find(x => x.ticker === 'OLD').stale === true);
  chk('ตัวที่อัปเดตวันนี้ ไม่ติดธง',
      L && L.find(x => x.ticker === 'AAPL').stale === false);

  const sum = signalSummary(L);
  chk('สรุปไม่นับตัว stale', sum.count === 3 && sum.stale === 1,
      JSON.stringify(sum));
  chk('คะแนน ≥3 ที่ยังสดเท่านั้นเข้ากลุ่มซื้อ',
      sum.buy.length === 1 && sum.buy[0].ticker === 'AAPL',
      sum.buy.map(x => x.ticker).join(','));
  chk('คะแนน ≤−2 เข้ากลุ่มลด',
      sum.trim.length === 1 && sum.trim[0].ticker === 'TSLA');
  chk('breadth นับจากตัวที่ยังสด (2 ใน 3 เหนือ MA200)', sum.breadth === 67,
      String(sum.breadth));

  const R = loadRisk();
  chk('อ่าน risk ได้', R && R.level === 'elevated');
  chk('ธงเรียงจากรุนแรงมากไปน้อย', R && R.flags[0].k === 'vix',
      R && R.flags.map(f => f.k).join(','));

  setPipeline({ data: {} });
  chk('ไม่มี signals → คืน null', loadSignals() === null);
  chk('ไม่มี risk → คืน null', loadRisk() === null);
  chk('signalSummary ไม่มีข้อมูล → null', signalSummary() === null);

  // ทุกตัว stale = ไม่มีอะไรให้ตัดสินใจ ต้องไม่เผลอรายงาน breadth จากของเก่า
  setPipeline({ data: {}, signals: { A: S({ updated: iso(30), score: 4 }) } });
  const s2 = signalSummary();
  chk('ทุกตัว stale → count 0 และ breadth null',
      s2.count === 0 && s2.breadth === null && s2.stale === 1,
      JSON.stringify(s2));
}

console.log('\n═══ ไม่ทำลายของเดิม ═══');
{
  setMarket({ VIX: mk(15.1, 1), SP500_MA200: mk('Above', 1),
              SP500_RSI: mk(54, 1), SET_MA200: mk('Above', 1) });
  const r = computeRegime();
  chk('ยังคืน field เดิมครบ',
      r && ['label', 'color', 'desc', 'posture', 'risk', 'avg', 'spectrum',
            'signals', 'cashRange', 'negatives', 'positives', 'dataAsOf',
            'oldestAsOf'].every(k => k in r),
      r && Object.keys(r).join(','));
  chk('spectrum อยู่ในช่วง 2-98', r && r.spectrum >= 2 && r.spectrum <= 98,
      r && r.spectrum);
  chk('negatives/positives แยกตามเครื่องหมายคะแนน',
      r && r.negatives.every(x => x.score < 0) &&
           r.positives.every(x => x.score > 0));
}

console.log('\n─────────────────────────────────────────────');
if (FAIL) { console.log(`❌ ไม่ผ่าน ${FAIL} ข้อ`); process.exit(1); }
console.log('✅ ผ่านทั้งหมด');
