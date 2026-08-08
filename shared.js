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
const APP_BUILD = 'v43';
console.log('[Finance OS shared] build', APP_BUILD);

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
  'Provident Fund': {label:'Provident Fund',color:'#ffa94d',target:5},
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
function computeDeviations(real){
  const targets = getTargets();
  const cashBal = real.cashBalance||0;
  const totalVal = (real.totalValue||0)+cashBal;
  if(totalVal<=0) return {list:[],totalVal:0};
  const cur={};
  Object.entries(real.allocation||{}).forEach(([k,v])=>{ if(v.value>0) cur[k]=v.value/totalVal*100; });
  cur['Cash']=cashBal/totalVal*100;
  const list=[];
  new Set([...Object.keys(cur),...Object.keys(targets)]).forEach(k=>{
    const c=cur[k]||0, t=targets[k]??0;
    if(t<=0 && c<=0) return;
    list.push({key:k, label:ALLOC_META[k]?.label||k, cur:c, target:t,
               diff:c-t, amt:Math.round(Math.abs(c-t)/100*totalVal),
               color:ALLOC_META[k]?.color||'#8080b0'});
  });
  list.sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff));
  return {list, totalVal};
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
  minPct: 10,           // ขั้นต่ำมาตรฐานบัตรเครดิตไทย = 10% ของยอดคงเหลือ (ขั้นต่ำ ฿500)
  minFloor: 500,
  strategy: 'avalanche',// avalanche = จ่ายดอกสูงสุดก่อน (ประหยัดเงินที่สุด)
  extraPerMonth: 0,     // เงินที่จ่ายเพิ่มจากขั้นต่ำต่อเดือน
};
function getDebtCfg(){
  try{ const s = JSON.parse(localStorage.getItem('finOS_debtCfg')||'null');
       if(s && typeof s==='object') return {...DEBT_DEFAULT, ...s, apr:{...DEBT_DEFAULT.apr, ...(s.apr||{})}}; }catch(e){}
  return JSON.parse(JSON.stringify(DEBT_DEFAULT));
}
function saveDebtCfg(cfg){
  const cur = getDebtCfg();
  localStorage.setItem('finOS_debtCfg', JSON.stringify({...cur, ...cfg, apr:{...cur.apr, ...(cfg.apr||{})}}));
}

// ═══ buildDebtPlan — จำลองการปลดหนี้เดือนต่อเดือน ═══
// avalanche: จ่ายขั้นต่ำทุกใบ แล้วโยนเงินเหลือทั้งหมดใส่ใบที่ APR สูงสุด
// snowball : เหมือนกันแต่เรียงตามยอดน้อยสุด (แพงกว่า แต่เห็นผลเร็ว = แรงใจ)
// คืน null ถ้าไม่มีหนี้ · คืน {months:Infinity} ถ้าจ่ายไม่พอดอกเบี้ย (หนี้โต)
function buildDebtPlan(liabAccounts, cfg){
  cfg = cfg || getDebtCfg();
  let debts = (liabAccounts||[])
    .map(b=>({ name:b.name,
               bal: Math.abs(Math.min(0, b.balance)),
               apr: Number(cfg.apr[b.name] ?? 0) }))
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
      const int = d.bal * (d.apr/100) / 12;
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
    debts.forEach(d=>{ if(d.bal<=0.5 && !payoffMonth[d.name]){ payoffMonth[d.name]=month; d.bal=0; } });
    timeline.push({ m:month, total: debts.reduce((s,d)=>s+d.bal,0) });
  }

  const done = month < MAX;
  return {
    months: done ? month : Infinity,
    totalStart, totalInterest, budget, baseMin,
    strategy: cfg.strategy,
    payoffMonth, timeline,
    order: order.map(d=>({name:d.name, apr:d.apr,
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
  const rows = (liabAccounts||[])
    .map(b=>({ name:b.name, bal:Math.abs(Math.min(0,b.balance)), apr:Number(cfg.apr[b.name] ?? 0) }))
    .filter(d=>d.bal>0.5)
    .map(d=>({ ...d, edge: d.apr-exp, verdict: d.apr>exp ? 'จ่ายหนี้ก่อน' : d.apr>0 ? 'ลงทุนก่อน' : 'ยังไม่ได้ใส่ดอกเบี้ย' }));
  const yearlyInterest = rows.reduce((s,d)=>s + d.bal*d.apr/100, 0);
  return { rows, expectedReturn: exp, yearlyInterest,
           monthlyInterest: yearlyInterest/12 };
}
