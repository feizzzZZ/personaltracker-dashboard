/* ══ autobot.js — บอทเทรดตามกฎ: ตัวประเมินเงื่อนไข + พอร์ตจำลอง (v75 · phase 1 = paper เท่านั้น) ══════════
   ใช้ไฟล์เดียวกันทั้งในแอป (โหลดเป็น <script>) และใน Cloudflare Worker (cloudflare-worker/autobot/ import ไฟล์นี้)
   → กฎชุดเดียวกันให้ผลเหมือนกันทุกที่ · ไม่มี network ไม่มี DOM ไม่มีการส่งคำสั่งจริงในไฟล์นี้

   กฎ (rule):
     {id, name, enabled, broker:'binance'|'settrade'|'manual', symbol, side:'buy'|'sell',
      trigger:{kind, ...}, amountTHB, cooldownDays, maxTotalTHB}
     trigger.kind:
       'schedule'       {every:'week'|'month', day}  — DCA: สัปดาห์ละครั้ง (day 1=จันทร์…7=อาทิตย์) / เดือนละครั้ง (day 1–28)
       'price_below'    {value}  — ราคา ≤ value (สกุลเงินของสินทรัพย์)
       'price_above'    {value}  — ราคา ≥ value
       'drop_from_high' {pct}    — ต่ำกว่าจุดสูงสุด 52 สัปดาห์ ≥ pct%  (signals.drawdown)
       'rsi_below'      {value}  — RSI(14) ≤ value
       'rsi_above'      {value}  — RSI(14) ≥ value
   ตลาด (market): {now, prices:{SYM:{price, ccy}}, signals:{SYM:{rsi, drawdown}}, fx:{USD:33.5, THB:1}}
   สถานะ (state):  {startTHB, cash, positions:{SYM:{qty, costTHB}}, ledger:[…], last:{ruleId:t}, period:{ruleId:key}, spent:{ruleId:THB}}

   ค่าธรรมเนียมเป็นค่าประมาณ (ปรับใน FEES) — Binance spot 0.1% · หุ้นไทยออนไลน์ ~0.157% รวม VAT · แอปที่กดเอง ไม่คิด */
(function(root){
'use strict';

const FEES = { binance: 0.001, settrade: 0.00157, manual: 0 };
const BROKERS = ['binance', 'settrade', 'manual'];
const KINDS = ['schedule', 'price_below', 'price_above', 'drop_from_high', 'rsi_below', 'rsi_above'];
const DAY = 86400e3;

function newState(startTHB){
  const s = Math.max(0, Number(startTHB) || 0);
  return { startTHB: s, cash: s, positions: {}, ledger: [], last: {}, period: {}, spent: {} };
}

// ข้อความผิดพลาดภาษาอังกฤษ (validateRule คืนภาษาไทย — แอปแปลด้วยตารางนี้)
const ERR_EN = {
  'กฎว่าง':'Empty rule', 'ตั้งชื่อกฎ':'Name the rule', 'เลือกโบรกเกอร์':'Choose a broker',
  'สัญลักษณ์สินทรัพย์ไม่ถูกต้อง':'Invalid asset symbol', 'เลือกซื้อหรือขาย':'Choose buy or sell', 'เลือกเงื่อนไข':'Choose a condition',
  'เลือกทุกสัปดาห์หรือทุกเดือน':'Choose weekly or monthly', 'วันในสัปดาห์ 1–7':'Weekday 1–7', 'วันที่ 1–28':'Day of month 1–28',
  'ร้อยละที่ลดลง 0–100':'Drop % must be 0–100', 'RSI 0–100':'RSI 0–100', 'ใส่ราคาเป้าหมาย':'Enter a target price',
  'ใส่จำนวนเงินต่อครั้ง':'Enter an amount per order', 'วงเงินรวมต้องไม่น้อยกว่าเงินต่อครั้ง':'Total cap must be at least the amount per order',
  'ระยะพักต้องไม่ติดลบ':'Cooldown cannot be negative',
};

// ตรวจกฎก่อนบันทึก — คืนข้อความผิดพลาดแรก (ภาษาไทย · อังกฤษดู ERR_EN) หรือ ''
function validateRule(r){
  if(!r || typeof r !== 'object') return 'กฎว่าง';
  if(!String(r.name || '').trim()) return 'ตั้งชื่อกฎ';
  if(!BROKERS.includes(r.broker)) return 'เลือกโบรกเกอร์';
  if(!/^[A-Z0-9.\-]{1,20}$/.test(String(r.symbol || ''))) return 'สัญลักษณ์สินทรัพย์ไม่ถูกต้อง';
  if(r.side !== 'buy' && r.side !== 'sell') return 'เลือกซื้อหรือขาย';
  const t = r.trigger || {};
  if(!KINDS.includes(t.kind)) return 'เลือกเงื่อนไข';
  if(t.kind === 'schedule'){
    if(t.every !== 'week' && t.every !== 'month') return 'เลือกทุกสัปดาห์หรือทุกเดือน';
    const d = Number(t.day);
    if(!(Number.isInteger(d) && d >= 1 && d <= (t.every === 'week' ? 7 : 28))) return t.every === 'week' ? 'วันในสัปดาห์ 1–7' : 'วันที่ 1–28';
  } else if(t.kind === 'drop_from_high'){
    if(!(Number(t.pct) > 0 && Number(t.pct) < 100)) return 'ร้อยละที่ลดลง 0–100';
  } else if(t.kind === 'rsi_below' || t.kind === 'rsi_above'){
    if(!(Number(t.value) > 0 && Number(t.value) < 100)) return 'RSI 0–100';
  } else if(!(Number(t.value) > 0)) return 'ใส่ราคาเป้าหมาย';
  if(!(Number(r.amountTHB) > 0)) return 'ใส่จำนวนเงินต่อครั้ง';
  if(r.maxTotalTHB != null && r.maxTotalTHB !== '' && !(Number(r.maxTotalTHB) >= Number(r.amountTHB))) return 'วงเงินรวมต้องไม่น้อยกว่าเงินต่อครั้ง';
  if(r.cooldownDays != null && r.cooldownDays !== '' && !(Number(r.cooldownDays) >= 0)) return 'ระยะพักต้องไม่ติดลบ';
  return '';
}

// รอบของกฎแบบตั้งเวลา — ยิงได้ครั้งเดียวต่อรอบ และต้องถึงวันที่กำหนดของรอบนั้นแล้ว (ใช้เวลาไทย UTC+7)
function _bkk(t){ return new Date(t + 7 * 3600e3); }
function periodKey(trigger, t){
  const d = _bkk(t);
  if(trigger.every === 'month') return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  // สัปดาห์เริ่มวันจันทร์: นับจากจันทร์แรกของ epoch (1970-01-05)
  const mondayEpoch = Date.UTC(1970, 0, 5);
  return 'W' + Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - mondayEpoch) / (7 * DAY));
}
function scheduleDue(trigger, t){
  const d = _bkk(t);
  if(trigger.every === 'month') return d.getUTCDate() >= Number(trigger.day);
  const dow = ((d.getUTCDay() + 6) % 7) + 1;           // 1=จันทร์ … 7=อาทิตย์
  return dow >= Number(trigger.day);
}

function _fx(market, ccy){
  if(!ccy || ccy === 'THB') return 1;
  const v = market.fx && market.fx[ccy];
  return v > 0 ? v : null;
}

// เงื่อนไขของกฎตรงหรือไม่ — คืน {hit, why} (why = เหตุผลภาษาไทยสั้น ๆ ไว้แสดง/บันทึก)
function checkTrigger(rule, market, state){
  const t = rule.trigger, sym = rule.symbol;
  const px = market.prices && market.prices[sym];
  const sig = (market.signals && market.signals[sym]) || {};
  switch(t.kind){
    case 'schedule': {
      const key = periodKey(t, market.now);
      if(state.period[rule.id] === key) return {hit: false, why: 'รอบนี้ทำไปแล้ว', whyEn: 'already done this period'};
      if(!scheduleDue(t, market.now)) return {hit: false, why: 'ยังไม่ถึงวันที่ตั้งไว้', whyEn: 'scheduled day not reached'};
      return {hit: true, why: t.every === 'month' ? `DCA รายเดือน (วันที่ ${t.day})` : `DCA รายสัปดาห์`,
              whyEn: t.every === 'month' ? `monthly DCA (day ${t.day})` : 'weekly DCA', periodKey: key};
    }
    case 'price_below': case 'price_above': {
      if(!px || !(px.price > 0)) return {hit: false, why: 'ไม่มีราคา', whyEn: 'no price'};
      const ok = t.kind === 'price_below' ? px.price <= t.value : px.price >= t.value;
      const op = t.kind === 'price_below' ? (ok ? '≤' : '>') : (ok ? '≥' : '<');
      return {hit: ok, why: `ราคา ${px.price} ${op} ${t.value}`, whyEn: `price ${px.price} ${op} ${t.value}`};
    }
    case 'drop_from_high': {
      if(!(typeof sig.drawdown === 'number')) return {hit: false, why: 'ไม่มีข้อมูลจุดสูงสุด', whyEn: 'no 52-week high data'};
      return {hit: -sig.drawdown >= t.pct, why: `ต่ำกว่าจุดสูงสุด ${Math.abs(sig.drawdown).toFixed(1)}% (เกณฑ์ ${t.pct}%)`,
              whyEn: `${Math.abs(sig.drawdown).toFixed(1)}% below high (threshold ${t.pct}%)`};
    }
    case 'rsi_below': case 'rsi_above': {
      if(!(typeof sig.rsi === 'number')) return {hit: false, why: 'ไม่มีค่า RSI', whyEn: 'no RSI'};
      const ok = t.kind === 'rsi_below' ? sig.rsi <= t.value : sig.rsi >= t.value;
      const op = t.kind === 'rsi_below' ? (ok ? '≤' : '>') : (ok ? '≥' : '<');
      return {hit: ok, why: `RSI ${sig.rsi.toFixed(1)} ${op} ${t.value}`, whyEn: `RSI ${sig.rsi.toFixed(1)} ${op} ${t.value}`};
    }
  }
  return {hit: false, why: 'ไม่รู้จักเงื่อนไข', whyEn: 'unknown condition'};
}

// ประเมินกฎทั้งหมดกับราคาปัจจุบัน → คำสั่งที่ "จะ" ส่ง (ยังไม่แตะ state)
// ลำดับตามรายการกฎ · เงินสด/จำนวนที่ถือ หักไปตามคำสั่งก่อนหน้าในรอบเดียวกันด้วย (ไม่ซื้อเกินเงินที่มี)
function evaluate(rules, state, market){
  const orders = [], skipped = [];
  let cash = state.cash;
  const held = {}; Object.entries(state.positions || {}).forEach(([k, v]) => { held[k] = v.qty; });
  (rules || []).forEach(rule => {
    const skip = (why, whyEn) => skipped.push({ruleId: rule.id, why, whyEn: whyEn || why});
    if(!rule.enabled) return skip('ปิดอยู่', 'disabled');
    if(validateRule(rule)) return skip('กฎไม่ครบ: ' + validateRule(rule), 'incomplete rule: ' + (ERR_EN[validateRule(rule)] || validateRule(rule)));
    const tr = checkTrigger(rule, market, state);
    if(!tr.hit) return skip(tr.why, tr.whyEn);
    const cd = Number(rule.cooldownDays) || 0;
    const last = state.last[rule.id];
    if(rule.trigger.kind !== 'schedule' && cd > 0 && last && market.now - last < cd * DAY)
      return skip(`พักอยู่ (ทำล่าสุด ${Math.floor((market.now - last) / DAY)} วันก่อน · พัก ${cd} วัน)`,
                  `cooling down (last ${Math.floor((market.now - last) / DAY)} d ago · ${cd} d cooldown)`);
    const px = market.prices && market.prices[rule.symbol];
    if(!px || !(px.price > 0)) return skip('ไม่มีราคา ' + rule.symbol, 'no price for ' + rule.symbol);
    const fx = _fx(market, px.ccy);
    if(fx == null) return skip('ไม่มีอัตราแลกเปลี่ยน ' + px.ccy, 'no FX rate for ' + px.ccy);
    const pTHB = px.price * fx, fee = FEES[rule.broker] || 0;
    let amt = Number(rule.amountTHB);
    const cap = Number(rule.maxTotalTHB) || 0;
    if(cap > 0 && (state.spent[rule.id] || 0) + amt > cap + 1e-6) return skip(`ครบวงเงินรวม ฿${cap}`, `total cap ฿${cap} reached`);
    let qty;
    if(rule.side === 'buy'){
      if(cash < amt - 1e-6) return skip(`เงินสดจำลองไม่พอ (เหลือ ฿${Math.round(cash)})`, `not enough paper cash (฿${Math.round(cash)} left)`);
      qty = amt * (1 - fee) / pTHB;
      cash -= amt;
    } else {
      const h = held[rule.symbol] || 0;
      if(!(h > 0)) return skip('ไม่มี ' + rule.symbol + ' ให้ขาย', 'no ' + rule.symbol + ' to sell');
      qty = Math.min(h, amt / pTHB);
      amt = qty * pTHB;
      cash += amt * (1 - fee);
    }
    held[rule.symbol] = (held[rule.symbol] || 0) + (rule.side === 'buy' ? qty : -qty);
    orders.push({t: market.now, ruleId: rule.id, rule: rule.name, broker: rule.broker, symbol: rule.symbol, side: rule.side,
                 qty, price: px.price, ccy: px.ccy || 'THB', fx, amountTHB: amt, feeTHB: amt * fee, why: tr.why, whyEn: tr.whyEn || tr.why,
                 periodKey: tr.periodKey || null, mode: 'paper'});
  });
  return {orders, skipped};
}

// ใส่คำสั่งลงพอร์ตจำลอง (paper fill ที่ราคาตอนประเมิน) — คืน state ใหม่ ไม่แก้ของเดิม
function applyPaper(state, orders){
  const s = JSON.parse(JSON.stringify(state));
  (orders || []).forEach(o => {
    const p = s.positions[o.symbol] || (s.positions[o.symbol] = {qty: 0, costTHB: 0});
    if(o.side === 'buy'){
      s.cash -= o.amountTHB;
      p.qty += o.qty; p.costTHB += o.amountTHB;
    } else {
      const frac = p.qty > 0 ? Math.min(1, o.qty / p.qty) : 0;
      p.costTHB -= p.costTHB * frac;            // ต้นทุนถัวเฉลี่ย: ขายออกตามสัดส่วน
      p.qty -= o.qty;
      s.cash += o.amountTHB - o.feeTHB;
      if(p.qty < 1e-12){ delete s.positions[o.symbol]; }
    }
    s.last[o.ruleId] = o.t;
    if(o.periodKey) s.period[o.ruleId] = o.periodKey;
    s.spent[o.ruleId] = (s.spent[o.ruleId] || 0) + (o.side === 'buy' ? o.amountTHB : 0);
    s.ledger.push(o);
  });
  if(s.ledger.length > 500) s.ledger = s.ledger.slice(-500);
  return s;
}

// มูลค่าพอร์ตจำลอง ณ ราคาปัจจุบัน
function valuate(state, market){
  let pos = 0; const rows = [];
  Object.entries(state.positions || {}).forEach(([sym, p]) => {
    const px = market.prices && market.prices[sym];
    const fx = px ? _fx(market, px.ccy) : null;
    const v = px && fx != null ? p.qty * px.price * fx : null;
    if(v != null) pos += v;
    rows.push({symbol: sym, qty: p.qty, costTHB: p.costTHB, valueTHB: v, pnlTHB: v == null ? null : v - p.costTHB});
  });
  const equity = state.cash + pos;
  return {cash: state.cash, positionsTHB: pos, equity, pnlTHB: equity - state.startTHB,
          pnlPct: state.startTHB > 0 ? (equity - state.startTHB) / state.startTHB : null, rows};
}

// รอบเดียวครบ: ประเมิน → ใส่พอร์ตจำลอง
function runPaper(rules, state, market){
  const ev = evaluate(rules, state, market);
  return {state: applyPaper(state, ev.orders), orders: ev.orders, skipped: ev.skipped};
}

// market-data.json (ที่ pipeline สร้าง วันละ 2 รอบ) → ตลาดสำหรับ evaluate
// live = ราคาสดทับ (เช่น Worker ดึงจาก Binance ทุก 15 นาที) {SYM:{price, ccy}}
function marketFromData(md, now, live){
  const prices = {}, signals = {};
  Object.entries((md && md.prices) || {}).forEach(([k, v]) => { if(v && v.price > 0) prices[k] = {price: Number(v.price), ccy: v.ccy || 'THB'}; });
  Object.entries((md && md.signals) || {}).forEach(([k, v]) => { if(v) signals[k] = {rsi: v.rsi, drawdown: v.drawdown}; });
  Object.entries(live || {}).forEach(([k, v]) => { if(v && v.price > 0) prices[k] = {price: Number(v.price), ccy: v.ccy || 'USD'}; });
  const usd = Number(md && md.data && md.data.USDTHB && md.data.USDTHB.value);
  return {now: now || Date.now(), prices, signals, fx: {THB: 1, USD: usd > 0 ? usd : null}};
}

root.AutoBot = { ERR_EN, FEES, BROKERS, KINDS, newState, marketFromData, validateRule, checkTrigger, evaluate, applyPaper, valuate, runPaper, periodKey, scheduleDue };
})(typeof window !== 'undefined' ? window : globalThis);
