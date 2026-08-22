/* ── #2 + #5: one locale constant for the whole app ─────────────────────
   'th-TH' alone defaults to the BUDDHIST calendar in ICU, so
   toLocaleDateString('th-TH',{year:'numeric'}) returned "2569" instead of
   "2026" (543 years off) in 7 places, while monthLabel() printed Gregorian
   English. -u-ca-gregory forces the Gregorian calendar while keeping Thai
   month names and Latin digits/separators. Use LOC for EVERY
   toLocaleString / toLocaleDateString call so nothing can drift again. */
window.LOC = window.LOC || 'th-TH-u-ca-gregory';
// ═══════════════════════════════════════════════════════════════════
// Finance OS — shared.js : DATA LAYER กลางของทั้งสองหน้า
// ═══════════════════════════════════════════════════════════════════
// single source of truth ของ:
//   • APP_BUILD — bump ที่นี่ที่เดียว (คู่กับ CACHE_NAME ใน service-worker.js)
//   • Market data bridge: ชีต → localStorage → merge pipeline → CoinGecko
//   • เป้า allocation ผู้ใช้ + computeDeviations (Alerts/Allocation ใช้ตัวเดียวกัน)
//   • XIRR engine
// กติกา: ไฟล์นี้ห้ามแตะ DOM ของหน้าใดหน้าหนึ่ง — pure data layer เท่านั้น
// ═══════════════════════════════════════════════════════════════════
const APP_BUILD = 'v48';
console.log('[Finance OS shared] build', APP_BUILD);
window.SHARED_BUILD = APP_BUILD;   // v45 — ให้ index.html ตรวจได้ว่าเวอร์ชันตรงกัน

// ═══ LIVE_META — นิยามการ์ดข้อมูลตลาด ═══
const LIVE_META = {
  SP500:     {label:'S&P 500',        fmt:v=>Number(v).toLocaleString(LOC,{maximumFractionDigits:0})},
  SP500_CHG: {label:'S&P 500 Δ วันนี้',fmt:v=>(v>=0?'+':'')+Number(v).toFixed(2)+'%', signed:true},
  NASDAQ:    {label:'Nasdaq',         fmt:v=>Number(v).toLocaleString(LOC,{maximumFractionDigits:0})},
  VIX:       {label:'VIX (Fear)',     fmt:v=>Number(v).toFixed(1)},
  SET_INDEX: {label:'SET Index',      fmt:v=>Number(v).toLocaleString(LOC,{maximumFractionDigits:1})},
  USDTHB:    {label:'USD/THB',        fmt:v=>Number(v).toFixed(2)},
  BTCUSD:    {label:'Bitcoin',        fmt:v=>'$'+Number(v).toLocaleString(LOC,{maximumFractionDigits:0})},
  ETHUSD:    {label:'Ethereum',       fmt:v=>'$'+Number(v).toLocaleString(LOC,{maximumFractionDigits:0})},
  GOLD_GLD:  {label:'Gold (GLD proxy)',fmt:v=>'$'+Number(v).toFixed(1)},
  FED_RATE:  {label:'Fed Funds Rate', fmt:v=>Number(v).toFixed(2)+'%'},
  BOT_RATE:  {label:'BOT Policy Rate',fmt:v=>Number(v).toFixed(2)+'%'},
  US10Y:     {label:'US 10Y Yield',   fmt:v=>Number(v).toFixed(2)+'%'},
  GOLD_XAU:  {label:'Gold Spot (XAU)',fmt:v=>'$'+Number(v).toLocaleString(LOC,{maximumFractionDigits:0})},
  US_CPI:    {label:'US CPI YoY',     fmt:v=>Number(v).toFixed(1)+'%'},
  US_PCE:    {label:'US PCE YoY',     fmt:v=>Number(v).toFixed(1)+'%'},
  NFP:       {label:'NFP (Jobs)',     fmt:v=>(v>=0?'+':'')+Number(v).toLocaleString(LOC)+'K'},
  US_GDP:    {label:'US GDP QoQ',     fmt:v=>(v>=0?'+':'')+Number(v).toFixed(1)+'%'},
  ISM_MFG:   {label:'ISM Manufacturing', fmt:v=>Number(v).toFixed(1)},
  ISM_SVC:   {label:'ISM Services',   fmt:v=>Number(v).toFixed(1)},
  YIELD_CURVE:{label:'Yield Curve 2s10s', fmt:v=>(v>=0?'+':'')+Number(v).toFixed(0)+'bps', signed:true},
  CREDIT_SPREAD:{label:'Credit Spread HY-IG', fmt:v=>Number(v).toFixed(1)+'%'},
  TH_CPI:    {label:'CPI ไทย YoY',    fmt:v=>Number(v).toFixed(1)+'%'},
  TH_GDP:    {label:'GDP ไทย YoY',    fmt:v=>(v>=0?'+':'')+Number(v).toFixed(1)+'%'},
  TH_TOURISTS:{label:'นักท่องเที่ยว/เดือน', fmt:v=>Number(v).toFixed(1)+'M'},
  TH_FDI:    {label:'FDI ไทย',        fmt:v=>'฿'+Number(v).toLocaleString(LOC)+'B'},
  SP500_RSI: {label:'S&P 500 RSI (14d)', fmt:v=>Number(v).toFixed(0)},
  SET_RSI:   {label:'SET RSI (14d)',  fmt:v=>Number(v).toFixed(0)},
  PUT_CALL:  {label:'Put/Call Ratio', fmt:v=>Number(v).toFixed(2)},
  SP500_MA200:{label:'S&P vs MA200',  fmt:v=>String(v)},
  SET_MA200: {label:'SET vs MA200',   fmt:v=>String(v)},
  // ── key ใหม่จาก pipeline (v39) ──
  US2Y:      {label:'US 2Y Yield',    fmt:v=>Number(v).toFixed(2)+'%'},
  US_CORE_CPI:{label:'US Core CPI YoY',fmt:v=>Number(v).toFixed(1)+'%'},
  US_CORE_PCE:{label:'US Core PCE YoY',fmt:v=>Number(v).toFixed(1)+'%'},
  US_UNEMP:  {label:'US Unemployment',fmt:v=>Number(v).toFixed(1)+'%'},
  US_REAL10Y:{label:'Real 10Y (TIPS)',fmt:v=>Number(v).toFixed(2)+'%'},
  OIL_WTI:   {label:'WTI Crude',      fmt:v=>'$'+Number(v).toFixed(2)},
  DXY:       {label:'Dollar Index',   fmt:v=>Number(v).toFixed(2)},
  NDX_RSI:   {label:'Nasdaq RSI (14d)',fmt:v=>Number(v).toFixed(0)},
  NDX_MA200: {label:'Nasdaq vs MA200',fmt:v=>String(v)},
};

// ═══ Method 3 — pipeline JSON layer + loadMarketData (merge chain) ═══
// ── METHOD 3: GitHub Actions pipeline (market-data.json ใน repo เดียวกัน) ──
function loadActions(){ try{ return JSON.parse(localStorage.getItem('finOS_actions')||'null'); }catch(e){ return null; } }
async function fetchActionsData(){
  try{
    const r = await fetch('market-data.json?t='+new Date().toISOString().slice(0,10)); // cache-bust รายวัน
    if(!r.ok) return null;
    const j = await r.json();
    if(j && j.data){ localStorage.setItem('finOS_actions', JSON.stringify(j)); return j; }
  }catch(e){ console.log('[Actions] ยังไม่มี market-data.json (pipeline ยังไม่รัน) — ข้าม'); }
  return null;
}
function mergeActionsIntoMarket(md){
  const act = loadActions();
  if(!act || !act.data) return md;
  if(!md) md = { savedAt: 0, data: {} };
  Object.entries(act.data).forEach(([k,v])=>{
    const cur = md.data[k];
    // เลือกตัวที่ updated ใหม่กว่า — ชีต GOOGLEFINANCE สดกว่าสำหรับราคา,
    // pipeline สดกว่าสำหรับ macro ที่ชีตใส่มือ
    // v40: FRED ส่ง "observation date" (เช่น CPI = 2026-06-01) ไม่ใช่เวลาที่ดึงข้อมูล
    // ส่วนชีตส่ง timestamp ตอน sync (วันนี้) → ชีตชนะเสมอแม้ pipeline จะแม่นกว่า
    // แก้โดยใช้ fetched_at เป็นตัวตัดสินความสด ส่วน updated ใช้แค่แสดงผล
    const curT = cur?.fetched_at ? Date.parse(cur.fetched_at) : (cur?.updated ? Date.parse(cur.updated) : 0);
    const actT = v.fetched_at   ? Date.parse(v.fetched_at)   : (v.updated   ? Date.parse(v.updated)   : 0);
    const badVal = v.value==null || (typeof v.value==='number' && !isFinite(v.value))
                || (typeof v.value==='string' && /^#|N\/A|^\s*$/i.test(v.value.trim()));
    if(badVal) return;                              // ค่าพัง → ข้าม ไม่ทับของดี
    if(!cur || actT >= curT) md.data[k] = { value:v.value, updated:v.updated,
      fetched_at:v.fetched_at||null, note:'🤖 '+(v.note||'pipeline') };
  });
  return md;
}
let _mdCacheKey = null, _mdCacheVal = null;
function loadMarketData(){
  try{
    // #28 — cache key = สตริงดิบของทุกแหล่งที่ merge เข้ามา
    // ถ้าไม่มีอะไรเปลี่ยน ใช้ผลเดิม (เลี่ยง JSON.parse 3 ก้อนต่อการเรียกหนึ่งครั้ง)
    const rawM = localStorage.getItem('finOS_market') || '';
    const rawA = localStorage.getItem('finOS_actions') || '';
    const rawE = localStorage.getItem('finOS_ext') || '';
    const key  = rawM.length+':'+rawA.length+':'+rawE.length+'|'+rawM+'\u0000'+rawA+'\u0000'+rawE;
    if(key === _mdCacheKey) return _mdCacheVal;
    let md = rawM ? JSON.parse(rawM) : null;
    md = mergeActionsIntoMarket(md);   // Method 3
    md = mergeExtIntoMarket(md);       // Method 2 (crypto สดสุด ชนะเสมอ)
    _mdCacheKey = key; _mdCacheVal = md;
    return md;
  }catch(e){ _mdCacheKey = null; _mdCacheVal = null; return null; }
}
// เรียกเมื่อเขียนทับ localStorage โดยตรง (เช่น restore backup) เพื่อบังคับให้อ่านใหม่
function invalidateMarketCache(){ _mdCacheKey = null; _mdCacheVal = null; }

// ═══ #12 — pipeline freshness ═════════════════════════════════════════
// เหตุผลที่ต้องมี: UI มีจุดเขียว .dot-live กระพริบ `animation:pulse 2s infinite`
// ตลอดเวลา โดยไม่เคยเช็คอายุข้อมูลเลย ระหว่าง run #40-47 ของ GitHub Actions ที่
// ถูกฆ่าเพราะ timeout ทุกรอบ market-data.json ค้างที่ 27-28 ก.ค. นานถึง 11 วัน
// แต่ผู้ใช้ยังเห็นไฟเขียวกระพริบ = เชื่อว่าราคาสด = ตัดสินใจลงทุนบนราคาเก่า
//
// บั๊กแสดงผลอื่นผิดแบบ "เห็นได้" (฿NaN, 2569) อันนี้ผิดแบบ "น่าเชื่อถือ"
// ซึ่งอันตรายกว่า เพราะไม่มีอะไรบอกให้สงสัย
function marketDataAge(){
  // คืน {hours, days, generatedAt, level, label} หรือ null ถ้าไม่มีไฟล์ pipeline เลย
  let act = null;
  try{ act = JSON.parse(localStorage.getItem('finOS_actions')||'null'); }catch(e){ return null; }
  const ts = act && act.generated_at ? Date.parse(act.generated_at) : NaN;
  if(!isFinite(ts)) return null;
  const hours = (Date.now() - ts) / 36e5;
  const days  = Math.floor(hours / 24);
  // pipeline ควรรัน 2 ครั้ง/วัน → เกิน 24 ชม. = พลาดไปแล้วอย่างน้อย 2 รอบ
  const level = hours < 24 ? 'fresh' : hours < 72 ? 'stale' : 'dead';
  const label = hours < 1  ? 'สดใหม่'
              : hours < 24 ? Math.floor(hours)+' ชม.ก่อน'
              : days === 1 ? 'เมื่อวาน'
              : 'ข้อมูล '+days+' วันก่อน';
  return { hours, days, generatedAt: new Date(ts), level, label,
           stats: (act && act.stats) || null };
}

// ผูกจุดสถานะกับอายุข้อมูลจริง — เขียว=สด / ส้ม=เริ่มเก่า / แดง=ตาย
// และ "หยุดกระพริบ" เมื่อไม่สดแล้ว เพราะการกระพริบคือสิ่งที่สื่อว่า live
function paintFreshnessDot(dotEl, textEl){
  const a = marketDataAge();
  if(!dotEl) return a;
  if(!a){
    dotEl.style.background = 'var(--muted)';
    dotEl.style.animation  = 'none';
    dotEl.title = 'ยังไม่มี market-data.json — pipeline ยังไม่เคยรันสำเร็จ';
    return null;
  }
  const COLOR = { fresh:'var(--income)', stale:'var(--debt)', dead:'var(--expense)' };
  dotEl.style.background = COLOR[a.level];
  dotEl.style.animation  = a.level === 'fresh' ? '' : 'none';
  const b = a.stats && a.stats.budget_exhausted
          ? ' · pipeline หมดเวลา ดึงไม่ครบ' : '';
  dotEl.title = 'ข้อมูล pipeline: ' + a.generatedAt.toLocaleString(LOC) + b;
  if(textEl && a.level !== 'fresh') textEl.title = dotEl.title;
  return a;
}

// ═══ v44 — HOLDING PRICES จาก pipeline (ช่องทางใหม่ แทนสูตรในชีต) ═══
// ปัญหาเดิม: ราคาพอร์ตมาจาก Asset_Live_Price_Feed ทางเดียว พอ IMPORTXML ขึ้น
// #N/A (หุ้นไทย 6 ตัว + Gold) → index.html นับสินทรัพย์นั้นเป็น ฿0 เงียบๆ
//
// สำคัญ: pipeline คืนราคาในสกุลที่ *ชีตบันทึกไว้* (ccy) ไม่ใช่สกุลตลาด
//   THB → ใช้ตรงๆ  |  USD → คูณ USDTHB
//
// staleness: Yahoo มีเคส "fetch สำเร็จแต่ข้อมูลค้าง" (พบจริงกับ ^SET.BK ที่
// updated ค้าง 26 วันโดยไม่ error) ซึ่งอันตรายกว่า error เพราะเงียบ
// จึงต้องเช็คอายุจาก `updated` (วันของราคา) ไม่ใช่ `generated_at` (เวลาที่รัน)
const PRICE_STALE_DAYS = 4;    // > นี้ = ติดธง stale แต่ยังใช้ได้
const PRICE_MAX_DAYS   = 12;   // > นี้ = ทิ้ง ไม่เอามาใช้เลย

// คืน { TICKER: {p, ccy, updated, ageDays, stale, src} } — p เป็น THB แล้ว
// หมายเหตุ: mdNum(key) รับ argument เดียวและเรียก loadMarketData() เอง
// (ห้ามส่ง md เข้าไปเป็นตัวแรก — จะกลายเป็น md.data[object] = undefined เงียบๆ)
function pipelinePricesTHB(staleDays){
  const act = loadActions();
  const src = act && act.prices;
  if(!src || typeof src !== 'object') return {};

  const fx = mdNum('USDTHB');
  const out = {};
  const today = Date.now();

  Object.entries(src).forEach(([tk, o])=>{
    if(!o || !(Number(o.price) > 0)) return;
    const ccy = o.ccy === 'THB' ? 'THB' : 'USD';
    // ไม่มี FX = แปลง USD ไม่ได้ → ข้ามเฉพาะตัว USD ตัว THB ยังใช้ได้
    if(ccy === 'USD' && !(fx > 0)) return;

    // BUGFIX v48 #2 — เดิมต่อ 'T00:00:00Z' ตายตัว ถ้า pipeline ส่ง ISO เต็ม
    // ('2026-08-21T13:05:00Z') จะได้ '…T13:05:00ZT00:00:00Z' = Invalid Date
    // แล้ว `if(!isFinite(t)) return;` จะทิ้งราคานั้นทั้งตัวโดยไม่มีสัญญาณเตือน
    const _u = o.updated ? String(o.updated).trim() : '';
    const t = _u ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(_u) ? _u+'T00:00:00Z' : _u) : NaN;
    if(!isFinite(t)) return;                       // ไม่รู้วัน = ไม่กล้าใช้
    const ageDays = (today - t) / 864e5;
    if(ageDays > PRICE_MAX_DAYS) return;           // เก่าเกินไป ทิ้ง

    out[tk] = {
      p: ccy === 'THB' ? Number(o.price) : Number(o.price) * fx,
      ccy, updated: o.updated,
      ageDays: Math.max(0, Math.round(ageDays)),
      stale: ageDays > (staleDays || PRICE_STALE_DAYS),
      src: o.src || 'pipeline',
    };
  });
  return out;
}

// ═══ v44 — LAST KNOWN PRICE: กันพอร์ตกระตุกเวลาไม่มีราคา ═══
// เดิมราคาหาไม่เจอ = นับเป็น ฿0 ทำให้ Value_Log แกว่ง ±14% วันเว้นวัน
// (ต่างกัน ~฿43,000 คือหุ้นไทย 6 ตัว + ทอง ที่หลุดสลับกันไปมา)
// การใช้ราคาล่าสุดที่รู้จึงถูกกว่าเสมอ — ฿0 ไม่ใช่ประมาณการที่ดี มันคือคำโกหก
const LKP_KEY = 'finOS_lastPrice';
function loadLastKnownPrices(){
  try{ return JSON.parse(localStorage.getItem(LKP_KEY)||'{}') || {}; }catch(e){ return {}; }
}
function saveLastKnownPrices(map){
  try{ localStorage.setItem(LKP_KEY, JSON.stringify(map)); }catch(e){}
}

// รวมทุกแหล่งเป็นแผนที่ราคาเดียว + บอกที่มาของทุก ticker
//   pipeline (สด) > ชีต > pipeline (stale) > ราคาล่าสุดที่จำไว้
// คืน { priceMap, srcMap }  โดย srcMap[tk] ∈ pipeline|sheet|stale|cached
function resolvePrices(sheetPriceMap){
  const priceMap = Object.assign({}, sheetPriceMap || {});
  const srcMap   = {};
  Object.keys(priceMap).forEach(t=>{ if(priceMap[t] > 0) srcMap[t] = 'sheet'; });

  const pp = pipelinePricesTHB();
  Object.entries(pp).forEach(([tk, o])=>{
    // ราคา stale ใช้เฉพาะเมื่อชีตไม่มีให้ — ชีตที่มีค่าจริงยังน่าเชื่อกว่าราคาค้าง
    if(o.stale && priceMap[tk] > 0) return;
    priceMap[tk] = o.p;
    srcMap[tk]   = o.stale ? 'stale' : 'pipeline';
  });

  const lkp = loadLastKnownPrices();
  Object.keys(lkp).forEach(tk=>{
    if(!(priceMap[tk] > 0) && lkp[tk] && lkp[tk].p > 0){
      priceMap[tk] = lkp[tk].p;
      srcMap[tk]   = 'cached';
    }
  });

  // จำราคาที่ "รู้จริง" รอบนี้ไว้ใช้คราวหน้า — ไม่จำค่าที่มาจาก cache เอง
  const today = new Date().toISOString().slice(0,10);
  Object.entries(priceMap).forEach(([tk, p])=>{
    if(p > 0 && srcMap[tk] !== 'cached') lkp[tk] = { p, d: today, src: srcMap[tk] };
  });
  saveLastKnownPrices(lkp);

  return { priceMap, srcMap };
}

// สรุปคุณภาพราคาให้ UI ใช้ — ไม่ต้องคำนวณซ้ำหลายที่
function priceQuality(srcMap, tickersHeld){
  const q = { pipeline:0, sheet:0, stale:0, cached:0, missing:[] };
  (tickersHeld||[]).forEach(tk=>{
    const s = srcMap[tk];
    if(s) q[s]++; else q.missing.push(tk);
  });
  q.degraded = q.stale + q.cached;      // ใช้ได้ แต่ไม่ใช่ราคาสด
  q.trustworthy = q.missing.length === 0;
  return q;
}

// ══════════════════════════════════════════════════════════════════════
// v44 — RECONCILIATION  (ชีต `Reconcile`)
// ══════════════════════════════════════════════════════════════════════
// ทำไมต้องมี: ยอดบัญชีใน dashboard คือ "ผลรวมของธุรกรรมที่กรอกมือ 12,337 แถว"
// ไม่ใช่ยอดจริง ระบบกรอกมือจะ drift แน่นอน (ลืมกรอก / กรอกซ้ำ / คอลัมน์ผิด /
// ดอกเบี้ย-ค่าธรรมเนียมที่ธนาคารหักเอง) แล้วไม่มีอะไรจับได้เลย
// พอผ่านไป 6 เดือน จะไม่รู้ว่า ฿3,568 ที่เห็นคือความจริงหรือ error สะสม
// และ Net Worth / Emergency fund / เป้าล้านแรก ยืนอยู่บนเลขนั้นทั้งหมด
//
// โครงชีต `Reconcile` (แถว 1 = header ภาษาอังกฤษ):
//   Date | Account | Actual_Balance | Note
//   2026-08-12 | SCB Bank      | 1155.75  | ตรง
//   2026-08-12 | Kasikorn Bank | 3980.00  | ลืมกรอกค่าน้ำ
//   ‣ Account ต้องสะกดตรงกับหัวคอลัมน์บัญชีในชีต Transaction แถว 2
//   ‣ กรอกทับได้เรื่อยๆ — ระบบใช้ "แถวล่าสุดต่อบัญชี" เท่านั้น
const RECON_STALE_DAYS = 10;   // เกินนี้ = เตือนว่าถึงเวลา reconcile

// แปลงแถวดิบจากชีตเป็น { account: {date, actual, note} } เอาแถวล่าสุดต่อบัญชี
// รับ rows แบบ array-of-array (header อยู่แถว 0) เหมือน sheet_to_json({header:1})
function parseReconcileRows(rows){
  if(!rows || !rows.length) return {};
  const H = (rows[0]||[]).map(h=>h==null?'':String(h).trim());
  const idx = n => H.findIndex(h=>h.toLowerCase()===n);
  const iD = idx('date'), iA = idx('account'),
        iB = H.findIndex(h=>/^actual_?balance$/i.test(h)), iN = idx('note');
  if(iA < 0 || iB < 0) return {};

  const out = {};
  for(let i=1;i<rows.length;i++){
    const r = rows[i]; if(!r) continue;
    const acc = r[iA]==null ? '' : String(r[iA]).trim();
    if(!acc) continue;
    const bal = parseFloat(r[iB]);
    if(!isFinite(bal)) continue;                 // ช่องว่าง/#N/A → ข้าม

    // วันที่: รับทั้ง Date, ISO string และ Google serial number
    let d = '';
    const raw = r[iD];
    if(raw instanceof Date) d = raw.toISOString().slice(0,10);
    // gserialToISO คืน ISO เต็ม ('2026-07-31T00:00:00.000Z') ต้องตัดเหลือ 10 ตัว
    // ไม่งั้นการเทียบ d >= prev.date จะข้ามฟอร์แมตกัน ('2026-07-31T…' vs '2026-08-01')
    else if(typeof raw === 'number' && raw > 20000) d = (gserialToISO(raw)||'').slice(0,10);
    else if(raw) d = String(raw).trim().slice(0,10);

    const prev = out[acc];
    if(!prev || (d && d >= prev.date)) out[acc] = { date:d, actual:bal,
      note: iN>=0 && r[iN] ? String(r[iN]).trim() : '' };
  }
  return out;
}

// เทียบยอดคำนวณ vs ยอดจริง → คืนรายการที่ต่างกัน + สถานะรวม
// tolerance: ต่างไม่เกิน 1 บาท = ถือว่าตรง (ปัดเศษ/ดอกเบี้ยเล็กน้อย)
function computeReconciliation(bals, reconMap, tolerance){
  const tol = tolerance == null ? 1 : tolerance;
  const map = reconMap || {};
  const accounts = [];
  let worstDate = null, unmatched = 0, totalDrift = 0;

  (bals||[]).forEach(b=>{
    const rec = map[b.name];
    if(!rec){ accounts.push({name:b.name, computed:b.balance, checked:false}); return; }
    const diff = rec.actual - b.balance;          // + = มีเงินมากกว่าที่บันทึก
    const ok = Math.abs(diff) <= tol;
    if(!ok){ unmatched++; totalDrift += Math.abs(diff); }
    if(rec.date && (!worstDate || rec.date < worstDate)) worstDate = rec.date;
    accounts.push({name:b.name, computed:b.balance, actual:rec.actual,
                   diff, ok, checked:true, date:rec.date, note:rec.note});
  });

  // BUGFIX v48 #3 — ชื่อบัญชีในชีต Reconcile ที่สะกดไม่ตรงกับหัวคอลัมน์ใน
  // Transaction จะถูกทิ้งเงียบ ผู้ใช้กรอกยอดจริงทุกสัปดาห์แล้วสงสัยว่าทำไม
  // หน้าจอยังบอก "ยังไม่เคย verify" — ต้องบอกให้เห็นว่าชื่อไหนจับคู่ไม่ได้
  const known = new Set((bals||[]).map(b=>b.name));
  const orphans = Object.keys(map).filter(n=>!known.has(n));

  const checked = accounts.filter(a=>a.checked);
  // อายุ = วันที่ reconcile "เก่าสุด" ในบรรดาบัญชีที่เคยเช็ค — ไม่ใช่ล่าสุด
  // เพราะเช็คแค่บัญชีเดียวเมื่อวานไม่ได้แปลว่าทั้งพอร์ตถูก verify แล้ว
  const ageDays = worstDate
    ? Math.floor((Date.now() - Date.parse(worstDate+'T00:00:00Z'))/864e5) : null;

  return {
    accounts,
    checkedCount: checked.length,
    totalCount: accounts.length,
    neverChecked: accounts.filter(a=>!a.checked).map(a=>a.name),
    unmatched, totalDrift, orphans,
    oldestDate: worstDate, ageDays,
    stale: ageDays == null || ageDays > RECON_STALE_DAYS,
    clean: checked.length > 0 && unmatched === 0,
  };
}

// ══════════════════════════════════════════════════════════════════════
// v46 — HOLDING LIFECYCLE  (engine ของหน้า Investment Analysis ใหม่)
// ══════════════════════════════════════════════════════════════════════
// เป้าหมาย: ตอบ "เงินก้อนไหนไม่มีใครดูแล" แทนที่จะเดาทิศทางตลาด
//
// บทเรียนจากการวิเคราะห์รอบแรกที่ผิด — เขียนไว้กันพลาดซ้ำ:
//  1) Transaction_Type มี 4 ค่า: Buy / Sell / Dividend Payout / Split
//     ห้ามใช้ `startswith('buy') ? ... : ขาย` เด็ดขาด เพราะปันผล 114 รายการ
//     จะถูกนับเป็นการขายแล้วหักจำนวนหุ้นทิ้ง (net qty ติดลบ ของหายจากพอร์ต)
//  2) ความสม่ำเสมอต้องวัดด้วย median + MAD ไม่ใช่ mean + stdev
//     DCA รายวัน (BTC 168 ครั้ง) มีวันหยุดยาวแทรก → stdev พุ่ง → CV 4.21
//     ทั้งที่เป็นการซื้อที่มีวินัยที่สุดในพอร์ต  robust CV ให้ 0.00 ถูกต้อง
const DORMANT_DAYS = 180;      // ไม่ซื้อเกินนี้ = หลุดจากเรดาร์
const REGULAR_RCV  = 0.6;      // robust CV ต่ำกว่านี้ = ซื้อเป็นจังหวะสม่ำเสมอ

function _median(a){
  if(!a.length) return 0;
  const s=[...a].sort((x,y)=>x-y), m=s.length>>1;
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}
// robust CV = MAD / median — ทนต่อช่องว่างผิดปกติ (วันหยุดยาว, เดือนที่ข้าม)
function cadenceRCV(dates){
  if(dates.length<2) return {median:0, rcv:9, gaps:0};
  const d=[...dates].sort();
  const gaps=[];
  for(let i=1;i<d.length;i++) gaps.push((d[i]-d[i-1])/864e5);
  const med=_median(gaps);
  if(med<=0) return {median:0, rcv:0, gaps:gaps.length};   // ซื้อวันเดียวกันหลายครั้ง
  const mad=_median(gaps.map(g=>Math.abs(g-med)));
  return {median:med, rcv:mad/med, gaps:gaps.length};
}

// ── แท็กที่ผู้ใช้กำหนดเอง: 'core' = ตั้งใจถือ ไม่ต้องเตือน ──
const HTAG_KEY='finOS_holdingTags';
function loadHoldingTags(){
  try{ return JSON.parse(localStorage.getItem(HTAG_KEY)||'{}')||{}; }catch(e){ return {}; }
}
function setHoldingTag(ticker, tag){
  const t=loadHoldingTags();
  if(tag) t[ticker]={tag, at:new Date().toISOString().slice(0,10)};
  else delete t[ticker];
  try{ localStorage.setItem(HTAG_KEY, JSON.stringify(t)); }catch(e){}
  return t;
}

// จัดกลุ่มสินทรัพย์ที่ยังถืออยู่ ตามพฤติกรรมการซื้อจริง
//   trades: [{date:Date, type:'Buy'|'Sell'|'Dividend Payout'|'Split',
//             ticker, qty, thb}]
//   assets: [{ticker, qty, val, cost, ...}] จาก dashboard
// คืน { active:[], dormant:[], intentional:[], stats:{} }
function classifyHoldings(trades, assets, priceSrc){
  const byT={};
  (trades||[]).forEach(t=>{
    if(!t.ticker || !(t.date instanceof Date) || isNaN(t.date)) return;
    const k=t.ticker;
    (byT[k] = byT[k] || {buys:[], sells:0, div:0, cost:0}); 
    const tt=String(t.type||'').trim();
    if(tt==='Buy'){ byT[k].buys.push(t.date.getTime()); byT[k].cost += (t.thb||0); }
    else if(tt==='Sell'){ byT[k].sells++; byT[k].cost -= (t.thb||0); }
    else if(tt==='Dividend Payout'){ byT[k].div += (t.thb||0); }
    // Split ไม่กระทบต้นทุนและไม่ใช่สัญญาณความสนใจ → ข้าม
  });

  const tags=loadHoldingTags();
  const now=Date.now();
  const out={active:[], dormant:[], intentional:[], stats:{}};

  (assets||[]).forEach(a=>{
    if(!(a.qty>1e-8)) return;                     // ขายหมดแล้ว ไม่ต้องพูดถึง
    const h=byT[a.ticker]||{buys:[],sells:0,div:0,cost:0};
    const cad=cadenceRCV(h.buys);
    const lastBuy=h.buys.length?Math.max(...h.buys):null;
    const ageDays=lastBuy?Math.floor((now-lastBuy)/864e5):null;
    const cost=h.cost>0?h.cost:(a.cost||0);
    const val=a.val>0?a.val:null;                  // null = ไม่มีราคา
    const row={
      ticker:a.ticker, label:a.label||a.ticker, type:a.assetType||a.type||'',
      qty:a.qty, cost, val,
      pl: val!=null ? val-cost : null,
      plPct: (val!=null && cost>0) ? (val-cost)/cost*100 : null,
      div:h.div, buys:h.buys.length, sells:h.sells,
      medianGap:Math.round(cad.median), rcv:cad.rcv,
      regular: h.buys.length>=4 && cad.rcv<=REGULAR_RCV,
      ageDays, lastBuy: lastBuy? new Date(lastBuy).toISOString().slice(0,10):null,
      unpriced: val==null,
      priceSrc: (priceSrc||{})[a.ticker]||null,
      tag: tags[a.ticker]?tags[a.ticker].tag:null,
    };
    if(row.tag==='core')                      out.intentional.push(row);
    else if(ageDays!=null && ageDays>DORMANT_DAYS) out.dormant.push(row);
    else                                      out.active.push(row);
  });

  const sum=(arr,f)=>arr.reduce((s,r)=>s+(f(r)||0),0);
  // เทียบ P&L เฉพาะตัวที่มีราคา — ไม่งั้นเอาต้นทุนเต็มไปหารกับมูลค่าบางส่วน
  const priced=arr=>arr.filter(r=>!r.unpriced);
  const grp=arr=>({
    n:arr.length, cost:sum(arr,r=>r.cost), div:sum(arr,r=>r.div),
    unpricedN: arr.filter(r=>r.unpriced).length,
    unpricedCost: sum(arr.filter(r=>r.unpriced), r=>r.cost),
    pricedCost: sum(priced(arr),r=>r.cost), val: sum(priced(arr),r=>r.val),
    get pl(){ return this.val-this.pricedCost; },
    get plPct(){ return this.pricedCost>0 ? (this.val-this.pricedCost)/this.pricedCost*100 : null; },
  });
  out.stats={ active:grp(out.active), dormant:grp(out.dormant),
              intentional:grp(out.intentional) };
  const bySize=(a,b)=>(b.cost||0)-(a.cost||0);
  out.active.sort(bySize); out.dormant.sort(bySize); out.intentional.sort(bySize);
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// v47 — PLATFORM ALLOCATION: กระจายมูลค่าตาม platform ที่ถือจริง
// ══════════════════════════════════════════════════════════════════════
// บั๊กเดิม: platMap เป็น { ticker: platform } ค่าเดียว สร้างด้วย
//   sort(by date).forEach(r => platMap[r.ticker] = r.platform)
// = platform ของการซื้อครั้งล่าสุดเขียนทับทุกครั้งก่อนหน้า
//
// ผลจริงที่ผู้ใช้เจอ: BNB ซื้อที่ Binance_Global_Spot (2023) แล้วซื้อที่
// Binance_TH_Spot ทีหลัง → มูลค่า BNB ทั้งก้อนไปกองที่ Binance_TH_Spot
// และ Binance_Global_Spot หายไปจากหน้า Asset Location ทั้ง platform
// (ไม่ใช่หายบางส่วน — หายหมด เพราะไม่มี ticker ไหนเหลือค่านั้นเป็นค่าสุดท้าย)
//
// ทำไมเรื่องนี้สำคัญกว่าความสวยงาม: ตัวเลข exposure ต่อ exchange ใช้ประเมิน
// counterparty risk ถ้า exchange ล่ม/ถูกระงับ ต้องรู้ว่ามีเงินอยู่ที่นั่นเท่าไหร่
// การรวมสอง exchange เป็นที่เดียวทำให้ประเมินความเสี่ยงผิดโดยสิ้นเชิง
//
// วิธีใหม่: นับจำนวนหน่วยคงเหลือแยกตาม (ticker, platform) แล้วแบ่งมูลค่า
// ปัจจุบันตามสัดส่วนหน่วย — ถูกต้องเพราะหน่วยเดียวกันมีราคาเดียวกัน
// ไม่ว่าถืออยู่ที่ไหน

// คืน { ticker: { platform: qty } } — เฉพาะที่คงเหลือ > 0
function qtyByPlatform(tracker){
  const acc = {};
  (tracker||[]).forEach(r=>{
    if(!r || !r.ticker) return;
    const tt = String(r.txType||'').trim();
    const plat = r.platform || 'Unknown';
    const q = Number(r.qty)||0;
    if(!q) return;
    (acc[r.ticker] = acc[r.ticker] || {});
    // Buy/Split เพิ่มหน่วย · Sell ลด · Dividend Payout ไม่กระทบหน่วย
    if(tt==='Buy' || tt==='Split')      acc[r.ticker][plat] = (acc[r.ticker][plat]||0) + q;
    else if(tt==='Sell')                acc[r.ticker][plat] = (acc[r.ticker][plat]||0) - q;
  });

  // ปัดเศษลบเป็น 0 — เกิดได้เมื่อขายจากที่หนึ่งแต่บันทึก platform เป็นอีกที่
  // (เช่นโอนเหรียญข้าม exchange แล้วขาย) กรณีนี้ไม่พยายามเดา แต่ไม่ให้ติดลบ
  Object.keys(acc).forEach(t=>{
    Object.keys(acc[t]).forEach(p=>{
      if(acc[t][p] < 1e-9) delete acc[t][p];
    });
  });
  return acc;
}

// แบ่งมูลค่าปัจจุบันของแต่ละ asset ตามสัดส่วนหน่วยที่ถือในแต่ละ platform
// คืน [{group, platform, val, cost, tickers:[]}] พร้อมใช้กับ UI
function allocateByPlatform(tracker, assets){
  const qbp = qtyByPlatform(tracker);
  const out = [];
  (assets||[]).forEach(a=>{
    const per = qbp[a.ticker] || {};
    const tot = Object.values(per).reduce((s,q)=>s+q, 0);
    if(tot <= 0){
      // ไม่มีข้อมูลรายที่ → ใช้ค่าเดิมจาก platMap เพื่อไม่ให้ข้อมูลหาย
      out.push({group:a.group, platform:a.platform||'Unknown',
                ticker:a.ticker, val:a.val||0, cost:a.cost||0, share:1, exact:false});
      return;
    }
    Object.entries(per).forEach(([plat,q])=>{
      const share = q/tot;
      out.push({group:a.group, platform:plat, ticker:a.ticker,
                val:(a.val||0)*share, cost:(a.cost||0)*share,
                qty:q, share, exact:true});
    });
  });
  return out;
}

// platform ที่ถือมากที่สุดของ ticker — ใช้แทน platMap เดิมในที่ที่ต้องการค่าเดียว
function dominantPlatform(tracker, ticker){
  const per = (qtyByPlatform(tracker)[ticker])||{};
  let best=null, bq=-1;
  Object.entries(per).forEach(([p,q])=>{ if(q>bq){ bq=q; best=p; } });
  return best;
}

// ═══ Method 2 — external API layer (alternative.me + CoinGecko) ═══
const EXT_TTL = 10*60e3;
function loadExt(){ try{ return JSON.parse(localStorage.getItem('finOS_ext')||'null'); }catch(e){ return null; } }
async function fetchExternalData(force){
  const cached = loadExt();
  if(!force && cached && Date.now()-cached.savedAt < EXT_TTL) return cached;
  const out = { savedAt: Date.now(), fng: cached?.fng||null, prices: cached?.prices||null };
  try{
    const r = await fetch('https://api.alternative.me/fng/?limit=365');
    const j = await r.json();
    if(j && j.data && j.data.length){
      out.fng = { value:+j.data[0].value, cls:j.data[0].value_classification,
                  history: j.data.map(d=>({t:+d.timestamp*1000, v:+d.value})).reverse() };
    }
  }catch(e){ console.warn('[Ext] alternative.me:', e.message); }
  try{
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,thb&include_24hr_change=true');
    const j = await r.json();
    if(j && j.bitcoin) out.prices = { BTCUSD:{v:j.bitcoin.usd, chg:j.bitcoin.usd_24h_change, thb:j.bitcoin.thb},
                                      ETHUSD:{v:j.ethereum?.usd, chg:j.ethereum?.usd_24h_change, thb:j.ethereum?.thb} };
  }catch(e){ console.warn('[Ext] coingecko:', e.message); }
  localStorage.setItem('finOS_ext', JSON.stringify(out));
  return out;
}
// ราคา crypto จาก CoinGecko สดกว่าชีต → override ก่อน render (พร้อมระบุที่มา)
function mergeExtIntoMarket(md){
  const ext = loadExt();
  if(!ext || !ext.prices || !md || !md.data) return md;
  ['BTCUSD','ETHUSD'].forEach(k=>{
    const p = ext.prices[k];
    if(p && p.v){ md.data[k] = { value:p.v, updated:new Date(ext.savedAt).toISOString(),
      note:'CoinGecko'+(p.chg!=null?` · ${p.chg>=0?'+':''}${p.chg.toFixed(1)}% 24h`:'') }; }
  });
  return md;
}

// ═══ ALLOC_META + CASH_TARGET ═══
const ALLOC_META = {
  'US Stock':       {label:'US Stocks',    color:'#00d4a0', target:25},
  'Mutual Fund':    {label:'Mutual Fund',  color:'#7c6fec', target:15},
  'Gold':           {label:'Gold',         color:'#ffd166', target:13},
  'Thai Stock':     {label:'Thai Stocks',  color:'#4cc9f0', target:10},
  'Crypto':         {label:'Crypto',       color:'#ff9500', target:5},
  // v45 — illiquid: ขายไม่ได้จนออกจากงาน จึง rebalance ไม่ได้
  // ผู้ใช้ถือ ~30% ของพอร์ตในกองนี้ ขณะที่ target = 5%
  // ถ้านับรวมในฐานคำนวณ deviation จะบอกว่า "ขาย Provident Fund 21 จุด"
  // ซึ่งเป็นคำแนะนำที่ทำตามไม่ได้ และมันดันให้ทุกกองอื่นดู under-weight
  // ทั้งที่ความจริงคือสัดส่วนของ "เงินที่คุมได้" อาจตรงเป้าอยู่แล้ว
  'Provident Fund': {label:'Provident Fund',color:'#ffa94d',target:5, illiquid:true},
  'Other':          {label:'Other',        color:'#5a5a8a', target:2},
};
const CASH_TARGET = 25; // default เท่านั้น — ค่าจริงมาจาก getTargets()
// #16 — กองอื่นรวมกัน 75% (25+15+13+10+5+5+2) ดังนั้น cash ต้อง 25 ให้ครบ 100
//       เดิมตั้ง 22 ทำให้ default รวมได้แค่ 97%

// ═══ getTargets — เป้า allocation ของผู้ใช้ ═══
function getTargets(){
  const def = {}; Object.keys(ALLOC_META).forEach(k=>def[k]=ALLOC_META[k].target);
  def['Cash'] = CASH_TARGET;
  try{ const s = JSON.parse(localStorage.getItem('finOS_targets')||'null');
       if(s && typeof s==='object') return {...def, ...s}; }catch(e){}
  return def;
}

// ═══ computeDeviations — ตัวคำนวณกลาง Alerts/Allocation ═══
// v45 — คิด deviation บนฐาน "เงินที่ rebalance ได้จริง" (ตัด illiquid ออก)
// เหตุผล: target มีความหมายเฉพาะกับเงินที่คุณสั่งซื้อ-ขายได้ Provident Fund
// ถอนไม่ได้จนออกจากงาน จึงไม่ควรอยู่ในสมการ ไม่ว่าจะ over หรือ under เป้า
// คืน illiquid แยกไว้ให้ UI แสดงเป็นข้อมูลประกอบ ไม่ใช่รายการที่ต้องแก้
function computeDeviations(real){
  const targets = getTargets();
  const cashBal = real.cashBalance||0;
  const alloc = real.allocation||{};

  // แยกกองที่ขายไม่ได้ออกก่อน
  const illiquid = [];
  let illiquidVal = 0;
  Object.entries(alloc).forEach(([k,v])=>{
    if(ALLOC_META[k]?.illiquid && v.value>0){
      illiquid.push({key:k, label:ALLOC_META[k].label||k, value:v.value,
                     color:ALLOC_META[k].color||'#8080b0'});
      illiquidVal += v.value;
    }
  });

  const grossVal    = (real.totalValue||0)+cashBal;          // ทั้งพอร์ต+เงินสด
  const totalVal    = grossVal - illiquidVal;                 // ฐานที่ rebalance ได้
  if(totalVal<=0) return {list:[], totalVal:0, grossVal, illiquid, illiquidVal,
                          illiquidPct: grossVal>0 ? illiquidVal/grossVal*100 : 0};

  // target ของกอง illiquid ต้องถูกกระจายคืนให้กองที่เหลือ ไม่งั้นผลรวม target < 100
  const illiquidTargetSum = illiquid.reduce((sum,i)=>sum+(targets[i.key]||0), 0);
  const liquidTargetSum = Object.entries(targets)
    .filter(([k])=>!ALLOC_META[k]?.illiquid)
    .reduce((sum,[,t])=>sum+t, 0);
  const scale = liquidTargetSum>0 ? (liquidTargetSum+illiquidTargetSum)/liquidTargetSum : 1;

  const cur={};
  Object.entries(alloc).forEach(([k,v])=>{
    if(ALLOC_META[k]?.illiquid) return;
    if(v.value>0) cur[k]=v.value/totalVal*100;
  });
  cur['Cash']=cashBal/totalVal*100;

  const list=[];
  new Set([...Object.keys(cur),...Object.keys(targets)]).forEach(k=>{
    if(ALLOC_META[k]?.illiquid) return;
    const c=cur[k]||0, t=(targets[k]??0)*scale;
    if(t<=0 && c<=0) return;
    list.push({key:k, label:ALLOC_META[k]?.label||k, cur:c, target:t,
               diff:c-t, amt:Math.round(Math.abs(c-t)/100*totalVal),
               color:ALLOC_META[k]?.color||'#8080b0'});
  });
  list.sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff));
  return {list, totalVal, grossVal, illiquid, illiquidVal,
          illiquidPct: grossVal>0 ? illiquidVal/grossVal*100 : 0};
}

// ═══ Market bridge — ชีต → localStorage (ทั้ง Excel และ Sheets sync) ═══
function gserialToISO(v){
  // Google/Excel serial date → ISO string (25569 = 1970-01-01)
  if(typeof v==='number' && v>25569 && v<80000) return new Date((v-25569)*86400e3).toISOString();
  if(typeof v==='string' && v.trim()) return v.trim();
  return null;
}
function saveMarketData(rows){
  try{
    if(!rows || rows.length<2) return;
    const h=(rows[0]||[]).map(x=>x?String(x).trim():'');
    const ki=h.indexOf('Key'), vi=h.indexOf('Value'), ui=h.indexOf('Updated'), ni=h.indexOf('Note');
    if(ki<0||vi<0){console.log('[Market] header ต้องมี Key, Value');return;}
    const data={};
    for(const r of rows.slice(1)){
      if(!r || !r[ki]) continue;
      const key=String(r[ki]).trim(); if(!key) continue;
      let val=r[vi];
      if(typeof val==='string' && val.trim()!=='' && !isNaN(parseFloat(val))) val=parseFloat(val);
      // กันค่าพังจากชีต: #N/A, #REF!, #ERROR! → ถือว่า "ไม่มีข้อมูล" ไม่เก็บเข้าระบบ
      // (เดิมค่าพวกนี้ไหลเข้าไปแล้วโผล่บนการ์ดเป็น "$NaN")
      if(typeof val==='string' && /^#|N\/A|^\s*$/i.test(val.trim())) continue;
      if(typeof val==='number' && !isFinite(val)) continue;
      data[key]={ value:val,
                  updated: ui>=0 ? gserialToISO(r[ui]) : null,
                  note:    ni>=0 && r[ni] ? String(r[ni]).trim() : '' };
    }
    if(!Object.keys(data).length) return;
    localStorage.setItem('finOS_market', JSON.stringify({savedAt:Date.now(), data}));
    console.log('[Market] saved', Object.keys(data).length, 'keys');
  }catch(e){console.warn('[Market] save failed:', e.message);}
}

// ═══ Value_Log — ประวัติมูลค่าพอร์ตรายวันจากชีต (Apps Script เขียนทุกเช้า) ═══
// merge เข้า finOS_valueLog: ชีตอุดวันที่โหว่ / วันซ้ำค่าในเครื่องชนะ (convention เดียวกับ restore)
function mergeValueLogFromSheet(rows){
  try{
    if(!rows || rows.length < 2) return 0;
    const h = (rows[0]||[]).map(x=>x?String(x).trim():'');
    const di = h.indexOf('Date'), vi = h.indexOf('Portfolio_Value');
    if(di < 0 || vi < 0) return 0;
    const byDate = {};
    rows.slice(1).forEach(r=>{
      if(!r || r[di]==null || r[vi]==null || r[vi]==='') return;
      const iso = gserialToISO(r[di]); if(!iso) return;
      const v = parseFloat(r[vi]); if(!(v > 0)) return;
      byDate[String(iso).slice(0,10)] = { d: String(iso).slice(0,10), v: Math.round(v) };
    });
    const cur = JSON.parse(localStorage.getItem('finOS_valueLog')||'[]');
    cur.forEach(e=>{ if(e && e.d) byDate[e.d] = e; });   // local ชนะวันซ้ำ
    const merged = Object.values(byDate).sort((a,b)=>a.d.localeCompare(b.d)).slice(-730);
    localStorage.setItem('finOS_valueLog', JSON.stringify(merged));
    console.log('[ValueLog] merged from sheet →', merged.length, 'days');
    return merged.length;
  }catch(e){ console.warn('[ValueLog] merge failed:', e.message); return 0; }
}

// ═══ Benchmark simulation — "ถ้าเงินก้อนเดียวกันเข้า S&P 500 แทน" ═══
// จำลอง cashflow เดิมทุกรายการซื้อ/ขาย ^GSPC ณ ราคาสัปดาห์นั้น (แปลงเป็นบาทด้วย
// USD/THB ณ วันเดียวกัน — FX คือส่วนหนึ่งของผลตอบแทนจริงของนักลงทุนไทย)
function priceAt(series, tMs){
  // series = [[iso, price]] เรียงเก่า→ใหม่ · คืนราคาล่าสุดที่ไม่เกินวันนั้น
  // #24 — ถ้า tMs เก่ากว่าจุดแรกของ series ต้องคืน null ไม่ใช่ราคาจุดแรก
  // (history ครอบคลุม 5 ปี ธุรกรรมเก่ากว่านั้นเคยได้ราคาผิดยุคไปเงียบๆ
  //  ทำให้ units ที่จำลองผิด → benchmark XIRR เพี้ยนโดยไม่มีสัญญาณเตือน)
  if(!series || !series.length) return null;
  if(Date.parse(series[0][0]) > tMs) return null;   // ก่อนช่วงข้อมูล → ไม่รู้ราคา
  let best = null;
  for(let i=0;i<series.length;i++){
    if(Date.parse(series[i][0]) <= tMs) best = series[i][1];
    else break;
  }
  return best;
}
// คืน {rate, terminal, asOf} เมื่อสำเร็จ · คืน {error, ...} เมื่อทำไม่ได้ (UI จะได้บอกเหตุผลจริง)
function benchmarkXIRR(flows){
  const act = loadActions();
  const h = act && act.history;
  if(!h || !h.SP500 || h.SP500.length<10 || !h.USDTHB || !h.USDTHB.length)
    return { error:'no_history' };
  // #24 — ธุรกรรมที่เก่ากว่าจุดเริ่มของ history จำลองไม่ได้ ต้องบอกให้ชัด
  // ไม่ใช่เงียบแล้วใช้ราคาผิดยุค
  const covFrom = h.SP500[0][0], fxFrom = h.USDTHB[0][0];
  const startT = Math.max(Date.parse(covFrom), Date.parse(fxFrom));
  const tooOld = flows.filter(f => f.t < startT);
  if(tooOld.length){
    const earliest = new Date(Math.min(...tooOld.map(f=>f.t))).toISOString().slice(0,10);
    return { error:'out_of_range', coverageFrom: covFrom > fxFrom ? covFrom : fxFrom,
             earliestFlow: earliest, nOutside: tooOld.length, nTotal: flows.length };
  }
  let units = 0;
  for(const f of flows){
    const px = priceAt(h.SP500, f.t), fx = priceAt(h.USDTHB, f.t);
    if(!px || !fx) return { error:'gap', at:new Date(f.t).toISOString().slice(0,10) };
    units += (-f.v) / (px * fx);   // ซื้อ (cf<0) → units เพิ่ม · ถอน/ปันผล (cf>0) → units ลด
  }
  // terminal = ราคา ณ วันนี้ (ไม่ใช่แถวสุดท้ายของ series — กันกรณีข้อมูลลากเกินวันนี้)
  const nowT = Date.now();
  const lastPx = priceAt(h.SP500, nowT);
  const lastFx = priceAt(h.USDTHB, nowT);
  const terminal = Math.max(0, units) * lastPx * lastFx;
  const r = xirrJS([...flows, {t: nowT, v: terminal}]);
  let asOf = h.SP500[0][0];
  for(const [d] of h.SP500){ if(Date.parse(d) <= nowT) asOf = d; else break; }
  return r===null ? { error:'xirr_no_solution' } : { rate:r, terminal, asOf };
}

// ═══ WEALTH GOAL CONFIG — แหล่งเดียวของเป้าหมาย (ทุกหน้าต้องอ่านจากที่นี่) ═══
// เดิมเป้าหมายกระจายอยู่ 3 ที่และไม่ตรงกัน (Overview ฿3M / Wealth Engine ฿1M /
// อีเมล Apps Script ฿1M) → ทำให้ progress ที่แสดงขัดกันเอง แก้โดยรวมมาที่นี่
const GOAL_DEFAULT = {
  final: 3000000,               // เป้าหมายปลายทาง (Net Worth)
  milestones: [1000000, 2000000, 3000000],
  expectedReturn: 7,            // %/ปี ที่ใช้ในการฉายภาพ (ตรงกับ default ปุ่มใน Overview)
};
function getGoalCfg(){
  try{
    const s = JSON.parse(localStorage.getItem('finOS_goalCfg')||'null');
    if(s && typeof s==='object') return {...GOAL_DEFAULT, ...s};
  }catch(e){}
  return {...GOAL_DEFAULT};
}
function saveGoalCfg(cfg){
  localStorage.setItem('finOS_goalCfg', JSON.stringify({...getGoalCfg(), ...cfg}));
}
// milestone ถัดไปที่ยังไม่ถึง (ใช้บอก "อีกไกลแค่ไหนถึงหมุดหมายหน้า")
function nextMilestone(netWorth){
  const cfg = getGoalCfg();
  return cfg.milestones.find(m => netWorth < m) ?? cfg.final;
}

// ═══ feeToAdd — commission ที่ยังไม่ถูกรวมใน Total_Amout_THB ═══════
// ชีตต้นทางไม่สม่ำเสมอ: บางแถวใส่ค่าธรรมเนียมไว้ในยอดรวมแล้ว บางแถวไม่ใส่
// เทียบกับ base = qty×price×fx เพื่อตัดสินรายแถว — กัน double-count
function feeToAdd(amtTHB, qty, price, fx, comm){
  const c = Math.abs(comm||0);
  if(!(c > 0)) return 0;
  const base = Math.abs(qty||0) * Math.abs(price||0) * Math.abs(fx||1);
  if(!(base > 0)) return c;                       // ไม่มี base ให้เทียบ → ถือว่ายังไม่รวม
  const gap = Math.abs(amtTHB||0) - base;
  const already = Math.abs(gap - c) <= Math.max(0.02, c*0.05);
  return already ? 0 : c;
}

// ═══ REGIME ENGINE — บทวิเคราะห์ที่คำนวณจากข้อมูลสด ไม่ใช่ข้อความ hardcode ═══
// รับสัญญาณจาก market data (ชีต + pipeline FRED/Yahoo + CoinGecko) แล้วให้คะแนน
// แต่ละตัว -2..+2 → รวมเป็น regime + posture + คำอธิบายที่อ้างตัวเลขจริงทุกคำ
function mdNum(key){
  const md = loadMarketData();
  const d = md && md.data && md.data[key];
  if(!d) return null;
  const n = Number(d.value);
  return isFinite(n) ? n : null;
}
function mdStr(key){
  const md = loadMarketData();
  const d = md && md.data && md.data[key];
  return d && d.value!=null ? String(d.value) : null;
}
function mdAsOf(key){
  const md = loadMarketData();
  const d = md && md.data && md.data[key];
  return d && d.updated ? String(d.updated).slice(0,10) : null;
}

function computeRegime(){
  const sig = [];
  const push = (o) => { if(o) sig.push(o); };

  // 1) เงินเฟ้อ — เทียบเป้า Fed 2%
  const cpi = mdNum('US_CPI');
  if(cpi!=null) push({key:'cpi', label:'เงินเฟ้อ US (CPI YoY)', val:cpi.toFixed(1)+'%',
    score: cpi>=4?-2 : cpi>=3?-1 : cpi>=2.5?0 : cpi>=1.5?1 : 0,
    note: cpi>=3?'สูงกว่าเป้า 2% มาก — จำกัดพื้นที่ผ่อนคลายนโยบาย'
        : cpi>=2.5?'ยังเหนือเป้าเล็กน้อย' : 'ใกล้เป้า Fed', asOf: mdAsOf('US_CPI')});

  // 2) นโยบายการเงิน — เทียบ neutral rate ~3%
  const fed = mdNum('FED_RATE');
  if(fed!=null) push({key:'fed', label:'Fed Funds Rate', val:fed.toFixed(2)+'%',
    score: fed>=5?-2 : fed>=4?-1 : fed>=3?0 : 1,
    note: fed>=4?'ตึงตัวกว่า neutral — กดดัน valuation'
        : fed>=3?'ใกล้ neutral' : 'ผ่อนคลาย หนุนสินทรัพย์เสี่ยง', asOf: mdAsOf('FED_RATE')});

  // 3) Yield curve 2s10s — inverted = สัญญาณ recession คลาสสิก
  const yc = mdNum('YIELD_CURVE');
  if(yc!=null) push({key:'curve', label:'Yield Curve 2s10s', val:(yc>=0?'+':'')+yc.toFixed(0)+'bps',
    score: yc<-50?-2 : yc<0?-1 : yc<25?0 : 1,
    note: yc<0?'inverted — สัญญาณเตือน recession'
        : yc<25?'แบนราบ — วัฏจักรปลายทาง' : 'ชันขึ้น — คลายสัญญาณ recession', asOf: mdAsOf('YIELD_CURVE')});

  // 4) ความผันผวน
  const vix = mdNum('VIX');
  if(vix!=null) push({key:'vix', label:'VIX', val:vix.toFixed(1),
    score: vix>=30?-2 : vix>=22?-1 : vix>=15?1 : 0,
    note: vix>=30?'ตลาดตื่นตระหนก' : vix>=22?'ความกังวลสูงขึ้น'
        : vix>=15?'สงบ ปกติ' : 'สงบมาก — ระวังความประมาท', asOf: mdAsOf('VIX')});

  // 5) เทรนด์ US — MA200 + RSI
  const ma = mdStr('SP500_MA200'), rsi = mdNum('SP500_RSI');
  if(ma) push({key:'trend', label:'S&P vs MA200', val:ma,
    score: /above/i.test(ma)?1:-1,
    note: /above/i.test(ma)?'เทรนด์ขาขึ้นยังไม่หัก':'หลุดเทรนด์ยาว — โหมดระวัง', asOf: mdAsOf('SP500_MA200')});
  if(rsi!=null) push({key:'rsi', label:'S&P RSI(14)', val:rsi.toFixed(0),
    score: rsi>=75?-1 : rsi>=60?1 : rsi>=40?0 : rsi>=25?-1 : 1,
    note: rsi>=75?'overbought — เสี่ยงพักฐาน' : rsi>=60?'โมเมนตัมดี'
        : rsi>=40?'กลางๆ' : rsi>=25?'อ่อนแรง' : 'oversold — โซนที่ historically คุ้มเสี่ยง',
    asOf: mdAsOf('SP500_RSI')});

  // 6) เครดิต — วัดความเครียดระบบการเงิน
  const cs = mdNum('CREDIT_SPREAD');
  if(cs!=null) push({key:'credit', label:'Credit Spread (HY OAS)', val:cs.toFixed(2)+'%',
    score: cs>=6?-2 : cs>=4.5?-1 : cs>=3?0 : 1,
    note: cs>=4.5?'ตลาดเครดิตเริ่มเครียด' : cs>=3?'ปกติ' : 'ผ่อนคลาย — ความเสี่ยงถูกประเมินต่ำ',
    asOf: mdAsOf('CREDIT_SPREAD')});

  // 7) ตลาดไทย
  const smt = mdStr('SET_MA200'), srsi = mdNum('SET_RSI');
  if(smt) push({key:'th', label:'SET vs MA200', val:smt, score:/above/i.test(smt)?1:-1,
    note:/above/i.test(smt)?'SET อยู่ในเทรนด์ขาขึ้น':'SET ยังต่ำกว่าเทรนด์ยาว', asOf: mdAsOf('SET_MA200')});
  if(srsi!=null) push({key:'thrsi', label:'SET RSI(14)', val:srsi.toFixed(0),
    score: srsi>=75?-1 : srsi>=60?1 : srsi>=40?0 : -1,
    note: srsi>=75?'ร้อนแรงเกิน' : srsi>=60?'โมเมนตัมดี' : srsi>=40?'กลางๆ':'อ่อนแรง',
    asOf: mdAsOf('SET_RSI')});

  // 8) Core inflation — ตัวที่ Fed ดูจริง (sticky กว่า headline)
  const core = mdNum('US_CORE_PCE') ?? mdNum('US_CORE_CPI');
  if(core!=null) push({key:'core', label:'Core inflation', val:core.toFixed(1)+'%',
    score: core>=3.5?-2 : core>=2.8?-1 : core>=2.2?0 : 1,
    note: core>=2.8?'core ยังหนืด — Fed ผ่อนคลายยาก' : 'core เข้าใกล้เป้า',
    asOf: mdAsOf('US_CORE_PCE')||mdAsOf('US_CORE_CPI')});

  // 9) ตลาดแรงงาน — เย็นเกินไป = สัญญาณ recession
  const un = mdNum('US_UNEMP');
  if(un!=null) push({key:'unemp', label:'US Unemployment', val:un.toFixed(1)+'%',
    score: un>=5?-2 : un>=4.5?-1 : un>=3.5?1 : 0,
    note: un>=4.5?'ว่างงานสูงขึ้น — อุปสงค์อ่อน' : un>=3.5?'ตลาดแรงงานแข็งแรง':'ตึงตัวมาก',
    asOf: mdAsOf('US_UNEMP')});

  // 10) Real yield — ต้นทุนเงินจริงหลังหักเงินเฟ้อ
  const rr = mdNum('US_REAL10Y');
  if(rr!=null) push({key:'real', label:'Real 10Y (TIPS)', val:rr.toFixed(2)+'%',
    score: rr>=2.5?-2 : rr>=1.8?-1 : rr>=0.5?0 : 1,
    note: rr>=1.8?'ต้นทุนเงินจริงสูง — กดดันสินทรัพย์เสี่ยง' : 'ต้นทุนเงินจริงไม่ตึง',
    asOf: mdAsOf('US_REAL10Y')});

  // 11) น้ำมัน — ตัวส่งผ่านเข้าเงินเฟ้อ
  const oil = mdNum('OIL_WTI');
  if(oil!=null) push({key:'oil', label:'WTI Crude', val:'$'+oil.toFixed(0),
    score: oil>=100?-2 : oil>=85?-1 : oil>=55?1 : 0,
    note: oil>=85?'น้ำมันแพง — กดดันเงินเฟ้อ' : oil>=55?'ระดับปกติ':'ต่ำ — อุปสงค์อ่อน?',
    asOf: mdAsOf('OIL_WTI')});

  if(sig.length < 3) return null;   // ข้อมูลน้อยเกินกว่าจะสรุป regime

  const avg = sig.reduce((s,x)=>s+x.score,0)/sig.length;
  let label, color, desc;
  if(avg >= 0.7){ label='Risk-On Expansion'; color='gain';
    desc='สัญญาณส่วนใหญ่หนุนสินทรัพย์เสี่ยง'; }
  else if(avg >= 0.25){ label='Cautious Growth'; color='gain';
    desc='เอียงบวกแต่ยังมีจุดต้องระวัง'; }
  else if(avg >= -0.25){ label='Mixed Signals'; color='debt';
    desc='สัญญาณขัดกัน — ไม่ใช่จังหวะเดิมพันหนักด้านใดด้านหนึ่ง'; }
  else if(avg >= -0.9){ label='Late-Cycle Caution'; color='debt';
    desc='ปัจจัยลบเริ่มมากกว่าบวก — เน้นคุณภาพและกระจายความเสี่ยง'; }
  else { label='Risk-Off / Defensive'; color='loss';
    desc='สัญญาณเตือนหลายด้านพร้อมกัน — ให้ความสำคัญกับการรักษาเงินต้น'; }

  // posture + cash จาก score
  const posture = avg>=0.7 ? 'Growth + Momentum'
                : avg>=0.25 ? 'Quality Growth'
                : avg>=-0.25 ? 'Quality + Real Assets'
                : avg>=-0.9 ? 'Quality + Income + Gold' : 'Capital Preservation';
  const cashLo = avg>=0.7?5 : avg>=0.25?10 : avg>=-0.25?15 : avg>=-0.9?20 : 25;
  const risk = avg>=0.7?'High' : avg>=0.25?'Moderate-High' : avg>=-0.25?'Moderate'
             : avg>=-0.9?'Moderate-Low' : 'Low';
  // ตำแหน่งบน spectrum 0..100 (bear→bull)
  const spectrum = Math.max(2, Math.min(98, Math.round((avg + 2) / 4 * 100)));
  const neg = sig.filter(x=>x.score<0).sort((a,b)=>a.score-b.score);
  const pos = sig.filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  const asOfList = sig.map(x=>x.asOf).filter(Boolean).sort();

  return { label, color, desc, posture, risk, avg, spectrum, signals: sig,
           cashRange: cashLo+'-'+(cashLo+5)+'%', negatives: neg, positives: pos,
           dataAsOf: asOfList.length ? asOfList[asOfList.length-1] : null,
           oldestAsOf: asOfList.length ? asOfList[0] : null };
}

// ═══ SECTOR DATA จาก pipeline (สำหรับหน้า Sectors) ═══════════════════
function loadSectors(){
  const act = loadActions();
  const s = act && act.history && act.history.sectors;
  if(!s || !Object.keys(s).length) return null;
  return Object.entries(s).map(([sym,d])=>({sym, ...d}))
    .sort((a,b)=>(b.rs3m??b.chg3m??0)-(a.rs3m??a.chg3m??0));   // เรียงตาม relative strength
}
function sectorRating(s){
  // rating จากตัวเลขจริง: relative strength + trend + RSI
  let score = 0;
  if(s.rs3m!=null) score += s.rs3m>5?2 : s.rs3m>0?1 : s.rs3m>-5?0 : -1;
  if(s.rs1m!=null) score += s.rs1m>3?1 : s.rs1m>-3?0 : -1;
  if(s.vsMA200!=null) score += s.vsMA200>0?1:-1;
  if(s.rsi!=null && s.rsi>78) score -= 1;      // overbought
  return score>=3 ? {label:'Overweight', color:'gain'}
       : score>=1 ? {label:'Neutral+',   color:'gain'}
       : score>=-1? {label:'Neutral',    color:'debt'}
                  : {label:'Underweight',color:'loss'};
}

// ═══ XIRR engine (validated กับ ground truth ±0.01%) ═══
function xirrJS(cfs){
  if(!cfs || cfs.length<2) return null;
  const t0 = Math.min(...cfs.map(c=>c.t));
  const hasNeg = cfs.some(c=>c.v<0), hasPos = cfs.some(c=>c.v>0);
  if(!hasNeg || !hasPos) return null;
  const npv = r => cfs.reduce((s,c)=> s + c.v/Math.pow(1+r,(c.t-t0)/(365*86400e3)), 0);
  let lo=-0.9999, hi=10;
  if(npv(lo)*npv(hi)>0) return null;
  for(let i=0;i<200;i++){ const mid=(lo+hi)/2; if(npv(lo)*npv(mid)<=0) hi=mid; else lo=mid; }
  return (lo+hi)/2;
}

// ═══════════════════════════════════════════════════════════════════
// v40 — LIABILITY & DEBT ENGINE
// ═══════════════════════════════════════════════════════════════════
// เดิม bankBals ถูกรวมเป็นก้อนเดียว → บัตรเครดิตติดลบไปหักเงินสดเงียบๆ
// ทำให้การ์ด "Cash" แสดง ฿22,840 ทั้งที่เงินสดจริง ฿60,894 และหนี้ ฿38,053
// ตัวเลข Net Worth ถูกอยู่แล้ว แต่คนอ่านตัดสินใจผิดเพราะเห็นเงินสดน้อยกว่าจริง

// จำแนกบัญชี → 'cash' | 'liability'
// เกณฑ์: type มีคำว่า Credit = หนี้เสมอ (แม้ยอด 0 หรือบวกจากการจ่ายเกิน)
//        บัญชีอื่นถ้ายอดติดลบ = เบิกเกินบัญชี ถือเป็นหนี้
function classifyAccount(b){
  const t = String(b.type||'');
  if(/credit/i.test(t) || /credit/i.test(String(b.name||''))) return 'liability';
  return (b.balance < 0) ? 'liability' : 'cash';
}

// แยก bankBals เป็นสองฝั่ง + ยอดรวม
// คืน: {cashAccounts, liabAccounts, cash, liabilities, net}
//   cash        = เงินสดที่ใช้ได้จริง (รวมยอดบวกของบัญชี credit ที่จ่ายเกินด้วย)
//   liabilities = หนี้ (ค่าบวกเสมอ — เป็นจำนวนที่ค้างชำระ)
//   net         = cash - liabilities
function splitBalances(bals){
  const cashAccounts = [], liabAccounts = [];
  (bals||[]).forEach(b=>{
    if(classifyAccount(b)==='liability') liabAccounts.push(b);
    else cashAccounts.push(b);
  });
  // บัญชี credit ที่ถูกจัดเป็น liability แต่ยอดเป็นบวก (จ่ายเกิน) ต้องนับเป็นเงินสดด้วย
  // ไม่งั้นยอดบวกนั้นหายไปทั้งจาก cash และ liabilities (liabilities ใช้ min(0,balance) จึงเป็น 0)
  const cash = cashAccounts.reduce((s,b)=>s+b.balance, 0)
             + liabAccounts.reduce((s,b)=>s+Math.max(0,b.balance), 0);
  const liabilities = liabAccounts.reduce((s,b)=>s+Math.abs(Math.min(0,b.balance)), 0);
  return { cashAccounts, liabAccounts, cash, liabilities, net: cash-liabilities };
}

// ═══ Realized P&L — running-WACC ═══
// waccMap (เฉลี่ยจากยอดซื้อทั้งหมด) ใช้ประเมิน cost basis ของ "หุ้นที่ถืออยู่ตอนนี้" ได้ถูกต้อง
// (เพราะ WACC เฉลี่ยไม่เปลี่ยนตอนขาย) แต่ใช้ค่าเดียวนี้ย้อนไปคำนวณ P&L ของการขายในอดีต "ผิด"
// เพราะการซื้อที่เกิดขึ้นทีหลังการขายไม่ควรมีผลย้อนหลังต่อ cost basis ของการขายนั้น (look-ahead bias)
// ฟังก์ชันนี้ไล่ตามลำดับวันที่ต่อ ticker แล้วใช้ WACC ณ เวลาที่ขายจริงแทน
function computeRunningWaccRealized(trackerRows, isCostTx, sellTxTypes){
  const byTicker = {};
  (trackerRows||[]).forEach(r=>{
    (byTicker[r.ticker] ||= []).push(r);
  });
  const realized = [];
  Object.values(byTicker).forEach(rowsForTicker=>{
    const rows = rowsForTicker.slice().sort((a,b)=>a.date-b.date);
    let runQty = 0, runCost = 0;
    rows.forEach(r=>{
      if(isCostTx.has(r.txType) && r.qty>0){
        runCost += r.trueCost;
        runQty += r.qty;
      } else if(sellTxTypes.includes(r.txType)){
        const wacc = runQty>0 ? runCost/runQty : 0;
        const costBasis = r.qty*wacc;
        realized.push({
          date: r.date.toISOString().slice(0,10), ticker:r.ticker, group:r.group,
          qty:r.qty, wacc,
          proceeds: Math.abs(r.amtTHB),
          costBasis,
          pnl: Math.abs(r.amtTHB)-costBasis
        });
        runQty = Math.max(0, runQty - r.qty);
        runCost = Math.max(0, runCost - costBasis);
      }
    });
  });
  return realized;
}

// ═══ DEBT CONFIG — ดอกเบี้ย/ขั้นต่ำต่อบัญชี (ผู้ใช้กรอกเอง เก็บในเครื่อง) ═══
// ดอกเบี้ยไม่ได้อยู่ในชีต — ต้องให้ผู้ใช้ใส่ ไม่งั้นแผนปลดหนี้เป็นแค่การเดา
const DEBT_DEFAULT = {
  apr: {},              // { 'SCB Up2ME Credit Card': 16 }  หน่วย %/ปี
  free: {},             // ข้อ 3 — ยอดที่ปลอดดอกเบี้ยในใบนั้น (เช่นยอดผ่อน 0%)
                        // { 'SCB Up2ME Credit Card': 12000 } หน่วยบาท
                        // ดอกเบี้ยจะคิดจาก (ยอดค้าง − free) เท่านั้น
  minPct: 10,           // ขั้นต่ำมาตรฐานบัตรเครดิตไทย = 10% ของยอดคงเหลือ (ขั้นต่ำ ฿500)
  minFloor: 500,
  strategy: 'avalanche',// avalanche = จ่ายดอกสูงสุดก่อน (ประหยัดเงินที่สุด)
  extraPerMonth: 0,     // เงินที่จ่ายเพิ่มจากขั้นต่ำต่อเดือน
};
function getDebtCfg(){
  try{ const s = JSON.parse(localStorage.getItem('finOS_debtCfg')||'null');
       if(s && typeof s==='object') return {...DEBT_DEFAULT, ...s, apr:{...DEBT_DEFAULT.apr, ...(s.apr||{})}, free:{...(DEBT_DEFAULT.free||{}), ...(s.free||{})}}; }catch(e){}
  return JSON.parse(JSON.stringify(DEBT_DEFAULT));
}
function saveDebtCfg(cfg){
  const cur = getDebtCfg();
  localStorage.setItem('finOS_debtCfg', JSON.stringify({...cur, ...cfg, apr:{...cur.apr, ...(cfg.apr||{})}, free:{...(cur.free||{}), ...(cfg.free||{})}}));
}

// ═══ buildDebtPlan — จำลองการปลดหนี้เดือนต่อเดือน ═══
// avalanche: จ่ายขั้นต่ำทุกใบ แล้วโยนเงินเหลือทั้งหมดใส่ใบที่ APR สูงสุด
// snowball : เหมือนกันแต่เรียงตามยอดน้อยสุด (แพงกว่า แต่เห็นผลเร็ว = แรงใจ)
// คืน null ถ้าไม่มีหนี้ · คืน {months:Infinity} ถ้าจ่ายไม่พอดอกเบี้ย (หนี้โต)
function buildDebtPlan(liabAccounts, cfg){
  cfg = cfg || getDebtCfg();
  // ── BUGFIX v48 #1 ────────────────────────────────────────────────────
  // เดิมฟังก์ชันนี้คิดดอกเบี้ยจาก d.bal ทั้งก้อน โดยไม่เคยอ่าน cfg.free เลย
  // ขณะที่ debtVsInvest() คิดจาก intBal = bal − free
  // ผลคือหน้า Debt แสดงตัวเลขที่ขัดกันเองบนจอเดียวกัน:
  //   การ์ด "ดอกเบี้ย/เดือน"   = ถูก (หัก free)
  //   การ์ด "ดอกเบี้ยรวมจนหมด" = เกินจริง (ไม่หัก free)
  //   การ์ด "หมดใน X เดือน"    = นานเกินจริง
  // แก้: เก็บ free ต่อใบ แล้วคิดดอกจาก max(0, bal − free) เท่านั้น
  // เมื่อจ่ายไปเรื่อยๆ ยอดค้างลดลงจนต่ำกว่า free → free ถูก clamp ตาม (min)
  // ซึ่งตรงกับความจริง: เงินที่จ่ายเข้าไปตัดยอดที่คิดดอกก่อนเสมอ
  let debts = (liabAccounts||[])
    .map(b=>{
      const bal = Math.abs(Math.min(0, b.balance));
      return { name:b.name, bal,
               free: Math.max(0, Math.min(Number(cfg.free?.[b.name] ?? 0), bal)),
               apr: Number(cfg.apr[b.name] ?? 0) };
    })
    .filter(d=>d.bal > 0.5);
  if(!debts.length) return null;

  const totalStart = debts.reduce((s,d)=>s+d.bal, 0);
  const minOf = d => Math.min(d.bal, Math.max(cfg.minFloor, d.bal * cfg.minPct/100));
  const baseMin = debts.reduce((s,d)=>s+minOf(d), 0);
  const budget = baseMin + Math.max(0, Number(cfg.extraPerMonth)||0);

  // เรียงลำดับเป้าโจมตี
  const order = cfg.strategy==='snowball'
    ? [...debts].sort((a,b)=>a.bal-b.bal)
    : [...debts].sort((a,b)=>b.apr-a.apr || a.bal-b.bal);

  let month = 0, totalInterest = 0;
  const timeline = [], payoffMonth = {};
  const MAX = 600;   // 50 ปี — เกินนี้ถือว่าไม่มีวันหมด

  while(debts.some(d=>d.bal>0.5) && month < MAX){
    month++;
    let pool = budget;
    // 1) ดอกเบี้ยเดินก่อน (ทบต้นรายเดือน)
    debts.forEach(d=>{
      if(d.bal<=0) return;
      const intBase = Math.max(0, d.bal - (d.free||0));   // #1 — ยอดที่คิดดอกจริง
      const int = intBase * (d.apr/100) / 12;
      d.bal += int; totalInterest += int;
    });
    // 2) จ่ายขั้นต่ำทุกใบ
    debts.forEach(d=>{
      if(d.bal<=0) return;
      const pay = Math.min(d.bal, minOf(d), pool);
      d.bal -= pay; pool -= pay;
    });
    // 3) เงินเหลือ → ใบเป้าหมายตามกลยุทธ์
    for(const t of order){
      if(pool<=0) break;
      const d = debts.find(x=>x.name===t.name);
      if(!d || d.bal<=0) continue;
      const pay = Math.min(d.bal, pool);
      d.bal -= pay; pool -= pay;
    }
    // #1 — free ห้ามเกินยอดค้างที่เหลือ ไม่งั้น intBase ติดลบแล้วดอกหายไปทั้งใบ
    debts.forEach(d=>{ if(d.free > d.bal) d.free = Math.max(0, d.bal); });
    debts.forEach(d=>{ if(d.bal<=0.5 && !payoffMonth[d.name]){ payoffMonth[d.name]=month; d.bal=0; d.free=0; } });
    timeline.push({ m:month, total: debts.reduce((s,d)=>s+d.bal,0) });
  }

  const done = month < MAX;
  return {
    months: done ? month : Infinity,
    totalStart, totalInterest, budget, baseMin,
    strategy: cfg.strategy,
    payoffMonth, timeline,
    order: order.map(d=>({name:d.name, apr:d.apr, free:d.free||0,
                          bal: totalStartOf(liabAccounts, d.name)})),
    // #27 — เดิมมี field `freeMonth` ที่ค่าเท่ากับ `months` ทุกกรณี พร้อมคอมเมนต์อ้างว่า
    // "เทียบกับการจ่ายขั้นต่ำอย่างเดียว" ซึ่งโค้ดไม่เคยทำ และไม่มีผู้เรียกรายไหนอ่านมัน
    // การเปรียบเทียบ baseline ทำจริงที่ renderDebt() โดยเรียก buildDebtPlan ซ้ำด้วย
    // extraPerMonth:0 แล้ว diff กัน — จึงลบ field ที่ทำให้เข้าใจผิดนี้ทิ้ง
  };
}
function totalStartOf(liabAccounts, name){
  const b = (liabAccounts||[]).find(x=>x.name===name);
  return b ? Math.abs(Math.min(0, b.balance)) : 0;
}

// ═══ debtVsInvest — เปรียบเทียบ "จ่ายหนี้" vs "ลงทุน" ═══
// จ่ายหนี้ APR 16% = ผลตอบแทนรับประกัน 16% ปลอดภาษี ปลอดความผันผวน
// ต้องเทียบกับผลตอบแทนคาดหวังของพอร์ต (getGoalCfg().expectedReturn)
function debtVsInvest(liabAccounts, cfg){
  cfg = cfg || getDebtCfg();
  const exp = getGoalCfg().expectedReturn || 7;
  /* ══ ข้อ 3 — บัตรเครดิตใบเดียวมักมีทั้งยอดที่คิดดอกและยอดที่ไม่คิด ══════
     เช่น SCB Up2ME: ยอดผ่อน 0% กับยอด revolving 16% อยู่ในใบเดียวกัน
     เดิมโมเดลมี apr เดียวต่อบัญชี -> ต้องเลือกว่าจะคิด 16% ทั้งก้อน
     (ดอกเบี้ยเกินจริง) หรือใส่ 0 (ดอกเบี้ยหายไปเลย) ผิดทั้งสองทาง
     เพิ่ม cfg.free[name] = ยอดที่ปลอดดอกเบี้ย แล้วคิดดอกเฉพาะส่วนที่เหลือ
     ผลกระทบ: ดอกเบี้ย/เดือน, แผนปลดหนี้ และการเทียบ "จ่ายหนี้ vs ลงทุน"
     จะอิงยอดที่คิดดอกจริงเท่านั้น */
  const rows = (liabAccounts||[])
    .map(b=>{
      const bal  = Math.abs(Math.min(0,b.balance));
      const free = Math.max(0, Math.min(Number(cfg.free?.[b.name] ?? 0), bal));
      return { name:b.name, bal, free, intBal: bal-free, apr:Number(cfg.apr[b.name] ?? 0) };
    })
    .filter(d=>d.bal>0.5)
    .map(d=>({ ...d,
      // APR ที่มีผลจริงกับทั้งใบ = ดอกจริง ÷ ยอดรวม (ใช้เทียบกับผลตอบแทนลงทุน)
      effApr: d.bal>0 ? d.apr*d.intBal/d.bal : 0,
      edge: (d.bal>0 ? d.apr*d.intBal/d.bal : 0)-exp,
      verdict: (d.bal>0 ? d.apr*d.intBal/d.bal : 0)>exp ? 'จ่ายหนี้ก่อน'
             : d.apr>0 ? 'ลงทุนก่อน' : 'ยังไม่ได้ใส่ดอกเบี้ย' }));
  // ดอกเบี้ยคิดจาก intBal เท่านั้น ไม่ใช่ bal
  const yearlyInterest = rows.reduce((s,d)=>s + d.intBal*d.apr/100, 0);
  const freeTotal = rows.reduce((s,d)=>s + d.free, 0);
  const intTotal  = rows.reduce((s,d)=>s + d.intBal, 0);
  return { rows, expectedReturn: exp, yearlyInterest,
           monthlyInterest: yearlyInterest/12, freeTotal, intTotal };
}
