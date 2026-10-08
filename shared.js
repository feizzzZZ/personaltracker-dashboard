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
const APP_BUILD = 'v68';
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
    /* BUGFIX v48 #20 — cache-bust เดิมใช้ "วันที่" อย่างเดียว
       แต่ pipeline รัน 2 ครั้ง/วัน (06:30 และ 18:30) รอบบ่ายจึงถูก
       HTTP cache ของเบราว์เซอร์/CDN กลืนหายทั้งรอบ เพราะ URL ไม่เปลี่ยน
       เปลี่ยนเป็นถังละ 1 ชม. + cache:'no-store' ให้ชัดเจนไปเลย */
    const bucket = Math.floor(Date.now()/36e5);        // เปลี่ยนทุกชั่วโมง
    const r = await fetch('market-data.json?t='+bucket, {cache:'no-store'});
    if(!r.ok){ console.warn('[Actions] market-data.json HTTP '+r.status); return null; }
    const j = await r.json();
    if(j && j.error){ console.warn('[Actions] offline — ไม่มีข้อมูลใน cache'); return null; }
    if(j && j.data){
      localStorage.setItem('finOS_actions', JSON.stringify(j));
      return j;
    }
    console.warn('[Actions] market-data.json ไม่มีคีย์ data — รูปแบบไฟล์เปลี่ยน?');
  }catch(e){ console.warn('[Actions] ดึง market-data.json ไม่สำเร็จ:', e.message); }
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
 
// ── v48 #21: ตัวไหนที่ pipeline มีราคาให้ แต่ยังไปไม่ถึงจอ ────────────
// ใช้ debug อาการ "ราคา X ไม่มา" ได้ในบรรทัดเดียวจาก console:
//   pipelinePriceReport()
// เดิมต้องไล่เดาว่าปัญหาอยู่ที่ pipeline / localStorage / resolvePrices
function pipelinePriceReport(){
  const act = loadActions();
  if(!act){ console.warn('finOS_actions ว่าง — fetchActionsData() ไม่เคยรันสำเร็จ'); return null; }
  const px = act.prices || {};
  const age = marketDataAge();
  const out = { generated_at: act.generated_at, ageLabel: age && age.label,
                nPrices: Object.keys(px).length, missing: (act.stats||{}).prices_missing || [],
                sample: {} };
  Object.entries(px).slice(0,50).forEach(([k,v])=>{ out.sample[k] = `${v.price} ${v.ccy} @ ${v.updated}`; });
  console.table(out.sample); console.log(out);
  return out;
}
 
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
    /* v51 BUGFIX — อายุราคาต้องนับเป็น "จำนวนวันเต็ม" ทุกที่
       เดิมบรรทัดนี้เทียบด้วยเศษส่วน (11.6 วัน) แล้วเก็บด้วย Math.round
       ขณะที่ ageOf() ใน resolvePrices ใช้ Math.floor  ผลที่ตามมา 3 อย่าง:
         1. อายุที่แสดงกระโดดเพิ่ม 1 ตอนเที่ยง UTC ทั้งที่ไม่มีอะไรเปลี่ยน
         2. resolvePrices คำนวณ "วันของราคา" ย้อนกลับจากอายุนี้ไปบันทึกใน
            lastPrice → วันเลื่อนไป 1 วัน = ฟอกอายุราคา ซึ่ง v50 เพิ่งแก้ไป
         3. เส้นตัด PRICE_MAX_DAYS/PRICE_STALE_DAYS ขยับตามเวลาของวัน —
            ราคาอายุ 12 วันถูกใช้ตอนเช้าแต่ถูกทิ้งตอนบ่ายของวันเดียวกัน
       floor ถูกตามความหมาย: ราคาของวันที่ 10 มีอายุ 11 วันจนถึงวันที่ 22 00:00Z
       และ PRICE_MAX_DAYS = 12 แปลว่า "ถึง 12 วันยังใช้ได้" ตลอดทั้งวัน */
    const ageDays = Math.max(0, Math.floor((today - t) / 864e5));
    if(ageDays > PRICE_MAX_DAYS) return;           // เก่าเกินไป ทิ้ง
 
    out[tk] = {
      p: ccy === 'THB' ? Number(o.price) : Number(o.price) * fx,
      ccy, updated: o.updated,
      ageDays,
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
// เพดานอายุของราคาที่จำไว้ — เกินนี้ถือว่าไม่รู้ราคาแล้ว ดีกว่าใช้ต่อไปเรื่อยๆ
// เดิมไม่มีเพดานเลย ราคาข้ามปียังถูกดึงมาใช้เต็มมูลค่า ขัดกับ PRICE_MAX_DAYS
// ที่ด่านหน้าทิ้งราคาเกิน 12 วัน  ตั้ง 30 เพราะ pipeline รัน 2 ครั้ง/วัน —
// ช่องว่าง 30 วันแปลว่ามีอะไรพังจริง ไม่ใช่วันหยุดยาว และ UI รายงาน
// ตัวที่ไม่มีราคาอยู่แล้ว การหายไปจึงเป็นสัญญาณ ไม่ใช่ความเงียบ
const LKP_MAX_DAYS = 30;
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
  const ageMap   = {};          // v50 — อายุจริงของราคาแต่ละตัว (วัน)
  Object.keys(priceMap).forEach(t=>{
    if(priceMap[t] > 0){ srcMap[t] = 'sheet'; ageMap[t] = 0; }
  });
 
  const pp = pipelinePricesTHB();
  Object.entries(pp).forEach(([tk, o])=>{
    // ราคา stale ใช้เฉพาะเมื่อชีตไม่มีให้ — ชีตที่มีค่าจริงยังน่าเชื่อกว่าราคาค้าง
    if(o.stale && priceMap[tk] > 0) return;
    priceMap[tk] = o.p;
    srcMap[tk]   = o.stale ? 'stale' : 'pipeline';
    ageMap[tk]   = o.ageDays || 0;
  });
 
  /* v50 BUGFIX — ราคาที่จำไว้เคยไม่มีวันหมดอายุ
     `lkp[tk].d` ถูกเขียนทุกรอบแต่ไม่เคยถูกอ่านเลย ราคาที่จำไว้ข้ามปี
     จึงยังถูกดึงมาใช้เต็มมูลค่า ขัดกับ PRICE_MAX_DAYS โดยตรง
     ตอนนี้อ่าน `d` จริงและทิ้งตัวที่เกิน LKP_MAX_DAYS */
  const lkp = loadLastKnownPrices();
  const nowMs = Date.now();
  const ageOf = d => {
    if(!d) return null;
    const t = Date.parse(String(d).slice(0,10) + 'T00:00:00Z');
    return isFinite(t) ? Math.floor((nowMs - t) / 864e5) : null;
  };
  Object.keys(lkp).forEach(tk=>{
    if(priceMap[tk] > 0) return;
    const e = lkp[tk];
    if(!e || !(e.p > 0)) return;
    const age = ageOf(e.d);
    if(age === null || age > LKP_MAX_DAYS) return;   // ไม่รู้อายุ/เก่าเกิน = ไม่กล้าใช้
    priceMap[tk] = e.p;
    srcMap[tk]   = 'cached';
    ageMap[tk]   = age;
  });
 
  /* จำราคาที่ "รู้จริง" รอบนี้ไว้ใช้คราวหน้า — ไม่จำค่าที่มาจาก cache เอง
     v50: ต้องบันทึก "วันของราคาจริง" ไม่ใช่วันนี้
     เดิมราคา stale อายุ 11 วันถูกบันทึกด้วย d = วันนี้ → อายุจริงหายจากระบบ
     ถาวร แล้วมันกลายเป็นราคา "ใหม่" ที่ใช้ต่อได้ไม่จำกัด */
  Object.entries(priceMap).forEach(([tk, p])=>{
    if(!(p > 0) || srcMap[tk] === 'cached') return;
    const d = new Date(nowMs - (ageMap[tk] || 0) * 864e5).toISOString().slice(0,10);
    lkp[tk] = { p, d, src: srcMap[tk] };
  });
  saveLastKnownPrices(lkp);
 
  return { priceMap, srcMap, ageMap };
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
    if(raw instanceof Date) d = isoLocal(raw);   // v64 — Date ท้องถิ่นเที่ยงคืน → toISOString ได้วันก่อนหน้า (UTC+7)
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
 
// v68 #2 — ยอดที่เคลื่อนไหวในบัญชีหลังวันที่จดยอดจริง (ไม่นับวันเดียวกัน:
// ยอดใน Reconcile = ยอด ณ สิ้นวันที่จด รายการวันนั้นรวมอยู่ในยอดจริงแล้ว)
// rows = txRows ที่มี {dateStr, acct:{ชื่อบัญชี: จำนวน}}
function movementAfter(rows, name, date){
  if(!date || !rows) return 0;
  let s = 0;
  for(const r of rows){
    if(!r || !r.acct || !(r.dateStr > date)) continue;
    const v = Number(r.acct[name]); if(isFinite(v)) s += v;
  }
  return Math.round(s*100)/100;
}
// เทียบยอดคำนวณ vs ยอดจริง → คืนรายการที่ต่างกัน + สถานะรวม
// tolerance: ต่างไม่เกิน 1 บาท = ถือว่าตรง (ปัดเศษ/ดอกเบี้ยเล็กน้อย)
// v68 #2 — เทียบ "ณ วันที่จด": ยอดคำนวณ − รายการหลังวันนั้น · เดิมเทียบกับยอดวันนี้
//          พอกรอกรายจ่ายหลังวันจด หน้าจอฟ้องว่าต่างทั้งที่ตรงกัน (ส่ง rows = txRows)
function computeReconciliation(bals, reconMap, tolerance, rows){
  const tol = tolerance == null ? 1 : tolerance;
  const map = reconMap || {};
  const accounts = [];
  let worstDate = null, unmatched = 0, totalDrift = 0;
 
  (bals||[]).forEach(b=>{
    const rec = map[b.name];
    if(!rec){ accounts.push({name:b.name, computed:b.balance, checked:false}); return; }
    const after = movementAfter(rows, b.name, rec.date);
    const computedAt = b.balance - after;         // ยอดคำนวณ ณ วันที่จด
    const diff = rec.actual - computedAt;         // + = มีเงินมากกว่าที่บันทึก
    const ok = Math.abs(diff) <= tol;
    if(!ok){ unmatched++; totalDrift += Math.abs(diff); }
    if(rec.date && (!worstDate || rec.date < worstDate)) worstDate = rec.date;
    accounts.push({name:b.name, computed:computedAt, computedNow:b.balance, after, actual:rec.actual,
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
  if(tag) t[ticker]={tag, at:isoLocal(new Date())};   // v64 — วันที่ท้องถิ่น
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
    (byT[k] = byT[k] || {buys:[], sells:0, div:0, cost:0, boughtQty:0});
    const tt=String(t.type||'').trim();
    /* v50 — เก็บ "ยอดซื้อสะสม" กับ "จำนวนที่ซื้อสะสม" แยกกัน
       เดิมทำ `cost -= เงินที่ได้จากการขาย` ซึ่งผิดคนละเรื่อง:
       ต้นทุนของหน่วยที่ขายไป = จำนวนที่ขาย × ต้นทุนต่อหน่วย
       ไม่ใช่ "เงินที่ได้จากการขาย" — สองค่านี้ต่างกันเท่ากับกำไรที่รับรู้
         ซื้อ 10 @ ฿10,000 · ขาย 5 ได้ ฿9,000 (ต้นทุนของ 5 ตัวนั้น = ฿5,000)
           หักถูก: 10,000 − 5,000 = ฿5,000 ✓
           หักผิด: 10,000 − 9,000 = ฿1,000 ✗  หักเกินไป ฿4,000 = กำไรที่รับรู้
       เก็บสองค่าไว้แล้วคำนวณ WACC × จำนวนที่เหลือ ตอนใช้งาน
       จะได้ผลเดียวกับ a.cost ที่ index.html ส่งมา — ถูกทั้งสองทาง */
    if(tt==='Buy'){
      byT[k].buys.push(t.date.getTime());
      byT[k].cost += (t.thb||0);
      byT[k].boughtQty += Math.abs(t.qty||0);
    }
    else if(tt==='Sell'){ byT[k].sells++; }
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
    /* v50 BUGFIX — ต้นทุนผิดหลังขายบางส่วน → %กำไรผิดเป็นเท่าตัว
       เดิมเลือก h.cost ก่อน ซึ่งเป็นยอดซื้อสะสม *ลบเงินที่ได้จากการขาย*
       การขายที่มีกำไรจึงกัดต้นทุนของหน่วยที่ยังถืออยู่ให้เหลือน้อยผิดปกติ
       และเพราะ h.cost>0 ยังจริง มันจึงชนะ a.cost ที่ถูกต้องอยู่แล้ว
 
       พิสูจน์: ซื้อ 10 หน่วย ฿10,000 · ขาย 5 ได้ ฿9,000 · เหลือมูลค่า ฿9,000
         เดิม  cost=฿1,000  plPct=+800%
         ถูก   cost=฿5,000  plPct=+80%
 
       a.cost = WACC × netQty ซึ่งเป็นนิยามต้นทุนของหน่วยที่ถืออยู่จริง
       และ index.html ส่งมาให้ครบทุกตัวอยู่แล้ว จึงต้องเป็นตัวเลือกแรก */
    /* ต้นทุนของ "หน่วยที่ยังถืออยู่" — ต้องลดลงตามจำนวนที่ขายไปแล้ว
       a.cost = WACC × netQty ซึ่ง index.html คำนวณมาให้ครบทุกตัวอยู่แล้ว
       fallback: คำนวณ WACC เองจากยอดซื้อ แล้วคูณจำนวนที่ "เหลือ"
       ห้ามใช้ h.cost ดิบ ๆ เพราะนั่นคือยอดซื้อ *ทั้งหมด* ยังไม่หักส่วนที่ขายไป */
    const _wacc = h.boughtQty > 0 ? h.cost / h.boughtQty : 0;
    const cost = a.cost > 0 ? a.cost
               : (_wacc > 0 ? _wacc * (a.qty || 0) : 0);
    const val=a.val>0?a.val:null;                  // null = ไม่มีราคา
    const row={
      ticker:a.ticker, label:a.label||a.ticker, type:a.assetType||a.type||'',
      qty:a.qty, cost, val,
      pl: val!=null ? val-cost : null,
      plPct: (val!=null && cost>0) ? (val-cost)/cost*100 : null,
      div:h.div, buys:h.buys.length, sells:h.sells,
      medianGap:Math.round(cad.median), rcv:cad.rcv,
      regular: h.buys.length>=4 && cad.rcv<=REGULAR_RCV,
      // v64 — lastBuy มาจาก parseDate (เที่ยงคืนเวลาท้องถิ่น) → toISOString ได้วันก่อนหน้าในไทย
      ageDays, lastBuy: lastBuy? isoLocal(new Date(lastBuy)):null,
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
const QBP_SIGN = {'Buy':1,'Split':1,'Recieved':1,'Stake':1,'Sell':-1,'Send':-1,'Used':-1};
function qtyByPlatform(tracker){
  const acc = {};
  (tracker||[]).forEach(r=>{
    if(!r || !r.ticker) return;
    const tt = String(r.txType||'').trim();
    const plat = r.platform || 'Unknown';
    const q = Number(r.qty)||0;
    if(!q) return;
    (acc[r.ticker] = acc[r.ticker] || {});
    /* v54 BUGFIX — ต้องใช้ทิศทางเดียวกับ SIGN ใน gsParseAssetTracker ทุกประเภท
       เดิมนับแค่ Buy/Split/Sell → โอน BTC จาก Binance ไป Ledger (Send + Recieved)
       ไม่ถูกนับ มูลค่าทั้งหมดยังกองที่ Binance และ Ledger ไม่โผล่ในหน้า Asset Location
       = ประเมิน counterparty risk ต่อ exchange ผิด (ซึ่งเป็นเหตุผลที่หน้านี้มีอยู่)
         + : Buy · Split · Recieved · Stake
         − : Sell · Send · Used
         0 : Transfer · Dividend Payout */
    const s = QBP_SIGN[tt] || 0;
    if(s) acc[r.ticker][plat] = (acc[r.ticker][plat]||0) + s*Math.abs(q);
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
 
// ═══ Method 2 — external API layer (alternative.me + CoinGecko) ═══
const EXT_TTL = 10*60e3;
function loadExt(){ try{ return JSON.parse(localStorage.getItem('finOS_ext')||'null'); }catch(e){ return null; } }
async function fetchExternalData(force){
  const cached = loadExt();
  if(!force && cached && Date.now()-cached.savedAt < EXT_TTL) return cached;
  /* v54 BUGFIX — ราคาเก่าถูกประทับเวลาใหม่ทุกครั้งที่ดึงไม่สำเร็จ
     เดิม savedAt = ตอนนี้เสมอ แม้ CoinGecko ล้ม แล้ว prices เดิมถูกยกมาทั้งก้อน
     mergeExtIntoMarket ใช้ savedAt เป็นวันของราคา → ราคาอายุ 5 วันกลายเป็น
     "ราคาวันนี้" และชนะราคา pipeline ที่สดกว่า (ทดสอบจริง: $10,000 ทับ $84,420)
     แก้: savedAt = เวลาที่ "พยายามดึง" (ใช้คุม TTL อย่างเดียว)
          แต่ละราคามี t = เวลาที่ดึงได้จริง ซึ่งเปลี่ยนเฉพาะเมื่อดึงสำเร็จ */
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
    const tNow = Date.now();
    if(j && j.bitcoin) out.prices = { BTCUSD:{v:j.bitcoin.usd, chg:j.bitcoin.usd_24h_change, thb:j.bitcoin.thb, t:tNow},
                                      ETHUSD:{v:j.ethereum?.usd, chg:j.ethereum?.usd_24h_change, thb:j.ethereum?.thb, t:tNow} };
  }catch(e){ console.warn('[Ext] coingecko:', e.message); }
  localStorage.setItem('finOS_ext', JSON.stringify(out));
  return out;
}
// ราคา crypto จาก CoinGecko → override เฉพาะเมื่อ "สดกว่าจริง" (พร้อมระบุที่มา)
// v54 — เดิม "ชนะเสมอ" โดยใช้ savedAt เป็นวันของราคา ตอนนี้ต้องผ่าน 2 ด่าน:
//   1. รู้เวลาที่ดึงได้จริง (p.t) และอายุไม่เกิน EXT_PRICE_MAX_MS
//      cache รุ่นก่อน v54 ไม่มี p.t → ไม่รู้อายุ = ไม่ใช้ (รอบถัดไปดึงใหม่เอง)
//   2. ใหม่กว่าค่าที่มีอยู่ (fetched_at ของ pipeline / updated ของชีต)
const EXT_PRICE_MAX_MS = 6*36e5;     // 6 ชม. — เกินนี้ราคา pipeline รอบล่าสุดน่าเชื่อกว่า
function mergeExtIntoMarket(md){
  const ext = loadExt();
  if(!ext || !ext.prices || !md || !md.data) return md;
  const now = Date.now();
  ['BTCUSD','ETHUSD'].forEach(k=>{
    const p = ext.prices[k];
    if(!p || !p.v || !(p.t > 0) || now - p.t > EXT_PRICE_MAX_MS) return;
    const cur = md.data[k];
    const curT = cur ? Date.parse(cur.fetched_at || cur.updated || '') : NaN;
    if(isFinite(curT) && curT > p.t) return;         // ของที่มีอยู่สดกว่า
    md.data[k] = { value:p.v, updated:new Date(p.t).toISOString(), fetched_at:new Date(p.t).toISOString(),
      note:'CoinGecko'+(p.chg!=null?` · ${p.chg>=0?'+':''}${p.chg.toFixed(1)}% 24h`:'') };
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
  /* v50 BUGFIX — เดิมนับจาก illiquid[] ซึ่งมีเฉพาะกองที่ "ถืออยู่จริงและมีมูลค่า"
     ถ้า Provident Fund ไม่อยู่ในพอร์ต (หรืออยู่แต่หาราคาไม่ได้ → value=0)
     จะได้ 0 → scale=1 แต่ liquidTargetSum ตัด target 5% ของ PF ทิ้งไปแล้ว
     ผล: sum(target)=95 ขณะที่ sum(cur)=100 → ทุกกองดู over-weight เกินจริง
     ~5pp พร้อมกัน และคอลัมน์ "บาทที่ต้อง rebalance" พองตาม
     ต้องนับจาก ALLOC_META ทั้งหมด เพราะ target ของกองที่ขายไม่ได้ต้องถูก
     กระจายคืนเสมอ ไม่ว่าจะถืออยู่หรือไม่ */
  const illiquidTargetSum = Object.entries(targets)
    .filter(([k])=>ALLOC_META[k]?.illiquid)
    .reduce((sum,[,t])=>sum+t, 0);
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
 
// ═══ v67 — NOTIFICATIONS (แทน LINE) ═══════════════════════════════════
// ต้นทาง: notifications.enc.json ที่ Actions เข้ารหัสด้วย AES-256-GCM (scripts/notify_store.py)
//        + เหตุการณ์ที่แอปสร้างเอง (เก็บในเครื่อง) · รูปแบบไฟล์ต้องตรงกับฝั่ง Python ทุกไบต์
const NOTIF_AAD = 'finos-notify-v1';
const NOTIF_KEY_LS = 'finOS_notifyKey', NOTIF_READ_LS = 'finOS_notifRead', NOTIF_LOCAL_LS = 'finOS_notifLocal',
      NOTIF_CACHE_LS = 'finOS_notifCache', VAPID_PUB_LS = 'finOS_vapidPub';
const NOTIF_CAT = { daily:'portfolio', weekly:'portfolio', monthly:'portfolio', alert:'price',
                    system:'system', test:'system', app:'system' };
function notifCategory(kind){ return NOTIF_CAT[kind] || 'system'; }
function b64ToBytes(s){
  s = String(s||'').trim().replace(/-/g,'+').replace(/_/g,'/');
  s += '==='.slice((s.length + 3) % 4);
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
  return u;
}
function bytesToB64(u, url){
  let bin=''; const a = u instanceof Uint8Array ? u : new Uint8Array(u);
  for(let i=0;i<a.length;i++) bin += String.fromCharCode(a[i]);
  const b = btoa(bin);
  return url ? b.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'') : b;
}
// คืน array ของรายการ · กุญแจผิด/ไฟล์เสีย → throw (ให้ UI บอกว่ากุญแจไม่ตรง ไม่ใช่ "ไม่มีแจ้งเตือน")
async function notifyDecrypt(doc, keyB64){
  if(!doc || !doc.iv || !doc.ct) return [];
  const raw = b64ToBytes(keyB64);
  if(raw.length !== 32) throw new Error('bad-key-length');
  const key = await crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:b64ToBytes(doc.iv),
                                          additionalData:new TextEncoder().encode(NOTIF_AAD)}, key, b64ToBytes(doc.ct));
  const items = JSON.parse(new TextDecoder().decode(pt));
  return Array.isArray(items) ? items : [];
}
// รวม remote + local · กันซ้ำด้วย id · ใหม่→เก่า
function mergeNotifications(remote, local){
  const seen = new Set(), out = [];
  [...(remote||[]), ...(local||[])].forEach(n => {
    if(!n || !n.id || seen.has(n.id)) return; seen.add(n.id);
    out.push({ ...n, cat: notifCategory(n.kind) });
  });
  return out.sort((a,b) => String(b.ts||'').localeCompare(String(a.ts||'')));
}
function notifUnread(items, readIds){
  const r = readIds instanceof Set ? readIds : new Set(readIds||[]);
  return (items||[]).filter(n => !r.has(n.id)).length;
}
// เหตุการณ์ในแอป — กันซ้ำด้วย key ต่อวัน (เช่น "งบเกิน" ขึ้นวันละครั้ง ไม่ใช่ทุกครั้งที่ render)
function notifLocalAdd(list, key, title, body, page, now){
  const d = now ? new Date(now) : new Date();
  const id = 'app-' + key + '-' + isoLocal(d);
  if((list||[]).some(n => n.id === id)) return { list: list||[], added: null };
  const n = { id, ts: d.toISOString(), kind:'app', title, body, page: page||null };
  return { list: [n, ...(list||[])].slice(0, 200), added: n };
}

// ═══ v66 — FUNDAMENTALS (fundamentals.json จาก scripts/fetch_fundamentals.py) ═══
// กติกาเดียวกับ loadSignals(): อ่าน + ตรวจอายุเท่านั้น ห้ามคำนวณงบซ้ำฝั่งนี้
const FUND_KEY = 'finOS_fund';
const FUND_MAX_DAYS = 10;          // ราคา/ปันผลเก่ากว่านี้ = ติดป้ายว่าเก่า
let _fundCache = null;
function loadFundamentals(){
  if(_fundCache) return _fundCache;
  try{ _fundCache = JSON.parse(localStorage.getItem(FUND_KEY)||'null'); }catch(e){ _fundCache = null; }
  return _fundCache;
}
async function fetchFundamentals(){
  try{
    const bucket = Math.floor(Date.now()/36e5);
    const r = await fetch('fundamentals.json?t='+bucket, {cache:'no-store'});
    if(!r.ok){ if(r.status !== 404) console.warn('[fund] fundamentals.json HTTP '+r.status); return null; }
    const j = await r.json();
    if(j && j.tickers){
      _fundCache = j;
      try{ localStorage.setItem(FUND_KEY, JSON.stringify(j)); }catch(e){ console.warn('[fund] เก็บ cache ไม่ได้ (quota?)'); }
      return j;
    }
  }catch(e){ console.warn('[fund] ดึง fundamentals.json ไม่สำเร็จ:', e.message); }
  return null;
}
function fundOf(ticker){
  const f = loadFundamentals(); const e = f && f.tickers && f.tickers[ticker];
  if(!e) return null;
  const age = ageDaysOf(e.updated);
  return { ...e, age, stale: age == null || age > FUND_MAX_DAYS };
}

// ═══ v66 — DIVIDEND CALENDAR ═══════════════════════════════════════════
// holdings: [{ticker, qty, name?}] · fund: {ticker: {dividends:[{date,amount}], profile:{currency}}}
// received: [{ticker, date:Date|ISO, amtTHB}] (แถว Dividend Payout ในชีต) · fx: {USD: บาท/ดอลลาร์}
// คืน { events:[…], months:[{key,declared,estimated,received}], annual, monthly, daily, yetToReceive }
//   status: 'received' (เจอเงินเข้าในชีต) · 'declared' (ex-date ผ่านแล้ว ยังไม่เจอเงินเข้า = รอรับ)
//           'estimated' (ฉายจากรอบเดียวกันของปีก่อน × จำนวนหุ้นปัจจุบัน)
// หลักการ: ไม่เดาปันผลให้ตัวที่ไม่มีประวัติ · ยอดเป็นก่อนหักภาษี ณ ที่จ่าย
const DIV_FREQ = [ {max:45, n:12, th:'รายเดือน', en:'Monthly'}, {max:120, n:4, th:'รายไตรมาส', en:'Quarterly'},
                   {max:240, n:2, th:'ครึ่งปี', en:'Semi-annual'}, {max:1e9, n:1, th:'รายปี', en:'Annual'} ];
function divFrequency(dates){
  const d = (dates||[]).map(x=>Date.parse(x)).filter(isFinite).sort((a,b)=>a-b).slice(-7);
  if(d.length < 2) return d.length ? DIV_FREQ[3] : null;
  const gaps = d.slice(1).map((t,i)=>(t-d[i])/864e5).sort((a,b)=>a-b);
  const med = gaps[Math.floor(gaps.length/2)];
  return DIV_FREQ.find(f => med <= f.max);
}
function dividendCalendar(holdings, fund, received, fx, today){
  const DAY = 864e5, now = today ? new Date(today) : new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const iso = t => isoLocal(new Date(t));
  const rec = (received||[]).map(r => ({ticker:r.ticker, t: (r.date instanceof Date ? r.date : new Date(r.date)).getTime(),
                                        amt: Math.abs(Number(r.amtTHB)||0)})).filter(r => isFinite(r.t));
  const events = [];
  (holdings||[]).forEach(h => {
    const f = (fund||{})[h.ticker]; const divs = (f && f.dividends) || [];
    if(!divs.length || !(h.qty > 0)) return;
    const ccy = (f.profile && f.profile.currency) || 'THB';
    const rate = ccy === 'THB' ? 1 : (Number((fx||{})[ccy]) || 0);
    if(!rate) return;
    const freq = divFrequency(divs.map(d=>d.date));
    const lag = ccy === 'THB' ? 21 : 14;          // วันจ่ายโดยประมาณหลัง ex-date
    const base = { ticker:h.ticker, name:h.name || (f.profile && f.profile.name) || h.ticker, qty:h.qty, currency:ccy,
                   freq: freq ? freq.en : null, freqTh: freq ? freq.th : null };
    // รอบที่ ex-date ผ่านไปแล้วใน 12 เดือน → ได้รับแล้ว / รอรับ
    divs.filter(d => { const t = Date.parse(d.date); return t > t0 - 365*DAY && t <= t0; }).forEach(d => {
      const ex = Date.parse(d.date), pay = ex + lag*DAY;
      const got = rec.find(r => r.ticker === h.ticker && r.t >= ex - 3*DAY && r.t <= ex + 75*DAY);
      const amount = got ? got.amt : d.amount * h.qty * rate;
      const status = got ? 'received' : (ex > t0 - 60*DAY ? 'declared' : null);   // เก่ากว่า 60 วันไม่เจอเงิน = ข้าม (ไม่เดาว่าจะได้)
      if(status) events.push({ ...base, exDate:d.date, payDate: got ? iso(got.t) : iso(pay), dps:d.amount, amount, status });
      // ฉายภาพปีหน้า: รอบเดียวกัน + 1 ปี
      const exN = ex + 365*DAY;
      if(exN > t0 && exN <= t0 + 365*DAY)
        events.push({ ...base, exDate: iso(exN), payDate: iso(exN + lag*DAY), dps:d.amount,
                      amount: d.amount * h.qty * rate, status:'estimated' });
    });
  });
  events.sort((a,b)=> a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : a.ticker.localeCompare(b.ticker));
  const months = [];
  for(let i=0;i<12;i++){
    const d = new Date(now.getFullYear(), now.getMonth()+i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, declared:0, estimated:0, received:0 });
  }
  events.forEach(e => { const m = months.find(x => x.key === e.payDate.slice(0,7)); if(m) m[e.status] += e.amount; });
  // รายได้ต่อปี = ทุกรอบที่ "วันจ่าย" อยู่ใน 12 เดือนข้างหน้า (ไม่นับที่ได้รับแล้ว/วันจ่ายผ่านไปแล้ว)
  const fwd = events.filter(e => e.status !== 'received' && Date.parse(e.payDate) > t0 && Date.parse(e.payDate) <= t0 + 365*DAY);
  const annual = fwd.reduce((s,e)=>s+e.amount, 0);
  const yetToReceive = events.filter(e => e.status === 'declared').reduce((s,e)=>s+e.amount, 0);
  return { events, months, annual, monthly: annual/12, daily: annual/365, yetToReceive };
}

// ═══ v66 — REBALANCING (เติมเงิน / ถอนเงิน / ปรับสมดุล) ═══════════════════
// ตัวคำนวณล้วน (ไม่แตะ DOM) · ทดสอบใน scripts/test_rebalance.cjs
// holdings: [{ticker, group, qty, price(บาท/หน่วย), val, cost}] · targets: {ticker: %}
// mode: 'topup' (ซื้ออย่างเดียว) · 'withdraw' (ขายอย่างเดียว) · 'rebalance' (ซื้อ+ขายให้ถึงเป้า)
// หลัก: กองที่ขายไม่ได้ (ALLOC_META illiquid เช่น Provident Fund) ไม่อยู่ในสมการเลย —
//       แบบเดียวกับ computeDeviations() ไม่งั้นจะแนะนำให้ "ขาย PVD" ซึ่งทำไม่ได้
const REBAL_TARGETS_KEY = 'finOS_rebalTargets';
const REBAL_OPTS_KEY    = 'finOS_rebalOpts';
// หน่วยซื้อขายขั้นต่ำต่อกลุ่ม: หุ้นไทยซื้อทีละ 100 หุ้น (board lot) · อื่น ๆ ซื้อเป็นเศษได้
const REBAL_LOT_DEFAULT = { 'Thai Stock':100, 'US Stock':0.0001, 'Crypto':0.000001,
                            'Mutual Fund':0.0001, 'Gold':0.0001, 'Other':1 };
function rebalLot(group, opts){
  const o = (opts && opts.lots) || {};
  const v = Number(o[group] ?? REBAL_LOT_DEFAULT[group] ?? 1);
  return v > 0 ? v : 1;
}
const _rbIlliquid = h => !!(ALLOC_META[h.group] && ALLOC_META[h.group].illiquid);

// เป้ารายตัวเริ่มต้น: เป้าของกลุ่ม (getTargets) แบ่งให้แต่ละตัวตามสัดส่วนมูลค่าในกลุ่มตอนนี้
// แล้ว normalize ให้รวม 100 เฉพาะกลุ่มที่ถืออยู่จริงและขายได้ (ไม่รวม Cash)
function defaultRebalTargets(holdings){
  const gt = getTargets();
  const liq = (holdings||[]).filter(h => !_rbIlliquid(h) && h.val > 0);
  const byG = {};
  liq.forEach(h => { byG[h.group] = (byG[h.group]||0) + h.val; });
  const raw = {};
  liq.forEach(h => { const g = gt[h.group] ?? gt['Other'] ?? 0; raw[h.ticker] = g * h.val / byG[h.group]; });
  const sum = Object.values(raw).reduce((a,b)=>a+b, 0);
  const out = {};
  Object.entries(raw).forEach(([k,v]) => { out[k] = sum > 0 ? Math.round(v/sum*1000)/10 : 0; });
  return out;
}
function getRebalTargets(holdings){
  try{ const s = JSON.parse(localStorage.getItem(REBAL_TARGETS_KEY)||'null');
       if(s && typeof s==='object' && Object.keys(s).length) return s; }catch(e){}
  return defaultRebalTargets(holdings);
}
function getRebalOpts(){
  try{ const s = JSON.parse(localStorage.getItem(REBAL_OPTS_KEY)||'null'); if(s && typeof s==='object') return s; }catch(e){}
  return { lots:{} };
}

// หา r ที่ Σ f(r) = amount ด้วย bisection (f เป็นฟังก์ชันเพิ่มขึ้นตาม r)
function _rbSolve(f, amount, lo, hi){
  for(let i=0;i<80;i++){ const m=(lo+hi)/2; if(f(m) < amount) lo=m; else hi=m; }
  return hi;
}
function rebalancePlan(holdings, targets, amount, mode, opts){
  mode = mode || 'topup';
  amount = Math.max(0, Number(amount)||0);
  const H = (holdings||[]).filter(h => !_rbIlliquid(h) && h.price > 0 &&
                                       ((targets||{})[h.ticker] > 0 || h.val > 0));
  const tSum = H.reduce((s,h)=>s+(Number(targets[h.ticker])||0), 0);
  const cur  = H.reduce((s,h)=>s+(h.val||0), 0);
  const empty = { rows:[], totalBuy:0, totalSell:0, leftover:amount, totalBefore:cur, totalAfter:cur, targetSum:tSum };
  if(!H.length || tSum <= 0) return empty;
  const tw = h => (Number(targets[h.ticker])||0) / tSum;          // สัดส่วนเป้า (normalize เผื่อรวมไม่ถึง 100)
  const after = mode==='withdraw' ? Math.max(0, cur-amount) : cur+amount;
  const want  = h => tw(h) * after;
  const raw = {};
  if(mode === 'topup'){
    // water-filling: ยกตัวที่ขาดเป้ามากสุด (val/want ต่ำสุด) ขึ้นไประดับเดียวกัน r จนเงินหมด
    const f = r => H.reduce((s,h)=>s+Math.max(0, r*want(h) - h.val), 0);
    const r = f(1) >= amount ? _rbSolve(f, amount, 0, 1) : 1;
    H.forEach(h => { raw[h.ticker] = Math.max(0, r*want(h) - h.val); });
    const spent = Object.values(raw).reduce((a,b)=>a+b,0);
    if(spent < amount - 0.01){               // ทุกตัวถึงเป้าแล้ว เงินเหลือ → แบ่งตามเป้า
      const extra = amount - spent; H.forEach(h => { raw[h.ticker] += extra * tw(h); });
    }
  } else if(mode === 'withdraw'){
    // ลดตัวที่เกินเป้ามากสุด (val/want สูงสุด) ลงมาระดับเดียวกัน r จนได้เงินครบ
    const f = r => H.reduce((s,h)=>s+Math.min(h.val, Math.max(0, h.val - r*want(h))), 0);
    const target = Math.min(amount, cur);
    // f ลดลงเมื่อ r เพิ่ม → หา r ใน [0, rMax] ที่ f(r)=target
    const rMax = Math.max(1, ...H.map(h => want(h)>0 ? h.val/want(h) : 1)) + 1;
    let lo=0, hi=rMax;
    for(let i=0;i<80;i++){ const m=(lo+hi)/2; if(f(m) > target) lo=m; else hi=m; }
    H.forEach(h => { raw[h.ticker] = -Math.min(h.val, Math.max(0, h.val - hi*want(h))); });
  } else {
    H.forEach(h => { raw[h.ticker] = want(h) - h.val; });
  }
  // ปัดเป็นหน่วยซื้อขาย · ซื้อปัดลง (ไม่เกินงบ) · ขายปัดขึ้น (ได้เงินไม่ขาด) แต่ไม่เกินที่ถือ
  const unitsOf = (h, thb) => {
    const lot = rebalLot(h.group, opts);
    const u = thb / h.price / lot;
    let n = Math.floor(u + 1e-9);   // ซื้อ: ปัดลง (ไม่เกินงบ) · ขาย (u ติดลบ): ปัดออกจากศูนย์ = ขายพอให้ได้เงินครบ
    if(thb < 0) n = Math.max(n, -Math.floor((h.qty||0)/lot + 1e-9));
    return +(n*lot).toFixed(8);
  };
  const units = {}; H.forEach(h => { units[h.ticker] = unitsOf(h, raw[h.ticker]); });
  // เงินเหลือจากการปัด (โหมดเติมเงิน) → เติมทีละ lot ให้ตัวที่ขาดเป้ามากสุดที่ยังซื้อไหว
  if(mode === 'topup'){
    let left = amount - H.reduce((s,h)=>s+units[h.ticker]*h.price, 0);
    for(let guard=0; guard<500; guard++){
      const cand = H.map(h => { const lot=rebalLot(h.group,opts), cost=lot*h.price;
          const v=h.val+units[h.ticker]*h.price; return {h,lot,cost,ratio: want(h)>0 ? v/want(h) : Infinity}; })
        .filter(c => c.cost <= left + 1e-6 && c.ratio < 1).sort((a,b)=>a.ratio-b.ratio)[0];
      if(!cand || cand.cost < 0.01) break;
      units[cand.h.ticker] = +(units[cand.h.ticker] + cand.lot).toFixed(8); left -= cand.cost;
    }
  }
  // ถอนเงิน: ปัดขึ้นรายตัวทำให้ขายเกิน (หุ้นไทยทีละ 100 หุ้น) → คืน lot ที่ไม่จำเป็น
  // ตราบใดที่ยังได้เงิน ≥ ที่ถอน · คืนจากตัวที่หลังขายแล้วต่ำกว่าเป้ามากสุดก่อน
  if(mode === 'withdraw'){
    const need = Math.min(amount, cur);
    let got = -H.reduce((s,h)=>s+units[h.ticker]*h.price, 0);
    for(let guard=0; guard<500; guard++){
      const cand = H.filter(h => units[h.ticker] < 0).map(h => { const lot=rebalLot(h.group,opts);
          const v=h.val+units[h.ticker]*h.price; return {h,lot,back:lot*h.price,ratio: want(h)>0 ? v/want(h) : Infinity}; })
        .filter(c => got - c.back >= need - 1e-6).sort((a,b)=>a.ratio-b.ratio)[0];
      if(!cand) break;
      units[cand.h.ticker] = +(units[cand.h.ticker] + cand.lot).toFixed(8); got -= cand.back;
    }
  }
  const gOf = {}; H.forEach(h => { gOf[h.group] = gOf[h.group] || {val:0, tgt:0}; gOf[h.group].val += h.val; gOf[h.group].tgt += tw(h); });
  const rows = H.map(h => {
    const tradeUnits = units[h.ticker], tradeTHB = tradeUnits*h.price, valAfter = h.val + tradeTHB;
    const g = gOf[h.group];
    return { ticker:h.ticker, label:h.label||h.ticker, group:h.group, qty:h.qty, price:h.price, val:h.val, cost:h.cost||0,
      gain:(h.val||0)-(h.cost||0), gainPct: h.cost>0 ? ((h.val||0)-h.cost)/h.cost*100 : null,
      shareNow: cur>0 ? h.val/cur*100 : 0, shareTarget: tw(h)*100,
      shareAfter: after>0 ? valAfter/after*100 : 0,
      catShareNow: g.val>0 ? h.val/g.val*100 : 0, catTarget: g.tgt>0 ? tw(h)/g.tgt*100 : 0,
      lot: rebalLot(h.group, opts), tradeUnits, tradeTHB };
  });
  const totalBuy  = rows.reduce((s,r)=>s+Math.max(0,r.tradeTHB),0);
  const totalSell = rows.reduce((s,r)=>s+Math.max(0,-r.tradeTHB),0);
  const leftover  = mode==='withdraw' ? totalSell-amount : amount - totalBuy + totalSell;
  return { rows, totalBuy, totalSell, leftover, totalBefore:cur, totalAfter:cur+totalBuy-totalSell, targetSum:tSum, mode };
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
// v62 — นับจุดที่มูลค่ากระโดดเกิน 8% ภายใน ≤2 วัน (เกณฑ์เดียวกับ purgeCorruptValueLog v44)
// พอร์ตที่กระจายตัวแทบไม่มีวันขยับ 8% แล้วกลับที่เดิมในวันถัดไป — นั่นคือราคาหลุด ไม่ใช่ตลาด
const VLOG_JUMP_PCT = 0.08, VLOG_MAX_JUMPS = 2;
function valueLogJumps(points){
  const p = (points || []).filter(x => x && x.d && x.v > 0).slice().sort((a, b) => a.d.localeCompare(b.d));
  let jumps = 0;
  for(let i = 1; i < p.length; i++){
    const gap = (Date.parse(p[i].d) - Date.parse(p[i-1].d)) / 864e5;
    if(gap <= 2 && Math.abs(p[i].v / p[i-1].v - 1) > VLOG_JUMP_PCT) jumps++;
  }
  return jumps;
}
/* v62 — ด่านคุณภาพก่อน merge Value_Log จากชีต
   ข้อมูลจริง: Apps Script เขียนค่าเสาร์-อาทิตย์สูงกว่าวันธรรมดา ~15% ทุกสัปดาห์
   (≈ มูลค่าหุ้นไทย + ทอง → วันธรรมดาราคาชุดนี้หลุดเป็น 0 แบบเดียวกับที่ v44 เจอ)
   v44 ล้างประวัติในเครื่องครั้งเดียว แต่ sync ทุกครั้งยัง merge แถวที่กระโดดจากชีตกลับเข้ามา
   ทำให้ TWR และกราฟความมั่งคั่งเอาข้อมูลเสียกลับมาใช้เงียบๆ
   กฎ: ชีตทั้งชุดมีจุดกระโดดเกิน VLOG_MAX_JUMPS → ไม่ merge เลย (ไม่รู้ว่าฝั่งไหนถูก)
   แล้วบอกเหตุผลผ่าน window._vlogSheetReject ให้หน้า Holdings แสดง */
function mergeValueLogFromSheet(rows){
  try{
    window._vlogSheetReject = null;
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
    const fromSheet = Object.values(byDate);
    const jumps = valueLogJumps(fromSheet);
    if(jumps > VLOG_MAX_JUMPS){
      const ds = fromSheet.map(x=>x.d).sort();
      window._vlogSheetReject = { jumps, rows: fromSheet.length, first: ds[0], last: ds[ds.length-1] };
      console.warn('[ValueLog] ไม่ merge Value_Log จากชีต — ค่ากระโดดเกิน 8% ถึง '+jumps+' ครั้งใน '
                   +fromSheet.length+' แถว (ราคาบางตัวหลุดเป็นช่วงๆ)');
      return JSON.parse(localStorage.getItem('finOS_valueLog')||'[]').length;
    }
    const cur = JSON.parse(localStorage.getItem('finOS_valueLog')||'[]');
    cur.forEach(e=>{ if(e && e.d) byDate[e.d] = e; });   // local ชนะวันซ้ำ
    const merged = Object.values(byDate).sort((a,b)=>a.d.localeCompare(b.d)).slice(-730);
    localStorage.setItem('finOS_valueLog', JSON.stringify(merged));
    console.log('[ValueLog] merged from sheet →', merged.length, 'days');
    return merged.length;
  }catch(e){ console.warn('[ValueLog] merge failed:', e.message); return 0; }
}
 
// v62 — ล้างแถวที่เคย merge มาจากชีตก่อนมีด่านคุณภาพ (ทำครั้งเดียว)
// แยกออกได้แม่น: snapshot ที่แอปบันทึกเอง (logValueSnapshot) มีฟิลด์ nw ตั้งแต่ v48
// และผ่านด่าน "ราคาครบทุกตัว" แล้ว ส่วนแถวจากชีตมีแค่ {d, v}
// ลบเฉพาะแถว {d, v} และเฉพาะเมื่อประวัติในเครื่องมีจุดกระโดดเกินเกณฑ์จริง
const VLOG_CLEAN_KEY = 'finOS_valueLogClean_v62';
function cleanSheetSpikesV62(){
  try{
    if(localStorage.getItem(VLOG_CLEAN_KEY)) return null;
    localStorage.setItem(VLOG_CLEAN_KEY, '1');
    const log = JSON.parse(localStorage.getItem('finOS_valueLog')||'[]');
    const jumps = valueLogJumps(log);
    if(jumps <= VLOG_MAX_JUMPS) return null;
    const keep = log.filter(e => e && e.nw != null);
    localStorage.setItem('finOS_valueLog', JSON.stringify(keep));
    console.warn('[valueLog] v62 ล้างแถวจากชีต '+(log.length-keep.length)+' แถว (จุดกระโดด '+jumps
                 +' ครั้ง) · เก็บ snapshot ของแอปไว้ '+keep.length+' แถว');
    return { removed: log.length - keep.length, kept: keep.length, jumps };
  }catch(e){ return null; }
}

// v64 — ลบ priceAt() + benchmarkXIRR() (จำลองพอร์ตเทียบ S&P 500) ออก
// การ์ด "คุณ vs ตลาด" ถูกถอดตั้งแต่ v48 ตามที่ผู้ใช้ขอ ไม่มีที่ไหนเรียกอีกเลย · ดูโค้ดเดิมได้ใน git history
 
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
/* ═══ ageDaysOf — อายุเป็นวันจากค่าวันที่รูปแบบไหนก็ได้ (v52) ═══════════
   อาการที่ทำให้ต้องมีฟังก์ชันนี้: หน้า "ตลาดวันนี้" แสดง "NaN วันก่อน"
   ที่การ์ด S&P 500 · VIX · USD/THB · Bitcoin ขณะที่ทอง กับ S&P vs MA200
   แสดง "วันนี้" ถูกต้อง — ทั้งที่โค้ดคำนวณอายุบรรทัดเดียวกัน
 
   ต้นเหตุ: โค้ดต่อ 'T00:00:00Z' ท้ายค่าดิบเสมอ ถ้าชีตส่งรูปแบบอื่นมา
   (เช่น "22-Sep-2026" หรือ ISO เต็ม หรือ serial ของ Excel) จะได้สตริงที่
   Date.parse อ่านไม่ออก → NaN แล้ว NaN ไหลไปโผล่บนจอตรง ๆ
   shared.js เคยแก้เรื่องนี้ไปแล้วครั้งหนึ่งที่ pipelinePricesTHB (v48 #2)
   แต่แก้เฉพาะจุดนั้น ที่อื่นยังต่อสตริงแบบเดิมอยู่ — คราวนี้รวมเป็นที่เดียว
 
   คืน null เมื่ออ่านวันไม่ออก ไม่ใช่ NaN — เพื่อให้ผู้เรียกแยก
   "ไม่รู้วันที่" ออกจาก "อายุ 0 วัน" ได้ชัดเจน                            */
function ageDaysOf(v){
  if(v == null || v === '') return null;
  let t = NaN;
  if(v instanceof Date){ t = v.getTime(); }
  else if(typeof v === 'number' && isFinite(v)){
    // serial ของ Google Sheets/Excel (25569 = 1970-01-01)
    if(v > 25569 && v < 80000) t = Math.round((v - 25569) * 86400e3);
  } else {
    const s = String(v).trim();
    if(!s) return null;
    // ขึ้นต้นด้วย YYYY-MM-DD → ตัดเอาเฉพาะวัน แล้วตรึงเป็น UTC เที่ยงคืน
    // (ถ้าปล่อยให้ new Date() ตีความเอง จะกลายเป็นเวลาท้องถิ่นแล้วอายุเพี้ยน 1 วัน)
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    t = m ? Date.parse(m[1] + 'T00:00:00Z') : Date.parse(s);
  }
  if(!isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}
window.ageDaysOf = ageDaysOf;
 
function mdAsOf(key){
  const md = loadMarketData();
  const d = md && md.data && md.data[key];
  if(!d || d.updated == null || d.updated === '') return null;
  const s = String(d.updated).trim();
  // v52 — ตัด 10 ตัวแรกเฉพาะเมื่อเป็น ISO จริง ๆ เท่านั้น
  // เดิม slice(0,10) แบบไม่ดูรูปแบบ ทำให้ "22-Sep-2026" กลายเป็น "22-Sep-202"
  // ซึ่งอ่านเป็นวันที่ไม่ได้เลย แล้วอายุกลายเป็น NaN ไหลไปโผล่บนจอ
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0,10) : s;
}
 
function computeRegime(){
  const sig = [];
  const stale = [];
  // อายุสูงสุดที่ยอมรับได้ต่อสัญญาณหนึ่งตัว — ต่างกันตามความถี่ของข้อมูลต้นทาง
  //   ผลตอบแทนพันธบัตร/VIX/ดัชนี = รายวัน → 10 วันก็เก่ามากแล้ว
  //   CPI/ว่างงาน = รายเดือน + BLS ประกาศช้าราว 2 สัปดาห์ → เผื่อ 75 วัน
  // สัญญาณที่เกินอายุถูก "ตัดออกจากการให้คะแนน" ไม่ใช่แค่ทำเป็นสีจาง
  // เพราะค่าเฉลี่ยที่มีตัวเก่าปนอยู่ = ตัวเลขที่ผิดโดยไม่มีใครเห็น
  const push = (o, maxDays) => {
    if(!o) return;
    const lim = maxDays || 10;
    if(o.asOf){
      // v52 — ใช้ ageDaysOf ที่อ่านได้ทุกรูปแบบ แทนการต่อ 'T00:00:00Z' ตายตัว
      const age = ageDaysOf(o.asOf);
      // "อ่านวันไม่ออก" ต้องถูกตัดทิ้งเหมือน "เก่าเกิน" ไม่ใช่ผ่านไปเป็นของสด
      // เดิมถ้า parse ไม่ได้จะได้ NaN แล้วเงื่อนไข isFinite ทำให้ "ผ่าน"
      // = สัญญาณที่ตรวจอายุไม่ได้ถูกนับรวมในค่าเฉลี่ยเหมือนของสด
      // ซึ่งเป็นความผิดแบบเดียวกับที่ทั้งงานนี้ตั้งใจกำจัด
      if(age === null){ stale.push({...o, age:null, limit:lim}); return; }
      if(age > lim){ stale.push({...o, age, limit:lim}); return; }
      o.age = age;
    }
    sig.push(o);
  };
 
  // 1) เงินเฟ้อ — เทียบเป้า Fed 2%
  const cpi = mdNum('US_CPI');
  if(cpi!=null) push({key:'cpi', label:'เงินเฟ้อ US (CPI YoY)', val:cpi.toFixed(1)+'%',
    score: cpi>=4?-2 : cpi>=3?-1 : cpi>=2.5?0 : cpi>=1.5?1 : 0,
    note: cpi>=3?'สูงกว่าเป้า 2% มาก — จำกัดพื้นที่ผ่อนคลายนโยบาย'
        : cpi>=2.5?'ยังเหนือเป้าเล็กน้อย' : 'ใกล้เป้า Fed', asOf: mdAsOf('US_CPI')}, 75);
 
  // 2) ภาวะการเงินระยะสั้น — เทียบ neutral rate ~3%
  // ═══════════════════════════════════════════════════════════════
  // เดิมใช้ FED_RATE (FRED DFEDTARU) ซึ่งเข้าไม่ถึงแล้วตั้งแต่ v44
  // ตัวแทนคือผลตอบแทนตั๋วเงินคลัง 3 เดือน (^IRX) ซึ่งเกาะดอกเบี้ยนโยบาย
  // ใกล้ชิดที่สุดในบรรดาสิ่งที่ดึงได้ฟรี แต่ "ไม่ใช่" ดอกเบี้ยนโยบาย —
  // ป้ายกำกับจึงต้องบอกตามจริง ไม่ใช่เขียนว่า Fed Funds Rate แล้วใส่เลขอื่น
  // (ตลาดคาดการณ์ล่วงหน้า ค่านี้จึงนำ/ตาม Fed ได้หลายสิบ bps ในช่วงเปลี่ยนทิศ)
  const st = mdNum('FED_RATE') ?? mdNum('US3M');
  const stIsFed = mdNum('FED_RATE') != null;
  if(st!=null) push({key:'fed',
    label: stIsFed ? 'Fed Funds Rate' : 'ดอกเบี้ยระยะสั้น (T-bill 3M)',
    val: st.toFixed(2)+'%',
    score: st>=5?-2 : st>=4?-1 : st>=3?0 : 1,
    note: (st>=4?'ตึงตัวกว่า neutral — กดดัน valuation'
        : st>=3?'ใกล้ neutral' : 'ผ่อนคลาย หนุนสินทรัพย์เสี่ยง')
        + (stIsFed?'':' · ใช้ ^IRX แทนดอกเบี้ยนโยบาย'),
    asOf: stIsFed ? mdAsOf('FED_RATE') : mdAsOf('US3M')});
 
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
  // ═══════════════════════════════════════════════════════════════
  // HY OAS ตัวจริงหาฟรีไม่ได้แล้ว (FRED บล็อก · ICE คิดเงิน)
  // ตัวแทนคือ z-score ของอัตราส่วน HYG/IEF กลับเครื่องหมาย: บวก = เครียด
  // หน่วยเป็น "ส่วนเบี่ยงเบนมาตรฐาน" ไม่ใช่ % จึงต้องใช้เกณฑ์คนละชุด
  // ห้ามยัดค่านี้ลง key CREDIT_SPREAD เด็ดขาด — เกณฑ์ 3/4.5/6% จะอ่านค่า
  // ~0.9 ว่า "ผ่อนคลายมาก" ตลอดกาล ซึ่งเป็นความผิดที่ไม่มีใครมองเห็น
  const cs = mdNum('CREDIT_SPREAD');
  const cz = mdNum('CREDIT_STRESS');
  if(cs!=null) push({key:'credit', label:'Credit Spread (HY OAS)', val:cs.toFixed(2)+'%',
    score: cs>=6?-2 : cs>=4.5?-1 : cs>=3?0 : 1,
    note: cs>=4.5?'ตลาดเครดิตเริ่มเครียด' : cs>=3?'ปกติ' : 'ผ่อนคลาย — ความเสี่ยงถูกประเมินต่ำ',
    asOf: mdAsOf('CREDIT_SPREAD')});
  else if(cz!=null) push({key:'credit', label:'ความเครียดเครดิต (HYG/IEF)',
    val:(cz>=0?'+':'')+cz.toFixed(2)+' SD',
    score: cz>=2?-2 : cz>=1?-1 : cz>=-0.5?0 : 1,
    note: cz>=2?'ตลาดเครดิตเครียดผิดปกติ' : cz>=1?'เริ่มตึงกว่าค่าเฉลี่ยปี'
        : cz>=-0.5?'ปกติ' : 'ผ่อนคลาย — ความเสี่ยงถูกประเมินต่ำ',
    asOf: mdAsOf('CREDIT_STRESS')});
 
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
    asOf: mdAsOf('US_CORE_PCE')||mdAsOf('US_CORE_CPI')}, 75);
 
  // 9) ตลาดแรงงาน — เย็นเกินไป = สัญญาณ recession
  const un = mdNum('US_UNEMP');
  if(un!=null) push({key:'unemp', label:'US Unemployment', val:un.toFixed(1)+'%',
    score: un>=5?-2 : un>=4.5?-1 : un>=3.5?1 : 0,
    note: un>=4.5?'ว่างงานสูงขึ้น — อุปสงค์อ่อน' : un>=3.5?'ตลาดแรงงานแข็งแรง':'ตึงตัวมาก',
    asOf: mdAsOf('US_UNEMP')}, 75);
 
  // 10) Real yield — ต้นทุนเงินจริงหลังหักเงินเฟ้อ
  const rr = mdNum('US_REAL10Y');
  if(rr!=null) push({key:'real', label:'Real 10Y (TIPS)', val:rr.toFixed(2)+'%',
    score: rr>=2.5?-2 : rr>=1.8?-1 : rr>=0.5?0 : 1,
    note: rr>=1.8?'ต้นทุนเงินจริงสูง — กดดันสินทรัพย์เสี่ยง' : 'ต้นทุนเงินจริงไม่ตึง',
    asOf: mdAsOf('US_REAL10Y')}, 75);
 
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
           stale,                                  // สัญญาณที่ถูกตัดเพราะเก่าเกิน
           dataAsOf: asOfList.length ? asOfList[asOfList.length-1] : null,
           oldestAsOf: asOfList.length ? asOfList[0] : null };
}
 
// ═══ SIGNALS — สัญญาณรายตัวจาก fetch_signals.py ════════════════════
// pipeline คำนวณ RSI/MA/drawdown/คะแนน มาให้แล้ว ฝั่งนี้ไม่คำนวณซ้ำ
// เหตุผล: ถ้าคำนวณสองที่ วันหนึ่งสูตรจะต่างกันโดยไม่มีใครรู้ (เคยเกิดกับ RSI มาแล้ว)
// หน้าที่ของฟังก์ชันพวกนี้คือ "อ่าน + ตรวจอายุ" เท่านั้น
const SIGNAL_MAX_DAYS = 7;          // สัญญาณเก่ากว่านี้ = ไม่ใช้ตัดสินใจ

/* ══ v60 — เกณฑ์ 3 ชั้น: ประตู · อันดับ · ขนาดไม้ ═══════════════════════
   เลิกใช้ score = trend + timing ทั้งระบบ เหตุผลเต็มอยู่ใน fetch_signals.py
   ย่อ: trend เป็น trend-following (ช่วง −2..+1) · timing เป็น mean-reversion
   (ช่วง −4..+4) การบวกกันให้น้ำหนัก mean-reversion มากกว่าเท่าตัว ระบบจึง
   สั่งลดน้ำหนักของที่แข็งที่สุด (AAPL ที่จุดสูงสุด ได้ score −2 = กล่อง
   "ควรลดน้ำหนัก") และให้ป้ายเดียวกันกับของที่หลุดเทรนด์ไปแล้ว

   ตอนนี้ pipeline ส่ง gate/rank/size มาให้พร้อมใช้ ฝั่งนี้ไม่คำนวณซ้ำ
   — กติกาเดิมของไฟล์นี้: อ่าน + ตรวจอายุ เท่านั้น                        */
const GATE_LABEL = { pass:'ผ่าน', fail:'ไม่ผ่าน', unknown:'ยังไม่รู้' };

// แถวที่ carry มาจาก pipeline รุ่นก่อน v60 ไม่มีฟิลด์ gate — ต้องนับเป็น
// "ยังไม่รู้" ไม่ใช่ "ไม่ผ่าน"  ของเก่าไม่ได้แปลว่าแย่ แปลว่ายังไม่ได้วัด
function sigGate(x){ return (x && x.gate) || 'unknown'; }
function sigLegacy(x){ return !x || x.gate == null; }

// เรียงลำดับมาตรฐานของทั้งระบบ: ผ่านประตูก่อน → อันดับสูงก่อน → ชื่อ
// (เรียงด้วยชื่อท้ายสุดเสมอ เพื่อให้ลำดับคงที่เมื่อค่าเท่ากัน — ลำดับที่
//  สลับไปมาระหว่างรีเฟรชทำให้คนอ่านสับสนว่าอะไรเปลี่ยนจริง)
const GATE_ORD = { pass:0, unknown:1, fail:2 };
function byGateThenRank(a, b){
  return (GATE_ORD[sigGate(a)] - GATE_ORD[sigGate(b)])
      || ((b.rank ?? -99) - (a.rank ?? -99))
      || String(a.ticker).localeCompare(String(b.ticker));
}

/* สรุปชุดสัญญาณด้วยเกณฑ์เดียวกันทั้งสองหน้า
   opts.own = true  → นับเฉพาะของที่ถือจริง (หน้าสัญญาณรายตัว)
   opts.own = false → นับทุกตัว (หน้าภาพรวมตลาด)
   คืน null เมื่อไม่มีข้อมูลเลย                                            */
function gateSummary(list, opts){
  const L = list || [];
  if(!L.length) return null;
  const fresh = L.filter(x=>!x.stale);
  const base  = (opts && opts.own) ? fresh.filter(x=>(x.kind||'holding')==='holding') : fresh;
  const pass  = base.filter(x=>sigGate(x)==='pass').sort(byGateThenRank);
  const fail  = base.filter(x=>sigGate(x)==='fail').sort(byGateThenRank);
  const unk   = base.filter(x=>sigGate(x)==='unknown');
  const withTrend = base.filter(x=>x.ma200);
  return {
    count: base.length,
    stale: L.length - fresh.length,
    ref:   fresh.length - base.length,
    pass, fail, unknown: unk,
    legacy: base.filter(sigLegacy).length,
    passPct: base.length ? Math.round(100*pass.length/base.length) : null,
    breadth: withTrend.length
      ? Math.round(100 * withTrend.filter(x=>x.ma200==='Above').length / withTrend.length)
      : null,
    // ของที่ผ่านประตูแล้วยัง "ถูก" ด้วย — จังหวะที่ดีที่สุดตามนิยามของระบบนี้
    best: pass.filter(x=>(x.size ?? 1) >= 1.25),
  };
}
 
function loadSignals(){
  const act = loadActions();
  const s = act && act.signals;
  if(!s || !Object.keys(s).length) return null;
  const now = Date.now();
  const out = [];
  Object.entries(s).forEach(([tk, d])=>{
    if(!d || typeof d !== 'object') return;
    const age = ageDaysOf(d.updated);   // v52 — อ่านได้ทุกรูปแบบ ไม่ใช่แค่ ISO
    out.push({ ticker: tk, ...d, age, stale: age == null || age > SIGNAL_MAX_DAYS });
  });
  out.sort(byGateThenRank);   // v60 — ผ่านประตูก่อน แล้วค่อยอันดับ
  return out;
}
 
function loadRisk(){
  const act = loadActions();
  const r = act && act.risk;
  if(!r || !r.level) return null;
  /* v54 — pipeline คงบล็อก risk ของรอบก่อนไว้เมื่อ fetch_signals ล้ม
     ถ้าไม่เช็คอายุ ป้าย "ปกติ" ของเมื่อสัปดาห์ก่อนจะแสดงเหมือนเป็นของวันนี้ */
  const age = ageDaysOf(r.computed_at);
  if(age == null || age > SIGNAL_MAX_DAYS) return null;
  // ธงเรียงจากรุนแรงมากไปน้อย — คนอ่านบรรทัดแรกก่อนเสมอ
  const flags = (r.flags||[]).slice().sort((a,b)=>(b.sev||0)-(a.sev||0));
  return { ...r, flags };
}
 
// สรุปสัญญาณทั้งพอร์ต — v60 ใช้ "ประตู" ไม่ใช่คะแนนรวม
/* v53 ยังใช้อยู่: สรุปต้องนับเฉพาะ "ของที่ถือจริง"
   อาการเดิม: การ์ด "ควรลดน้ำหนัก" ขึ้นว่า AAPL, JEPI, META, NASDAQ
   NASDAQ เป็นดัชนีอ้างอิง ไม่ใช่สิ่งที่ถืออยู่ — จะ "ลดน้ำหนัก" ไม่ได้
   ส่วน USDT เป็น stablecoin ไม่มีเทรนด์ให้วัดตั้งแต่แรก
   pipeline ติดป้าย kind มาให้แล้ว ที่นี่แค่กรอง */
function signalSummary(list){
  return gateSummary(list || loadSignals(), {own:true});
}

// ══════════════════════════════════════════════════════════════════════
// v59 — WATCHLIST: "ภาพรวมตลาด" 25 ตัวที่ยังไม่ได้ถือ
// ══════════════════════════════════════════════════════════════════════
// อ่านบล็อก watchlist ที่ fetch_signals.py เขียน — กติกาเดียวกับ loadSignals()
// คือ "อ่าน + ตรวจอายุ" เท่านั้น ห้ามคำนวณ RSI/MA/คะแนนซ้ำที่นี่เด็ดขาด
//
// ทำไมต้องแยกจาก loadSignals(): สองชุดนี้ตอบคนละคำถามและมีฐานคนละอัน
//   signals   = ของที่ถืออยู่จริง → ใช้คิด breadth ของพอร์ตและ "ควรลดน้ำหนัก"
//   watchlist = ของที่ยังไม่ถือ   → ใช้คิด "ตลาดมีอะไรน่าเข้า"
// ถ้ารวมกันเป็นชุดเดียว จะกลับไปเป็นบั๊ก v53 ที่การ์ด "ควรลดน้ำหนัก" ขึ้นชื่อ
// ของที่ไม่ได้ถือ (NASDAQ) — คำแนะนำที่ทำตามไม่ได้คือคำแนะนำที่ผิด
const WATCH_CAT_ORDER = ['fund','us','th','gold','crypto'];
const WATCH_CAT_LABEL = { fund:'กองทุน / ETF', us:'หุ้นสหรัฐ', th:'หุ้นไทย',
                          gold:'ทองคำ', crypto:'คริปโต', other:'อื่น ๆ' };

function loadWatchlist(){
  const act = loadActions();
  const w = act && act.watchlist;
  if(!w || !Object.keys(w).length) return null;
  /* ติดธง "ถืออยู่แล้ว" ด้วยสัญลักษณ์ Yahoo ไม่ใช่ชื่อ key
     key ของพอร์ตมาจากชีต (BTC · VOO) ส่วน key ของ watchlist ตั้งในสคริปต์
     (BTC-USD · VOO) — เทียบด้วย key ตรง ๆ จะพลาด BTC ทุกครั้ง
     ประโยชน์: หน้าเว็บจะได้ไม่เชียร์ให้ "เข้าใหม่" ในสิ่งที่ถืออยู่แล้ว
     ซึ่งคำถามจริงของมันคือ "ควรเติมเพิ่มไหม" — นั่นคือหน้าสัญญาณรายตัว */
  const heldSyms = new Set();
  Object.values((act && act.signals) || {}).forEach(d=>{
    if(d && d.sym && (d.kind||'holding')==='holding')
      heldSyms.add(String(d.sym).toUpperCase());
  });
  const out = [];
  Object.entries(w).forEach(([tk, d])=>{
    if(!d || typeof d !== 'object') return;
    const age = ageDaysOf(d.updated);
    out.push({ ticker: tk, ...d, age,
               stale: age == null || age > SIGNAL_MAX_DAYS,
               held: heldSyms.has(String(d.sym||'').toUpperCase()) });
  });
  out.sort(byGateThenRank);   // v60 — ผ่านประตูก่อน แล้วค่อยอันดับ
  return out;
}

/* สรุป watchlist — "น่าเข้า" = ผ่านประตู แล้วเรียงด้วยอันดับ
   เกณฑ์เดียวกับหน้าสัญญาณรายตัวเป๊ะ ๆ ต่างกันแค่ฐานข้อมูล
   เพิ่มสรุปรายหมวดไว้ตอบคำถามก่อนหน้า: "เงินควรไปทางไหน" ก่อน "ตัวไหน" */
function watchSummary(list){
  const L = list || loadWatchlist();
  if(!L || !L.length) return null;
  const sum = gateSummary(L, {own:false});
  if(!sum) return null;
  const byCat = {};
  L.filter(x=>!x.stale).forEach(x=>{
    const c = x.cat || 'other';
    const o = (byCat[c] = byCat[c] || { n:0, pass:0, known:0, up:0, sumRank:0, nRank:0 });
    o.n++;
    if(sigGate(x)==='pass') o.pass++;
    if(x.ma200){ o.known++; if(x.ma200==='Above') o.up++; }
    if(x.rank != null){ o.sumRank += x.rank; o.nRank++; }
  });
  Object.values(byCat).forEach(o=>{
    o.passPct  = o.n ? Math.round(100*o.pass/o.n) : null;
    o.breadth  = o.known ? Math.round(100*o.up/o.known) : null;
    o.avgRank  = o.nRank ? o.sumRank/o.nRank : null;
  });
  return { ...sum, byCat };
}

// ══════════════════════════════════════════════════════════════════════
// v59 — PAPER BOT: พอร์ตจำลองจาก scripts/bot_paper.py
// ══════════════════════════════════════════════════════════════════════
// ⚠️ พอร์ตนี้ไม่ใช่เงินจริง และไม่มีจุดไหนในระบบที่ส่งคำสั่งซื้อขายออกไป
// bot_paper.py เขียนไฟล์ JSON อย่างเดียว ไม่มี API key ของ exchange ที่ไหน
//
// bot-paper.json เป็นไฟล์แยกจาก market-data.json โดยเจตนา: ถ้าอยู่ไฟล์เดียวกัน
// รอบที่ bot พังจะทำให้ราคาทั้งพอร์ตของผู้ใช้หายไปด้วย — ความเสียหายต้องจำกัด
// อยู่ในขอบเขตของสิ่งที่พัง เหมือนที่ fetch_signals.py แยกจาก fetch_market_data.py
const BOT_MAX_DAYS = 3;            // bot รันทุกรอบ pipeline (2 ครั้ง/วัน)
function loadBotPaper(){
  try{ return JSON.parse(localStorage.getItem('finOS_bot')||'null'); }
  catch(e){ return null; }
}
async function fetchBotPaper(){
  try{
    // cache-bust ถังละชั่วโมง + no-store — เหตุผลเดียวกับ fetchActionsData()
    const bucket = Math.floor(Date.now()/36e5);
    const r = await fetch('bot-paper.json?t='+bucket, {cache:'no-store'});
    if(!r.ok){
      // 404 = ยังไม่เคยรัน bot เลย ไม่ใช่ error ที่ต้องตะโกน
      if(r.status !== 404) console.warn('[bot] bot-paper.json HTTP '+r.status);
      return null;
    }
    const j = await r.json();
    if(j && j.stats){ localStorage.setItem('finOS_bot', JSON.stringify(j)); return j; }
    console.warn('[bot] bot-paper.json ไม่มีคีย์ stats — รูปแบบไฟล์เปลี่ยน?');
  }catch(e){ console.warn('[bot] ดึง bot-paper.json ไม่สำเร็จ:', e.message); }
  return null;
}
// คืน {state, age, stale} หรือ null — ต้องตรวจอายุเสมอ ด้วยเหตุผลเดียวกับ
// loadRisk(): พอร์ตจำลองที่หยุดเดินไปแล้ว 3 วัน แต่แสดงเหมือนเป็นของวันนี้
// คือการรายงานผลการทดลองที่ไม่ได้ทำ
function botStatus(){
  const b = loadBotPaper();
  if(!b || !b.stats) return null;
  const age = ageDaysOf(b.computed_at);
  return { state: b, age, stale: age == null || age > BOT_MAX_DAYS };
}

// ══════════════════════════════════════════════════════════════════════
// v55 — METRIC REGISTRY: ตัวชี้วัดที่หลายหน้าใช้ร่วมกัน คำนวณที่นี่ที่เดียว
// ══════════════════════════════════════════════════════════════════════
// กติกา: ชื่อเดียวกัน = สูตรเดียวกันทุกหน้า ถ้าต้องการสูตรอื่นต้องตั้งชื่ออื่น
// ก่อนหน้านี้ Saving rate มี 3 สูตร · Fee ratio มี 3 ตัวหาร · ความกระจุกตัวมี 2 มุม
// ทำให้ Overview บอก −18% ขณะที่ Analyst Desk บอก +18% จากข้อมูลชุดเดียวกัน

// ── 1. Saving rate (นิยามสากล) ───────────────────────────────────────
// saving rate = (รายได้ − รายจ่ายเพื่อการบริโภค) ÷ รายได้
// เงินที่เหลือนับเป็น "เงินออม" ไม่ว่าจะถูกโอนไปลงทุนหรือยังค้างในบัญชี
// รายจ่าย = Expense + Bills + Debt (ยอดรูดบัตร + ค่างวด/ใช้หนี้จากบัญชีธนาคาร — แยกดูได้ด้วย debtSplit)
//   การจ่ายบัตรจากบัญชีธนาคาร (−X ธนาคาร, +X บัตร) หักล้างกันเองในแถวเดียว จึงไม่นับซ้ำ
// ใช้ยอดที่มีเครื่องหมาย: รายจ่าย = ลบ, เงินคืน/refund = บวก (ลดรายจ่าย)
// แถว Savings (โอนไปออม/ลงทุน) ไม่ใช่รายจ่าย → ไม่อยู่ในสูตรนี้
// อัตราที่ "ลงทุนจริง" ดูที่ Invest rate ในหน้า Wealth Engine (จาก Asset_Tracker)
const SPEND_TX_TYPES = ['Expense','Bills','Debt'];
function savingFromSummary(s){
  const income = Number(s && s.income) || 0;
  const spend  = -((Number(s && s.expense) || 0) + (Number(s && s.debt) || 0));
  const saved  = income - spend;
  return { income, spend, saved, rate: income > 0 ? saved / income * 100 : null };
}

// ── 2. Fee ratio (transaction cost) ─────────────────────────────────
// ค่าธรรมเนียม+ภาษีของการซื้อและการขาย ÷ มูลค่าซื้อขายรวม (ซื้อ + ขาย)
// เป็นวิธีเดียวกับที่โบรกและกองทุนวัด transaction cost (% ของ turnover)
// เดิมนับค่าธรรมเนียมเฉพาะฝั่งซื้อ — ค่าธรรมเนียมตอนขายหายไปทั้งหมด
const FEE_WARN_PCT = 0.5;      // เกิน 0.5% ของมูลค่าซื้อขาย = แพงเกินควร
function feeStats(trackerRows){
  let fees = 0, traded = 0, buyFees = 0, sellFees = 0;
  (trackerRows || []).forEach(r => {
    const tt = String(r && r.txType || '').trim();
    const c = Math.abs(Number(r.commTHB) || 0);
    if(tt === 'Buy' || tt === 'Split'){ fees += c; buyFees += c; }
    else if(tt === 'Sell'){ fees += c; sellFees += c; }
    if(tt === 'Buy' || tt === 'Sell') traded += Math.abs(Number(r.amtTHB) || 0);
  });
  const ratio = traded > 0 ? fees / traded * 100 : null;
  return { fees, buyFees, sellFees, traded, ratio,
           level: ratio == null ? 'g' : ratio > FEE_WARN_PCT ? 'y' : 'g' };
}

// ── 3. ความกระจุกตัว (single-position) ────────────────────────────────
// หลักสากลวัดน้ำหนักของสินทรัพย์ "รายตัว" เทียบทั้งพอร์ต ไม่ใช่รายกลุ่ม
//   > 10% = เริ่มกระจุก (y) · > 20% = สูง (r)
// ยกเว้นสิ่งที่กระจายความเสี่ยงในตัวเองอยู่แล้ว: ETF ดัชนี · กองทุนรวม · PF
// (VOO 30% ไม่ใช่ความเสี่ยงแบบเดียวกับหุ้นตัวเดียว 30%)
// ทอง/คริปโตรายตัว/หุ้นรายตัว ถูกนับตามปกติ
const CONC_WARN_PCT = 10, CONC_HIGH_PCT = 20;
const DIVERSIFIED_TICKERS = new Set(['VOO','VTI','VT','SPY','IVV','QQQ','JEPI','SCHD','VXUS','BND','VEA','VWO']);
const DIVERSIFIED_GROUPS  = new Set(['Mutual Fund','Provident Fund']);
function isDiversifiedHolding(a){
  if(!a) return false;
  if(DIVERSIFIED_GROUPS.has(a.group)) return true;
  if(DIVERSIFIED_TICKERS.has(String(a.ticker || '').toUpperCase())) return true;
  return /\bETF\b|index fund|กองทุน/i.test(String(a.industry || ''));
}
function concentrationCheck(assets){
  const held = (assets || []).filter(a => a && a.val > 0);
  const total = held.reduce((s, a) => s + a.val, 0);
  const single = held.filter(a => !isDiversifiedHolding(a)).sort((a, b) => b.val - a.val);
  if(!(total > 0) || !single.length) return { total, top: null, pct: 0, level: 'g', top3Pct: 0, top3: [] };
  const top = single[0], pct = top.val / total * 100;
  const top3 = single.slice(0, 3);
  return { total, top, pct, top3, top3Pct: top3.reduce((s, a) => s + a.val, 0) / total * 100,
           level: pct > CONC_HIGH_PCT ? 'r' : pct > CONC_WARN_PCT ? 'y' : 'g',
           excluded: held.filter(isDiversifiedHolding).map(a => a.ticker) };
}

// ── 4. เงินเข้าความมั่งคั่งต่อเดือน (v62) ────────────────────────────
// เดิมคำถามเดียว "เดือนละเท่าไรที่ทำให้รวยขึ้น" มี 2 สูตร:
//   หน้าเป้าหมาย = เฉลี่ยทุกเดือนตั้งแต่เริ่มบันทึก ของ (รายได้ − รายจ่าย)
//   FIRE Analyst = เฉลี่ย 6 เดือน ของ (ยอดโอนไปลงทุน + ส่วนเกินเฉพาะเดือนที่เป็นบวก)
//     เดือนที่ใช้เกินรายได้ถูกปัดเป็น 0 แทนที่จะหัก → ดูเก็บได้มากกว่าจริง
// ข้อมูลจริงรอบทดสอบ: สองหน้าได้ ETA ถึงเป้าเดียวกันต่างกันราว 3.5 ปี
// นิยามเดียว: saved ของ savingFromSummary() เฉลี่ย 12 เดือนล่าสุด — เดือนติดลบหักจริง
//   ยอดโอนไปลงทุน (Savings) ไม่ใช่เงินเพิ่ม มันคือการย้ายเงินสดเข้าพอร์ต
//   12 เดือน = รอบปีเต็ม เบี้ยประกันรายปีและโบนัสอยู่ในค่าเฉลี่ยพอดีหนึ่งครั้ง
const CONTRIB_MONTHS = 12;
function monthlyWealthContrib(months, n){
  const rec = (months || []).slice(-(n || CONTRIB_MONTHS));
  if(!rec.length) return { avg: 0, n: 0 };
  const tot = rec.reduce((s, x) => s + savingFromSummary(x).saved, 0);
  return { avg: tot / rec.length, n: rec.length };
}
// ฉายจำนวนเดือนถึงเป้า — สูตรเดียวของหน้าเป้าหมายและ FIRE Analyst (v62)
// ผลตอบแทนคิดเฉพาะส่วนที่ลงทุน (investedShare) · อัตรารายเดือนแบบ effective (1+r)^(1/12)−1
// เดิม FIRE Analyst ใช้ r/12 และทบต้นทั้งก้อนรวมเงินสด → เร็วกว่าหน้าเป้าหมายเสมอ
// คืน 0 ถ้าถึงแล้ว · null ถ้าเกิน max เดือน
function monthsToGoal(o){
  const goal = Number(o && o.goal) || 0, pmt = Number(o && o.contrib) || 0;
  let nw = Number(o && o.netWorth) || 0;
  if(nw >= goal) return 0;
  const share = (o.investedShare == null || !isFinite(o.investedShare)) ? 1
              : Math.max(0, Math.min(1, Number(o.investedShare)));
  const rM = Math.pow(1 + (Number(o.annualPct) || 0) / 100, 1/12) - 1;
  const MAX = o.max || 1200;
  let m = 0;
  while(nw < goal && m < MAX){ nw += nw * share * rM; nw += pmt; m++; }
  return m >= MAX ? null : m;
}

// ── 5. สัดส่วนอิงดอลลาร์ (v62) ───────────────────────────────────────
// เดิม 3 จุดใช้ 2 เกณฑ์: Overview + Risk Analyst ดู a.currency (FX_Rate ในชีต > 1)
// ส่วนหน้าต้นทุนดูประเภทสินทรัพย์ — คริปโตที่ซื้อผ่าน Bitkub/Binance TH บันทึก FX 1
// จึงถูกนับเป็นบาท ทั้งที่ราคาอ้างอิงดอลลาร์ (บาทแข็ง = มูลค่าเป็นบาทลดจริง)
// ข้อมูลจริงรอบทดสอบ: Risk Analyst กับหน้าต้นทุนต่างกันกว่า 2 เท่าจากพอร์ตเดียวกัน
const USD_LINKED_GROUPS = /US.?Stock|Crypto|Gold/i;
function isUsdLinked(a){
  return !!a && (a.currency === 'USD' || USD_LINKED_GROUPS.test(String(a.group || a.type || '')));
}
function usdExposure(list){
  const held = (list || []).filter(a => a && a.val > 0);
  const total = held.reduce((s, a) => s + a.val, 0);
  const usd = held.filter(isUsdLinked).reduce((s, a) => s + a.val, 0);
  return { usd, thb: total - usd, total, pct: total > 0 ? usd / total * 100 : 0 };
}

// ── 6. แยกแถว Debt เป็น "รูดบัตร" กับ "ผ่อนหนี้" (v62) ───────────────
// v61 เปลี่ยนป้าย Debt เป็น "รูดบัตร" จากข้อมูลจำลองที่ทุกแถว Debt แตะบัตรเครดิต
// ข้อมูลจริง: ราว 1/3–1/2 ของยอด Debt เป็นค่างวด/ใช้หนี้ที่จ่ายจากบัญชีธนาคาร ไม่ใช่การรูดบัตร
// เกณฑ์: แถวที่แตะบัญชีเครดิต (isCreditAccount) = รูดบัตร · ที่เหลือ = ผ่อนหนี้
// แถวจ่ายบัตร (−ธนาคาร +บัตร) ยอดรวมเป็น 0 อยู่แล้ว ไม่กระทบฝั่งไหน
function debtSplit(rows, bals){
  const credit = new Set((bals || []).filter(isCreditAccount).map(b => b.name));
  let card = 0, loan = 0, nCard = 0, nLoan = 0;
  (rows || []).forEach(r => {
    if(!r || r.type !== 'Debt') return;
    const a = Number(r.amount) || 0;
    if(!a) return;
    if(Object.keys(r.acct || {}).some(k => credit.has(k))){ card += a; nCard++; }
    else { loan += a; nLoan++; }
  });
  return { card, loan, nCard, nLoan };
}

// ── 6b. ยอดใช้จ่ายรายหมวดสำหรับงบประมาณ (v63) ────────────────────────
// เดิมงบนับแค่ Expense/Bills — รายจ่ายที่รูดบัตร (แถว Debt) ไม่เข้างบเลย งบจึงดู "เหลือ" เกินจริง
// เกณฑ์เดียวกับ debtSplit(): แถว Debt ที่แตะบัญชีเครดิต = รูดบัตร → นับเข้าหมวดในคอลัมน์ Type
//   · เฉพาะ amount < 0 (เงินออก) — แถวจ่ายบัตร (−ธนาคาร +บัตร) รวมเป็น 0 · คืนเงิน/ยอดบวก ไม่นับ
//   · แถว Debt ที่ไม่แตะบัตร (ค่างวด/ใช้หนี้) ไม่ใช่การใช้จ่ายตามหมวด → ไม่นับ
// ไม่เปลี่ยนยอดบัตร/ยอดหนี้/saving rate — ใช้เฉพาะหน้างบและป้ายงบเกิน
function budgetSpendMap(rows, bals){
  const credit = new Set((bals || []).filter(isCreditAccount).map(b => b.name));
  const map = {}, card = {};
  let cardTotal = 0;
  (rows || []).forEach(r => {
    if(!r) return;
    const cat = r.category || 'Other';
    if(r.type === 'Expense' || r.type === 'Bills'){
      // v68 #7 — มีเครื่องหมาย: รายการบวก (เงินคืน/refund) หักออกจากหมวด · เดิม Math.abs นับเป็นรายจ่ายเพิ่ม
      map[cat] = (map[cat] || 0) - (Number(r.amount) || 0);
      return;
    }
    if(r.type !== 'Debt') return;
    const a = Number(r.amount) || 0;
    if(a >= 0) return;
    if(!Object.keys(r.acct || {}).some(k => credit.has(k))) return;
    map[cat]  = (map[cat]  || 0) - a;
    card[cat] = (card[cat] || 0) - a;
    cardTotal -= a;
  });
  // หมวดที่เงินคืนมากกว่าจ่าย = ใช้ไป 0 (ไม่ติดลบ)
  Object.keys(map).forEach(k => { map[k] = Math.max(0, Math.round(map[k]*100)/100); });
  return { map, card, cardTotal };
}

// ═══ isoLocal — วันที่ YYYY-MM-DD จาก Date "ตามปฏิทินท้องถิ่น" (v61) ═══
// อาการ: ขาย TSLA วันที่ 10 มี.ค. → หน้า Realized ขึ้น 9 มี.ค. · ปันผล 1 เม.ย. → 31 มี.ค.
// ต้นเหตุ: parseDate() คืน Date ที่ "เที่ยงคืนเวลาท้องถิ่น" แล้วมีคนเรียก toISOString()
// ซึ่งแปลงเป็น UTC — ในไทย (UTC+7) เที่ยงคืนวันที่ 10 คือ 17:00 ของวันที่ 9 ใน UTC
// ธุรกรรมในชีต Transaction ไม่โดนเพราะสร้าง dateStr ด้วย getFullYear/getMonth/getDate
// อยู่แล้ว ฟังก์ชันนี้ทำแบบเดียวกัน — ใช้กับ Date ที่มาจาก parseDate() เท่านั้น
// (Date ที่สร้างจากสตริง 'YYYY-MM-DDT00:00:00Z' เป็นเวลา UTC อยู่แล้ว ใช้ toISOString ได้ตามเดิม)
function isoLocal(d){
  if(!(d instanceof Date) || isNaN(d)) return '';
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')
       + '-' + String(d.getDate()).padStart(2,'0');
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
/* BUGFIX v48 #17 — บัญชีออมทรัพย์โผล่ในหน้า Debt
   เดิมตัดสินด้วย `b.balance < 0` ตรงๆ ยอดที่เป็นผลรวมของทศนิยมหลายร้อยแถว
   มักลงเอยที่ −0.0000000001 (floating point) แทนที่จะเป็น 0 พอดี
   ผลคือบัญชีที่ยอดเป็นศูนย์จริงๆ ถูกจัดเป็น "หนี้" แล้วโผล่ทั้งในหน้า Debt
   และในบล็อกองค์ประกอบหนี้ ทั้งที่ ยอดค้าง แสดงเป็น ฿0
   แก้: ใช้ threshold 1 สตางค์ + แยก flag ว่าเป็นบัญชีเครดิตจริงหรือไม่ */
const BAL_EPS = 0.005;   // ต่ำกว่า 1 สตางค์ = ถือว่าศูนย์
function isCreditAccount(b){
  return /credit|บัตรเครดิต/i.test(String(b && b.type || ''))
      || /credit card|บัตรเครดิต/i.test(String(b && b.name || ''));
}
function classifyAccount(b){
  if(isCreditAccount(b)) return 'liability';
  return (Number(b.balance) < -BAL_EPS) ? 'liability' : 'cash';
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
  const liabilities = liabAccounts.reduce((s,b)=>{
    const v = Math.abs(Math.min(0, Number(b.balance)||0));
    return s + (v > BAL_EPS ? v : 0);          // #17 — ไม่สะสมเศษทศนิยม
  }, 0);
  return { cashAccounts, liabAccounts, cash, liabilities, net: cash-liabilities };
}
 
// ══════════════════════════════════════════════════════════════════════
// v48 — DEBT COMPOSITION & RECONCILED BALANCES
// ══════════════════════════════════════════════════════════════════════
// ปัญหาที่แก้: ยอดในคอลัมน์บัตรเครดิต (เช่น −35,387.60) เป็น "ยอดสุทธิสะสม
// ของทุกอย่างที่เคยโพสต์เข้าคอลัมน์นั้น" — ยอดรูด, ยอดชำระ, โอนเข้า,
// เงินคืน ปนกันเป็นก้อนเดียว แล้วถูกเรียกว่า "หนี้" ทั้งก้อน
//
// สองอย่างที่ต้องแยกให้ออก และเดิมแยกไม่ได้เลย:
//   1) หนี้ *ประกอบด้วยอะไร* — รูดไปเท่าไร ชำระคืนไปเท่าไร เดือนนี้โตหรือลด
//   2) หนี้ *จริง* คือเท่าไร — ยอดคำนวณจากธุรกรรมที่กรอกมือ ≠ ยอดที่ธนาคารบอก
//      ชีต Reconcile มีคำตอบข้อ 2 อยู่แล้ว แต่ไม่เคยถูกใช้กับตัวเลขหนี้เลย
//      (ใช้แค่โชว์ตารางเทียบในหน้า Accounts)
 
const RECON_TRUST_DAYS = 45;   // ยอดจริงเก่าเกินนี้ = ไม่กล้าใช้แทนยอดคำนวณแล้ว
 
// ── applyReconciliation ──────────────────────────────────────────────
// คืนชุดยอดบัญชีที่ "ใช้ยอดจริงจากธนาคารเมื่อมี และยังไม่เก่าเกินไป"
// คืน { bals, source:{name:'bank'|'computed'|'stale'}, nBank, nStale, asOf }
// หมายเหตุ: ไม่แก้ bals ต้นฉบับ — คืนชุดใหม่เสมอ
// v68 #2 — ยอดที่ใช้ = ยอดจริง ณ วันที่จด + รายการที่กรอกหลังวันนั้น (ส่ง rows = txRows)
//          เดิมใช้ยอดจริงค้างไว้ 45 วัน ไม่สนรายจ่ายที่กรอกตามมา → เงินสด/หนี้/Net Worth ค้างที่วันจด
function applyReconciliation(bals, reconMap, maxAgeDays, rows){
  const maxAge = maxAgeDays == null ? RECON_TRUST_DAYS : maxAgeDays;
  const map = reconMap || {};
  const source = {};
  let nBank = 0, nStale = 0, newest = null;
 
  const out = (bals||[]).map(b=>{
    const rec = map[b.name];
    if(!rec || !isFinite(rec.actual)){ source[b.name]='computed'; return {...b}; }
    const age = rec.date
      ? Math.floor((Date.now() - Date.parse(rec.date+'T00:00:00Z'))/864e5) : null;
    if(age != null && age > maxAge){ source[b.name]='stale'; nStale++; return {...b}; }
    if(rec.date && (!newest || rec.date > newest)) newest = rec.date;
    source[b.name]='bank'; nBank++;
    const bal = Math.round((rec.actual + movementAfter(rows, b.name, rec.date))*100)/100;
    return {...b, balance: bal, computedBalance: b.balance,
            reconDate: rec.date||null, reconDiff: bal - b.balance};
  });
 
  return { bals: out, source, nBank, nStale,
           nTotal: out.length, asOf: newest,
           // ผลต่างรวมที่ถูก "ยอมรับ" เข้าไปในตัวเลข — ต้องโชว์ให้เห็น
           adopted: out.reduce((s,b)=>s+(b.reconDiff||0), 0) };
}
 
// ── debtComposition ──────────────────────────────────────────────────
// แตกยอดคงเหลือของแต่ละบัญชีหนี้ออกตาม "ประเภทธุรกรรม" ที่ทำให้เกิดยอดนั้น
// ต้องการ txRows ที่มี r.acct = {ชื่อบัญชี: จำนวน} (เพิ่มใน v48)
//
// นิยามที่ใช้ (มุมมองบัตรเครดิต ยอดติดลบ = เป็นหนี้):
//   charged  = ยอดที่ทำให้หนี้เพิ่ม  (Expense/Bills/Savings/Debt ที่เป็นลบ)
//   repaid   = ยอดที่ทำให้หนี้ลด     (Transfer/Income หรือรายการบวกใดๆ)
//   ห้ามใช้ประเภทธุรกรรมตัดสินทิศทางอย่างเดียว เพราะ Transfer ใช้ทั้งจ่ายบัตร
//   และรูดบัตรโอนออก — ต้องดูเครื่องหมายของยอดในคอลัมน์บัญชีนั้นจริงๆ
// รวมรายการที่เป็นร้านเดียวกันแต่พิมพ์ต่างกันเล็กน้อยเข้าด้วยกัน
// (ตัดเลขท้าย/วงเล็บ/ช่องว่างซ้ำ แล้วเทียบแบบไม่สนตัวพิมพ์ แต่คืนรูปแบบเดิมที่พบบ่อยสุด)
const _MERCH_CACHE = new Map();
function normMerchant(raw){
  const s0 = String(raw==null?'':raw).trim();
  if(!s0) return '';
  if(_MERCH_CACHE.has(s0)) return _MERCH_CACHE.get(s0);
  const key = s0.toLowerCase()
    .replace(/[（(].*?[)）]/g,' ')
    .replace(/[#\-–—]?\s*\d{1,4}\s*$/,' ')
    .replace(/\s+/g,' ').trim();
  const out = key ? s0.replace(/\s+/g,' ').trim() : s0;
  _MERCH_CACHE.set(s0, out);
  return out;
}
 
function debtComposition(txRows, accountNames, monthKey){
  const want = new Set(accountNames||[]);
  const out = {};
  want.forEach(n=>{ out[n] = { name:n, byType:{}, byMerchant:{}, charged:0, repaid:0, net:0,
                               mCharged:0, mRepaid:0, mNet:0, n:0, mN:0,
                               firstDate:null, lastDate:null, hasDetail:false }; });
 
  (txRows||[]).forEach(r=>{
    if(!r || !r.acct) return;
    Object.entries(r.acct).forEach(([name, amt])=>{
      const o = out[name];
      if(!o || !isFinite(amt) || amt === 0) return;
      o.hasDetail = true;
      /* v48 rev2 — เดิมแตกตาม r.type ซึ่งบนชีตนี้ทุกแถวของบัตรเครดิตเป็น
         'Debt' เหมือนกันหมด (225/225 แถว) แถบจึงมีแท่งเดียวชื่อ "ชำระหนี้"
         ที่ยาวเต็มความกว้าง = ไม่ได้บอกอะไรเลย
         มิติที่บอกจริงว่า "หนี้มาจากอะไร" คือ Details (ร้านค้า/บริการ)
         — Canva, Claude AI, Google Storage, Lotus, Grab, ดอกเบี้ยบัตรเครดิต
         จึงใช้ Details เป็นแกนหลัก และเก็บ type ไว้เป็นข้อมูลรอง */
      const t = r.type || 'Other';
      if(!o.byType[t]) o.byType[t] = { in:0, out:0, n:0 };
      if(amt < 0){ o.byType[t].out += -amt; o.charged += -amt; }
      else       { o.byType[t].in  +=  amt; o.repaid  +=  amt; }
      o.byType[t].n++; o.n++; o.net += amt;
 
      // แกนหลัก: ร้านค้า/รายละเอียด (เฉพาะฝั่งที่ทำให้หนี้เพิ่ม)
      if(amt < 0){
        const m = normMerchant(r.details) || (r.category || 'ไม่ระบุ');
        if(!o.byMerchant[m]) o.byMerchant[m] = { amt:0, n:0, last:null };
        o.byMerchant[m].amt += -amt; o.byMerchant[m].n++;
        if(r.dateStr && (!o.byMerchant[m].last || r.dateStr > o.byMerchant[m].last))
          o.byMerchant[m].last = r.dateStr;
      }
      if(monthKey && r.month === monthKey){
        if(amt < 0) o.mCharged += -amt; else o.mRepaid += amt;
        o.mNet += amt; o.mN++;
      }
      if(r.dateStr){
        if(!o.firstDate || r.dateStr < o.firstDate) o.firstDate = r.dateStr;
        if(!o.lastDate  || r.dateStr > o.lastDate)  o.lastDate  = r.dateStr;
      }
    });
  });
 
  // จัดอันดับประเภทที่สร้างหนี้มากที่สุด — คือคำตอบของ "หนี้ก้อนนี้มาจากอะไร"
  Object.values(out).forEach(o=>{
    o.topCharge = Object.entries(o.byType)
      .map(([t,v])=>({type:t, amt:v.out, n:v.n}))
      .filter(x=>x.amt>0).sort((a,b)=>b.amt-a.amt);
    o.topMerchant = Object.entries(o.byMerchant)
      .map(([m,v])=>({name:m, amt:v.amt, n:v.n, last:v.last}))
      .sort((a,b)=>b.amt-a.amt);
    // ส่วนที่ไม่ติด top N — รวมเป็น "อื่นๆ" แทนที่จะซ่อนหายไปเฉยๆ
    o.merchantTotal = o.topMerchant.reduce((s,x)=>s+x.amt, 0);
    o.repayRate = o.charged>0 ? o.repaid/o.charged : null;   // <1 = หนี้กำลังโต
    o.mTrend = o.mNet > 0 ? 'down' : o.mNet < 0 ? 'up' : 'flat';
  });
  return out;
}
 
// ═══ Realized P&L + ต้นทุนของที่ถืออยู่ — running-WACC (v68) ═══
// ไล่ตามลำดับวันที่ต่อ ticker ครั้งเดียว ได้ทั้ง "กำไรที่ขายแล้ว" และ "ต้นทุนของหน่วยที่ยังถือ"
// v68 BUGFIX #1 — เดิมต้นทุนของที่ถืออยู่ (waccMap) = ยอดซื้อ "ทุกครั้ง" ÷ หน่วยที่ซื้อทั้งหมด
//   ซึ่งถูกเฉพาะเมื่อไม่เคยขายแล้วซื้อเพิ่ม · ซื้อ 10@100 → ขาย 5 → ซื้อ 5@200
//   เดิมได้ ฿133/หน่วย (ต้นทุน 1,333) · ที่ถูกคือ ฿150 (ต้นทุน 1,500) → Unrealized เกินจริง ฿167
//   และ Realized + Unrealized ≠ เงินที่ได้จริง เพราะสองตัวใช้คนละสูตร — ตอนนี้ใช้ชุดเดียวกัน
// ประเภทรายการ:
//   Buy/Split (isCostTx)  + หน่วย + ต้นทุน
//   Stake                 + หน่วย ต้นทุน 0 (รางวัล staking · v68 #19 เดิมเพิ่มหน่วยแต่ไม่เข้าสูตรเฉลี่ย)
//   Sell (sellTxTypes)    − หน่วย − ต้นทุนตาม WACC ณ ตอนขาย → บันทึกกำไร
//   Used                  − หน่วย − ต้นทุนตาม WACC (ใช้จ่ายไป ไม่ใช่การขาย จึงไม่บันทึกกำไร)
//   Send/Recieved         โอนระหว่างกระเป๋าตัวเอง: ไม่กระทบต้นทุน · ส่วนที่รับ "เกิน" ส่ง (airdrop)
//                         = หน่วยต้นทุน 0 · ส่ง "เกิน" รับ (โอนออกไปเลย) = หักตาม WACC
// รายได้จากการขายใช้ r.netProceeds ถ้ามี (หักค่าธรรมเนียมฝั่งขายแล้ว — ดู sellFeeToDeduct)
function runningCostBasis(trackerRows, isCostTx, sellTxTypes){
  const byTicker = {};
  (trackerRows||[]).forEach(r=>{ if(r && r.ticker) (byTicker[r.ticker] ||= []).push(r); });
  const realized = [], holdings = {};
  Object.entries(byTicker).forEach(([tk, rowsForTicker])=>{
    const rows = rowsForTicker.slice().sort((a,b)=>a.date-b.date);
    let runQty = 0, runCost = 0, xfer = 0;
    const take = q => {                       // หักหน่วยตาม WACC ปัจจุบัน คืนต้นทุนที่หักออก
      const wacc = runQty>0 ? runCost/runQty : 0;
      const qq = Math.min(q, runQty), cb = qq*wacc;
      runQty = Math.max(0, runQty - qq); runCost = Math.max(0, runCost - cb);
      if(runQty < 1e-12){ runQty = 0; runCost = 0; }
      return { wacc, cb: q*wacc };
    };
    rows.forEach(r=>{
      const q = Math.abs(Number(r.qty)||0);
      if(isCostTx.has(r.txType) && q>0){
        runCost += Number(r.trueCost)||0; runQty += q;
      } else if(r.txType==='Stake' && q>0){
        runQty += q;
      } else if(sellTxTypes.includes(r.txType)){
        const { wacc, cb } = take(q);
        const proceeds = r.netProceeds != null ? r.netProceeds : Math.abs(r.amtTHB);
        realized.push({
          date: isoLocal(r.date), ticker:r.ticker, group:r.group,   // v61 — ไม่ใช่ toISOString (UTC)
          qty:q, wacc, proceeds, fee: r.sellFee || 0,
          costBasis: cb,
          pnl: proceeds - cb
        });
      } else if(r.txType==='Used' && q>0){
        take(q);
      } else if(r.txType==='Recieved') xfer += q;
      else if(r.txType==='Send') xfer -= q;
    });
    if(xfer > 1e-12) runQty += xfer;          // รับเกินส่ง = ได้มาฟรี (ต้นทุน 0)
    else if(xfer < -1e-12) take(-xfer);       // ส่งเกินรับ = ออกจากพอร์ตไปแล้ว
    holdings[tk] = { qty: runQty, cost: runCost, wacc: runQty>0 ? runCost/runQty : 0 };
  });
  return { realized, holdings };
}
// คงชื่อเดิมไว้ให้ผู้เรียกเก่า/เทสต์
function computeRunningWaccRealized(trackerRows, isCostTx, sellTxTypes){
  return runningCostBasis(trackerRows, isCostTx, sellTxTypes).realized;
}
// v68 #9 — ค่าธรรมเนียมฝั่งขายที่ยังไม่ได้หักออกจากยอดขาย
// ฝั่งซื้อ (feeToAdd) "รวมแล้ว" = ยอด ≈ ฐาน + ค่าธรรมเนียม · ฝั่งขาย "หักแล้ว" = ยอด ≈ ฐาน − ค่าธรรมเนียม
// ไม่มีฐานให้เทียบ (ไม่มีราคา/จำนวน) → ถือว่ายังไม่หัก
function sellFeeToDeduct(amtTHB, qty, price, fx, comm){
  const c = Math.abs(comm||0);
  if(!(c > 0)) return 0;
  const base = Math.abs(qty||0) * Math.abs(price||0) * Math.abs(fx||1);
  if(!(base > 0)) return c;
  const already = Math.abs((base - Math.abs(amtTHB||0)) - c) <= Math.max(0.02, c*0.05);
  return already ? 0 : c;
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
  const exp = getGoalCfg().expectedReturn ?? 7;   // v61 — ?? ไม่ใช่ || (0% ต้องเป็น 0)
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
 
// ══════════════════════════════════════════════════════════════════════
// v49 — ANALYST DESK
// ══════════════════════════════════════════════════════════════════════
// ทีมนักวิเคราะห์ 5 คน อ่านข้อมูลชุดเดียวกันแต่ตอบคนละคำถาม
//
// ทำไมเป็น rule-based ไม่ใช่เรียก LLM:
//   1. repo เป็น public — เก็บ API key ไว้ในเครื่องผู้ใช้แล้วยิงจาก browser
//      แปลว่า key โผล่ใน network tab และติดไปกับไฟล์ backup
//   2. แอปเป็น PWA ที่ต้องทำงานออฟไลน์ได้ นักวิเคราะห์ที่เงียบตอนไม่มีเน็ต
//      คือนักวิเคราะห์ที่เชื่อถือไม่ได้
//   3. ตัวเลขการเงินห้ามมั่ว rule-based ให้คำตอบเดิมเสมอกับ input เดิม
//      และตรวจสอบย้อนกลับได้ทุกบรรทัด — ต่อยอดเป็น hybrid ทีหลังได้
//      โดยส่ง findings ชุดนี้ให้ LLM เรียบเรียง ไม่ต้องรื้อโครง
//
// สัญญาของฟังก์ชัน: pure — รับ ctx ก้อนเดียว คืน array ไม่แตะ DOM/globals
// ระดับความสำคัญ: 'r' = ต้องแก้, 'y' = เฝ้าดู, 'g' = ผ่าน
const ANALYST_SEV = { r:3, y:2, g:1 };
 
/* LOC ถูกประกาศใน index.html ไม่ใช่ที่นี่ — engine ต้องไม่พึ่งตัวแปรของฝั่ง UI
   ไม่งั้นทดสอบนอกเบราว์เซอร์ไม่ได้ และถ้าลำดับโหลดเปลี่ยนก็พังทั้งชุด
   (จับได้จาก try/catch รายคน ตอนรันจริงกับข้อมูลในชีต) */
const _AL = (typeof LOC!=='undefined' && LOC) ? LOC : 'th-TH';
const _n  = v => Math.round(Number(v)||0).toLocaleString(_AL);
 
function _pick(findings){
  // headline = ประเด็นที่หนักสุด ถ้าไม่มีอะไรหนักเลยค่อยชมได้
  const sorted = [...findings].sort((a,b)=>ANALYST_SEV[b.s]-ANALYST_SEV[a.s]);
  return sorted[0] || null;
}
function _mk(id, name, role, icon, findings, actions){
  const f = findings.filter(Boolean);
  const top = _pick(f);
  const nR = f.filter(x=>x.s==='r').length, nY = f.filter(x=>x.s==='y').length;
  return { id, name, role, icon,
           level: nR ? 'r' : nY ? 'y' : 'g',
           headline: top ? top.t : 'ยังไม่มีข้อมูลพอจะให้ความเห็น',
           findings: f, actions: (actions||[]).filter(Boolean),
           counts: { r:nR, y:nY, g:f.length-nR-nY } };
}
const _pc = v => (v>=0?'+':'−') + Math.abs(v).toFixed(1) + '%';
 
// ── 1. Portfolio Analyst ─────────────────────────────────────────────
function analystPortfolio(c){
  const F=[], A=[];
  const held = (c.assets||[]).filter(a=>a.val>0);
  const tot  = held.reduce((s,a)=>s+a.val,0);
 
  if(!held.length) return _mk('portfolio','Portfolio Analyst','คุณภาพผลตอบแทน','📊',
    [{s:'y',t:'ยังไม่มีสินทรัพย์ในพอร์ต',d:'เพิ่มรายการในชีต Asset_Tracker แล้ว sync'}],[]);
 
  // (1) โตเพราะฝีมือ หรือเพราะเติมเงิน — คำถามแรกที่ต้องตอบเสมอ
  if(c.moneyIn>0){
    const gain = c.totalVal + (c.moneyOut||0) - c.moneyIn;
    const gp   = gain/c.moneyIn*100;
    /* v55 — ตั้งชื่อตามนิยาม: นี่คือ "ผลตอบแทนรวม (Total return)"
       = มูลค่าวันนี้ + เงินที่ได้คืน (ขาย + ปันผล) − เงินที่ใส่เข้า
       ต่างจาก "กำไรที่ยังไม่ขาย (Unrealized)" ในหน้า Holdings ที่ดูเฉพาะของที่ยังถือ */
    F.push({ s: gp<0?'r':gp<10?'y':'g',
      t:`ผลตอบแทนรวม (Total return) ${gain>=0?'+':'−'}${_n(Math.abs(gain))} บาท (${_pc(gp)})`,
      d:`รวมกำไรที่ขายไปแล้ว + ปันผล + กำไรที่ยังไม่ขาย · เงินตัวเองสุทธิ ${_n(c.moneyIn-(c.moneyOut||0))} บาท`
        + ` — ส่วนที่เกินมานี้คือผลงานของพอร์ตจริงๆ ไม่ใช่ผลของการเติมเงิน`});
  }
  // (2) XIRR เทียบกับสิ่งที่ทำได้แบบไม่ต้องคิด
  if(c.xirr!=null){
    const x=c.xirr*100, hurdle=c.expectedReturn ?? 7;
    F.push({ s: x<0?'r':x<hurdle?'y':'g',
      t:`XIRR ${_pc(x)}/ปี เทียบเป้า ${hurdle}%`,
      d: x<hurdle
        ? `ต่ำกว่าเป้า ${(hurdle-x).toFixed(1)}pp — ถ้าต่ำกว่าติดต่อกันหลายปี การถือกองดัชนีทั้งก้อนอาจให้ผลดีกว่าเลือกรายตัว`
        : `เหนือเป้า ${(x-hurdle).toFixed(1)}pp` });
  }
  // (3) ตัวถ่วงที่ "ใหญ่พอจะสำคัญ" — ขาดทุน 50% ใน ฿500 ไม่ใช่ปัญหา
  const drag=(c.perAsset||[]).filter(a=>a.xirr!=null&&a.xirr<-0.10&&a.val>tot*0.03)
    .sort((a,b)=>a.xirr-b.xirr);
  if(drag.length){
    const d0=drag[0];
    F.push({ s:'y', t:`${drag.length} ตัวถ่วงที่ใหญ่พอจะสำคัญ · หนักสุด ${d0.tk} ${_pc(d0.xirr*100)}/ปี`,
      d:`${drag.map(d=>d.tk).join(', ')} — รวม ${Math.round(drag.reduce((s,d)=>s+d.val,0)).toLocaleString(_AL)} บาท`
        + ` (${(drag.reduce((s,d)=>s+d.val,0)/tot*100).toFixed(0)}% ของพอร์ต) ตัวที่ถือเพราะ "รอให้เท่าทุน" คือต้นทุนค่าเสียโอกาส` });
    A.push(`ทบทวน ${d0.tk}: เหตุผลที่ซื้อตอนแรกยังจริงอยู่ไหม ถ้าไม่ ขาดทุนที่ผ่านมาไม่ใช่เหตุผลให้ถือต่อ`);
  }
  // (4) ต้นทุนที่จ่ายไปโดยไม่รู้ตัว — v55: ใช้ feeStats() ตัวเดียวกับทุกหน้า
  const _fs = c.fee || null;
  if(_fs && _fs.fees>0 && _fs.ratio!=null){
    F.push({ s:_fs.level, t:`ค่าธรรมเนียมรวม ${_n(_fs.fees)} บาท (${_fs.ratio.toFixed(2)}% ของมูลค่าซื้อขาย)`,
      d: _fs.level==='y' ? `สูงกว่า ${FEE_WARN_PCT}% — ค่าธรรมเนียมกินผลตอบแทนแบบทบต้นเหมือนกัน`
                         : 'อยู่ในระดับที่ยอมรับได้' });
  }
  if(c.xirr!=null && c.twrPct!=null && c.twrDays>=30){
    const diff=c.twrPct-c.xirr*100;
    if(Math.abs(diff)>5) F.push({ s:'y', t:`จังหวะเข้าซื้อทำให้ผลต่างจาก TWR ${diff>0?'':'+'}${(-diff).toFixed(1)}pp`,
      d: diff>0 ? 'พอร์ตทำได้ดีกว่าที่คุณได้รับจริง — แปลว่ามักเติมเงินหลังราคาขึ้นไปแล้ว'
                : 'คุณได้รับมากกว่าที่พอร์ตทำได้ — จังหวะเติมเงินของคุณดี' });
  }
  return _mk('portfolio','Portfolio Analyst','คุณภาพผลตอบแทน','📊',F,A);
}
 
// ── 2. Risk Analyst ──────────────────────────────────────────────────
function analystRisk(c){
  const F=[], A=[];
  const held=(c.assets||[]).filter(a=>a.val>0);
  const tot=held.reduce((s,a)=>s+a.val,0);
  if(!tot) return _mk('risk','Risk Analyst','จุดที่จะเจ็บถ้าตลาดพัง','🛡',
    [{s:'y',t:'ยังไม่มีพอร์ตให้ประเมินความเสี่ยง',d:''}],[]);
 
  // (1) กระจุกตัวรายตัว — v55: ใช้ concentrationCheck() ตัวเดียวกับ Overview
  const cc = concentrationCheck(held);
  const t1 = cc.top, p1 = cc.pct;
  if(t1) F.push({ s:cc.level, t:`ตัวใหญ่สุด ${t1.ticker} ${p1.toFixed(0)}% ของพอร์ต`,
    d: p1>CONC_WARN_PCT ? `ถ้า ${t1.ticker} ลง 50% พอร์ตหายทันที ${(p1/2).toFixed(0)}% (${_n(t1.val*0.5)} บาท)`
                        : 'ไม่มีตัวไหนใหญ่พอจะทำพอร์ตพังคนเดียว' });
  if(cc.top3Pct>50) F.push({s:'y',t:`3 ตัวแรกรวมกัน ${cc.top3Pct.toFixed(0)}% ของพอร์ต`,
    d:`${cc.top3.map(a=>a.ticker).join(' · ')} — จำนวนตัวเยอะไม่ได้แปลว่ากระจายความเสี่ยงแล้ว`});
 
  // (2) ค่าเงิน — รายจ่ายเป็นบาท 100% แต่สินทรัพย์ไม่ใช่
  // v62 — usdExposure() ตัวเดียวกับ Overview และหน้าต้นทุน (รวมคริปโต/ทองที่ราคาอ้างอิงดอลลาร์)
  const _ux=usdExposure(held), usd=_ux.usd;
  const up=_ux.pct;
  if(up>0) F.push({ s:up>60?'y':'g', t:`อิงค่าเงินดอลลาร์ ${up.toFixed(0)}% (${_n(usd)} บาท)`,
    d:`USD/THB แข็ง/อ่อน 1 บาท ≈ ${_n(usd/(c.usdthb||34))} บาทในมูลค่าพอร์ต`
      + (up>60?' — รายจ่ายคุณเป็นบาททั้งหมด ความเสี่ยงนี้ไม่มีอะไรหักล้าง':'') });
 
  // (3) สภาพคล่อง — เงินที่แตะไม่ได้ตอนต้องใช้ คือเงินที่ไม่มี
  if(c.illiquidPct>0) F.push({ s:c.illiquidPct>35?'y':'g',
    t:`สินทรัพย์ที่ขายไม่ได้ ${c.illiquidPct.toFixed(0)}% ของความมั่งคั่ง`,
    d:'กองทุนสำรองเลี้ยงชีพถอนไม่ได้จนกว่าจะออกจากงาน — ตัวเลข Net Worth ที่เห็นจึงใช้จริงได้ไม่หมด' });
 
  // (4) เงินสำรองฉุกเฉิน — ด่านแรกที่กันไม่ให้ต้องขายพอร์ตตอนตลาดแดง
  if(c.efMonths!=null) F.push({ s:c.efMonths<3?'r':c.efMonths<6?'y':'g',
    t:`เงินสำรองฉุกเฉินครอบคลุม ${c.efMonths.toFixed(1)} เดือน`,
    d: c.efMonths<3
      ? `ต่ำกว่า 3 เดือน — ถ้ารายได้สะดุดตอนตลาดลง จะถูกบังคับขายพอร์ตที่จุดต่ำสุด ซึ่งเปลี่ยนขาดทุนชั่วคราวให้เป็นขาดทุนถาวร`
      : 'พอรับแรงกระแทกได้โดยไม่ต้องแตะพอร์ต' });
 
  // (5) บริบทตลาด — ไม่ทำนาย แค่บอกว่ายืนอยู่ตรงไหน
  if(c.vix!=null) F.push({ s:c.vix>28?'y':'g', t:`VIX ${c.vix.toFixed(1)} — ${c.vix>28?'ตลาดกำลังกลัว':c.vix<15?'ตลาดนิ่งผิดปกติ':'ปกติ'}`,
    d: c.vix>28?'ช่วงผันผวนสูงคือช่วงที่ DCA ได้เปรียบที่สุด และเป็นช่วงที่คนหยุด DCA มากที่สุด'
              :'ความสงบไม่ใช่สัญญาณให้เพิ่มความเสี่ยง' });
  if(c.efMonths!=null && c.efMonths<6) A.push('เติมเงินสำรองให้ครบ 6 เดือนก่อนเพิ่มเงินลงทุนก้อนใหม่');
  /* กองที่ขายไม่ได้ (กองทุนสำรองเลี้ยงชีพ) ห้ามแนะนำให้ "ลดน้ำหนัก"
     — ขายไม่ได้จนกว่าจะออกจากงาน และการหยุดสมทบมักเสียเงินสมทบนายจ้าง
     ซึ่งเป็นผลตอบแทนทันที 100% คำแนะนำที่ทำตามไม่ได้คือคำแนะนำที่ผิด */
  // v55 — PF/กองทุนไม่อยู่ในการวัดความกระจุกตัวแล้ว (ดู isDiversifiedHolding)
  if(t1 && p1>CONC_HIGH_PCT)
    A.push(`ลดน้ำหนัก ${t1.ticker} หรือหยุดเติมเข้าตัวนี้จนสัดส่วนกลับมาต่ำกว่า ${CONC_HIGH_PCT}%`);
  return _mk('risk','Risk Analyst','จุดที่จะเจ็บถ้าตลาดพัง','🛡',F,A);
}
 
// ── 3. Cashflow Analyst ──────────────────────────────────────────────
function analystCashflow(c){
  const F=[], A=[];
  const m=c.months||[];
  if(m.length<2) return _mk('cashflow','Cashflow Analyst','เก็บได้จริงเท่าไร รั่วตรงไหน','💧',
    [{s:'y',t:'ข้อมูลยังไม่พอ ต้องมีอย่างน้อย 2 เดือน',d:''}],[]);
 
  const recent=m.slice(-6);
  const avgInc=recent.reduce((s,x)=>s+x.income,0)/recent.length;
  /* v55 — ใช้ savingFromSummary() ตัวเดียวกับทุกหน้า (นิยามสากล)
     เงินที่เก็บได้ = รายได้ − (Expense + Bills + ยอดรูดบัตร) ไม่ใช่ยอดที่โอนไปออม */
  const avgSav=recent.reduce((s,x)=>s+savingFromSummary(x).saved,0)/recent.length;
  const sr=avgInc>0?avgSav/avgInc*100:0;
  F.push({ s:sr<10?'r':sr<20?'y':'g', t:`Saving rate เฉลี่ย ${sr.toFixed(0)}% (${recent.length} เดือนล่าสุด)`,
    d:`เก็บได้เดือนละ ${_n(avgSav)} จากรายได้ ${_n(avgInc)} บาท`
      + (sr<20?' — ทุก 1% ที่เพิ่มได้ มีผลต่อวันเกษียณมากกว่าการหาผลตอบแทนเพิ่ม 1%':'') });
 
  // เดือนที่ใช้เกินรายได้ = saved < 0 (นิยามเดียวกับ saving rate ด้านบน)
  // v62 — เดิมใช้ x.net < 0 ซึ่งหักยอดโอนไปลงทุนด้วย เดือนที่ลงทุนมากกว่าเงินที่เหลือ
  // จึงถูกนับว่า "ใช้เกินรายได้" ทั้งที่รายจ่ายต่ำกว่ารายได้ (ข้อมูลจริง: ขึ้น 4 เดือน จริงแค่ 2)
  const neg=recent.filter(x=>savingFromSummary(x).saved<0);
  if(neg.length) F.push({ s:neg.length>=3?'r':'y', t:`${neg.length} ใน ${recent.length} เดือนล่าสุดใช้เกินรายได้`,
    d:`${neg.map(x=>x.mk).join(' · ')} — เดือนที่ติดลบคือเดือนที่กินเงินเก็บหรือก่อหนี้เพิ่ม` });
 
  // ความผันผวนของรายจ่าย — วางแผนไม่ได้ถ้าเดือนต่อเดือนเหวี่ยง
  const exps=recent.map(x=>Math.abs(x.expense));
  const avgE=exps.reduce((a,b)=>a+b,0)/exps.length;
  const sd=Math.sqrt(exps.reduce((s,v)=>s+(v-avgE)**2,0)/exps.length);
  const cv=avgE>0?sd/avgE*100:0;
  F.push({ s:cv>40?'y':'g', t:`รายจ่ายเหวี่ยง ±${cv.toFixed(0)}% ระหว่างเดือน`,
    d: cv>40?'ผันผวนสูงแปลว่ามีรายจ่ายก้อนใหญ่ที่ไม่ได้ตั้งงบไว้ — ควรกันเป็นก้อนแยกล่วงหน้า'
            :'ค่อนข้างคงที่ วางแผนงบได้แม่น' });
 
  // เก็บได้แต่ไม่ได้ลงทุน — เงินนอนอยู่เฉยๆ คือขาดทุนจากเงินเฟ้อ
  /* v61 — เดิมเขียนว่า "เก็บได้แต่ยังไม่ลงทุน X บาท/เดือน" ซึ่งผิดสองชั้น
     1) investGap = เงินสด − เงินสำรอง 6 เดือน = "ยอดคงค้างก้อนเดียว" ไม่ใช่ต่อเดือน
        ทดสอบจริงขึ้น ฿262,158/เดือน ทั้งที่รายได้ทั้งเดือนราว ฿59,000
     2) หน้า Wealth Engine ใช้วลีเดียวกันกับอีกสูตร (flow รายเดือน ฿18,809/เดือน)
        ชื่อเดียวกันแต่สองสูตร = ผิดกติกา metric registry ของ v55
     จึงตั้งชื่อใหม่ให้ตรงกับสิ่งที่วัด และไม่มีคำว่า /เดือน */
  if(c.investGap>1000) F.push({ s:'y', t:`เงินสดเกินเงินสำรอง 6 เดือน ${_n(c.investGap)} บาท`,
    d:'ยอดคงค้างในบัญชีที่เกินเงินสำรองฉุกเฉินที่ควรมี — แพ้เงินเฟ้อทุกเดือนที่ปล่อยไว้เฉยๆ'
      + ' (คนละตัวกับ "เก็บได้แต่ยังไม่ลงทุน/เดือน" ในหน้า ออม & ลงทุน ซึ่งวัดเงินที่ไหลเข้าแต่ละเดือน)' });
 
  if(c.overBudget && c.overBudget.length){
    const o=c.overBudget;
    F.push({ s:'y', t:`เดือนนี้งบเกิน ${o.length} หมวด รวม ${Math.round(o.reduce((s,x)=>s+(x.spent-x.lim),0)).toLocaleString(_AL)} บาท`,
      d:o.slice(0,4).map(x=>`${x.cat} ${_n(x.spent)}/${_n(x.lim)}`).join(' · ') });
    A.push(`หมวด ${o[0].cat} เกินงบมากที่สุด — ตั้งงบใหม่ให้สมจริง หรือหาว่าอะไรทำให้เกิน`);
  }
  if(sr<20) A.push(`ดัน saving rate จาก ${sr.toFixed(0)}% ไป 20% = เก็บเพิ่มเดือนละ ${_n(avgInc*0.2-avgSav)} บาท`);
  return _mk('cashflow','Cashflow Analyst','เก็บได้จริงเท่าไร รั่วตรงไหน','💧',F,A);
}
 
// ── 4. Debt Analyst ──────────────────────────────────────────────────
function analystDebt(c){
  const F=[], A=[];
  if(!c.liabilities || c.liabilities<=0)
    return _mk('debt','Debt Analyst','หนี้โตหรือลด · โปะหรือลงทุน','⚖️',
      [{s:'g',t:'ไม่มีหนี้คงค้าง',d:'สถานะที่ดีที่สุด — เงินทุกบาทที่เก็บได้ไปทำงานให้คุณเต็มจำนวน'}],[]);
 
  F.push({ s:'y', t:`หนี้คงค้างรวม ${_n(c.liabilities)} บาท`,
    d: c.reconVerified ? 'ยอดนี้ตรวจสอบกับยอดจริงจากธนาคารแล้ว'
                       : '⚠ ยอดนี้คำนวณจากธุรกรรมที่กรอกมือ ยังไม่ได้ verify กับแอปธนาคาร' });
 
  if(c.monthlyInterest>0){
    const yr=c.monthlyInterest*12;
    F.push({ s: c.monthlyInterest>2000?'r':'y', t:`ดอกเบี้ย ${_n(c.monthlyInterest)} บาท/เดือน (${_n(yr)}/ปี)`,
      d:`เท่ากับต้องหาผลตอบแทน ${_n(yr)} บาทจากพอร์ตทุกปีแค่เพื่อเสมอตัว` });
  }
  /* v62 — บัญชีที่ยังไม่ได้ใส่ดอกเบี้ย ห้ามถือว่าเป็น 0%
     เดิม effApr = 0 → "ดอกเบี้ยที่มีผลจริงสูงสุด 0.0% · จ่ายขั้นต่ำแล้วเอาเงินไปลงทุนได้เปรียบกว่า"
     กับบัตรเครดิตที่ยังไม่ได้กรอก APR (ข้อมูลจริงรอบทดสอบ) — ถ้าจ่ายขั้นต่ำจริง ยอดทั้งก้อนคิดดอก ~16%
     คำแนะนำนี้จึงกลับด้านกับความจริง ต้องบอกว่าตัดสินไม่ได้แทน */
  const _noApr=c.aprMissing||[];
  if(_noApr.length){
    F.push({ s:'y', t:`ยังไม่ได้ใส่ดอกเบี้ย ${_noApr.length} บัญชี — ยังตัดสินไม่ได้ว่าควรโปะหนี้หรือลงทุน`,
      d:`${_noApr.join(', ')} · ถ้าจ่ายเต็มยอดทุกเดือน ดอกเบี้ยเป็น 0 จริง แต่ถ้าจ่ายขั้นต่ำ ยอดทั้งก้อนคิดดอก (บัตรเครดิตไทยส่วนใหญ่ 16%/ปี)` });
    A.push(`ใส่ดอกเบี้ย %/ปี ของ ${_noApr.join(', ')} ในหน้าหนี้ (ผ่อน 0% ใส่ยอดในช่อง "ปลอดดอกเบี้ย")`);
  }
  // โปะ vs ลงทุน — ตัดสินด้วย effApr ไม่ใช่ apr ดิบ · v62: เฉพาะบัญชีที่ใส่ดอกเบี้ยแล้ว
  if(c.topEffApr!=null){
    const hurdle=c.expectedReturn ?? 7, win=c.topEffApr>hurdle;
    F.push({ s: win?'r':'g', t:`ดอกเบี้ยที่มีผลจริงสูงสุด ${c.topEffApr.toFixed(1)}% vs ผลตอบแทนคาดหวัง ${hurdle}%`,
      d: win ? `โปะหนี้ให้ผล ${c.topEffApr.toFixed(1)}% แบบรับประกัน ปลอดภาษี ปลอดความผันผวน — ชนะการลงทุน ${(c.topEffApr-hurdle).toFixed(1)}pp`
             : 'ดอกเบี้ยต่ำกว่าผลตอบแทนคาดหวัง — จ่ายขั้นต่ำแล้วเอาเงินไปลงทุนได้เปรียบกว่า' });
    if(win) A.push('เงินก้อนถัดไปที่เก็บได้ ให้ไปโปะหนี้ก่อนซื้อสินทรัพย์เพิ่ม');
  }
  // ทิศทาง — หนี้โตหรือลด สำคัญกว่ายอดคงค้าง ณ วันนี้
  (c.debtAccounts||[]).forEach(d=>{
    if(d.repayRate!=null && d.repayRate<0.95 && d.charged>10000)
      F.push({ s: d.repayRate<0.8?'r':'y', t:`${d.name} ชำระคืนแล้วแค่ ${(d.repayRate*100).toFixed(0)}% ของยอดที่รูด`,
        d:`รูดสะสม ${_n(d.charged)} · ชำระคืน ${_n(d.repaid)} บาท — ต่ำกว่า 100% แปลว่ายอดกำลังโตสะสม` });
    if(d.mNet<0) F.push({ s:'y', t:`${d.name} เดือนนี้หนี้เพิ่ม ${_n(Math.abs(d.mNet))} บาท`,
      d:`รูด ${_n(d.mCharged)} · จ่าย ${_n(d.mRepaid)} บาท`
        + (d.topMerchant&&d.topMerchant[0]?` · ก้อนใหญ่สุดตลอดมา: ${d.topMerchant[0].name}`:'') });
  });
  if(c.payoffMonths!=null && isFinite(c.payoffMonths))
    // v64 — เดิมเขียน "ถ้าจ่ายเท่าเดิม" แต่แผนจำลองจากขั้นต่ำที่ตั้งไว้ (minPct/minFloor + extra) ไม่ใช่ยอดที่จ่ายจริง
    //        ผ่อนรถเดือนละ 6,500 แต่ขั้นต่ำ 10% = 15,500 → บอก "10 เดือน" ทั้งที่จริง ~24 เดือน · ต้องบอกยอดที่ใช้คำนวณ
    F.push({ s:'g', t:`ปลดหนี้หมดใน ${c.payoffMonths} เดือน`+
        (c.payoffBudget>0 ? ` ถ้าจ่ายเดือนละ ${_n(c.payoffBudget)} บาท (ตามขั้นต่ำที่ตั้งไว้ในหน้าหนี้)` : ''),
      d: _noApr.length ? `ดอกเบี้ยรวม — ยังคำนวณไม่ได้ (${_noApr.length} บัญชีไม่มีดอกเบี้ย แผนนี้จึงนับเป็น 0%)`
                       : `ดอกเบี้ยรวมตลอดแผน ${_n(c.payoffInterest||0)} บาท` });
  else if(c.payoffMonths!=null)
    F.push({ s:'r', t:'ด้วยยอดจ่ายปัจจุบัน หนี้ก้อนนี้ไม่มีวันหมด',
      d:'ยอดที่จ่ายไม่พอกลบดอกเบี้ยที่เกิดใหม่ — ต้องเพิ่มยอดจ่ายต่อเดือน' });
  return _mk('debt','Debt Analyst','หนี้โตหรือลด · โปะหรือลงทุน','⚖️',F,A);
}
 
// ── 5. FIRE Analyst ──────────────────────────────────────────────────
function analystFire(c){
  const F=[], A=[];
  const nw=c.netWorth||0, goal=c.goal||0;
  if(goal>0) F.push({ s:'g', t:`ความมั่งคั่งสุทธิ ${_n(nw)} — ${(nw/goal*100).toFixed(1)}% ของเป้า`,
    d:`เหลืออีก ${_n(Math.max(0,goal-nw))} บาท` });
 
  // ผลตอบแทนที่แท้จริง — เงินเฟ้อคือคู่แข่งที่ไม่เคยหยุดพัก
  if(c.xirr!=null && c.cpi!=null){
    const real=((1+c.xirr)/(1+c.cpi/100)-1)*100;
    /* v49 — CPI ไทยมาจาก World Bank ซึ่งเป็นค่า *รายปี* และช้า 6-12 เดือน
       ต้องบอกปีของข้อมูลเสมอ ไม่งั้นตัวเลขเก่า 2 ปีจะดูเหมือนของสด
       และคนอ่านจะเอาไปวางแผนเกษียณโดยไม่รู้ว่าฐานที่ใช้ไม่ตรงกับปัจจุบัน */
    const asOf = c.cpiYear ? ` (ข้อมูลปี ${c.cpiYear})` : '';
    const oldData = c.cpiYear && (new Date().getFullYear() - Number(c.cpiYear)) >= 2;
    F.push({ s: real<0?'r':real<3?'y':'g', t:`ผลตอบแทนหลังเงินเฟ้อ ${_pc(real)}/ปี`,
      d: (real<0 ? `เงินเฟ้อไทย ${c.cpi.toFixed(1)}%${asOf} กินผลตอบแทนหมด — กำลังซื้อลดลงแม้ตัวเลขในพอร์ตจะโต`
                 : `เงินเฟ้อ ${c.cpi.toFixed(1)}%${asOf} — นี่คือตัวเลขจริงที่ควรใช้วางแผนเกษียณ ไม่ใช่ตัวเลข nominal`)
         + (oldData ? ' · ⚠ ข้อมูลเงินเฟ้อเก่ากว่า 2 ปี ใช้เป็นค่าประมาณเท่านั้น' : '') });
  }
  // ปีที่ต้องใช้ + ตัวแปรไหนขยับแล้วได้ผลสุด
  if(c.monthlyContrib>0 && goal>nw){
    // v62 — สูตรเดียวกับหน้าเป้าหมาย (monthsToGoal) · เดิมใช้ r/12 และทบต้นรวมเงินสด
    const yrs = v => {
      const m=monthsToGoal({netWorth:nw, goal, contrib:v, annualPct:c.expectedReturn ?? 7,
                            investedShare:c.investedShare});
      return m==null?null:m/12;
    };
    const base=yrs(c.monthlyContrib);
    if(base!=null){
      F.push({ s: base>20?'y':'g', t:`ถึงเป้าใน ${base.toFixed(1)} ปี ถ้าไม่เปลี่ยนอะไรเลย`,
        d:`เก็บได้เฉลี่ย ${_n(c.monthlyContrib)} บาท/เดือน (${c.contribMonths||12} เดือนล่าสุด) · ผลตอบแทน ${c.expectedReturn ?? 7}%/ปี กับส่วนที่ลงทุน` });
      const plus=yrs(c.monthlyContrib*1.2);
      if(plus!=null && base-plus>0.3)
        F.push({ s:'g', t:`เติมเพิ่ม 20% (${_n(c.monthlyContrib*0.2)} บาท/เดือน) → เร็วขึ้น ${(base-plus).toFixed(1)} ปี`,
          d:'ในระยะนี้ การเพิ่มเงินที่เติมมีผลมากกว่าการไล่หาผลตอบแทนที่สูงขึ้น เพราะฐานพอร์ตยังเล็ก' });
    } else F.push({ s:'r', t:'ด้วยอัตราปัจจุบัน ยังไปไม่ถึงเป้าใน 100 ปี',
      d:'ต้องเพิ่มเงินที่เก็บต่อเดือน หรือทบทวนเป้าให้สมจริง' });
  } else if(goal>nw)
    F.push({ s:'r', t:`${c.contribMonths||12} เดือนล่าสุดเก็บเงินไม่ได้สุทธิ`,
      d:'รายจ่ายรวมหนี้เท่ากับหรือเกินรายได้ — ความมั่งคั่งโตได้จากผลตอบแทนพอร์ตอย่างเดียว คำนวณเวลาถึงเป้าไม่ได้' });
 
  if(c.safeWithdraw>0) F.push({ s:'g', t:`ตอนนี้ถอนได้ ${_n(c.safeWithdraw)} บาท/เดือน ตามกฎ 4%`,
    d: c.burn>0 ? `รายจ่ายจริงของคุณ ${_n(c.burn)} บาท/เดือน — ครอบคลุม ${(c.safeWithdraw/c.burn*100).toFixed(0)}%`
                : 'คำนวณจากความมั่งคั่งสุทธิปัจจุบัน' });
  return _mk('fire','FIRE Analyst','อีกกี่ปีถึงอิสรภาพ','🔥',F,A);
}
 
function analystDesk(ctx){
  const runners=[analystPortfolio,analystRisk,analystCashflow,analystDebt,analystFire];
  return runners.map(fn=>{
    try{ return fn(ctx||{}); }
    catch(e){ console.warn('[analyst]',fn.name,e.message);
      return _mk(fn.name,'—','เกิดข้อผิดพลาด','⚠',[{s:'y',t:'วิเคราะห์ไม่สำเร็จ',d:e.message}],[]); }
  });
}
