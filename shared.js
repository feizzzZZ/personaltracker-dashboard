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
const APP_BUILD = 'v26';
console.log('[Finance OS shared] build', APP_BUILD);

// ═══ LIVE_META — นิยามการ์ดข้อมูลตลาด ═══
const LIVE_META = {
  SP500:     {label:'S&P 500',        fmt:v=>Number(v).toLocaleString(undefined,{maximumFractionDigits:0})},
  SP500_CHG: {label:'S&P 500 Δ วันนี้',fmt:v=>(v>=0?'+':'')+Number(v).toFixed(2)+'%', signed:true},
  NASDAQ:    {label:'Nasdaq',         fmt:v=>Number(v).toLocaleString(undefined,{maximumFractionDigits:0})},
  VIX:       {label:'VIX (Fear)',     fmt:v=>Number(v).toFixed(1)},
  SET_INDEX: {label:'SET Index',      fmt:v=>Number(v).toLocaleString(undefined,{maximumFractionDigits:1})},
  USDTHB:    {label:'USD/THB',        fmt:v=>Number(v).toFixed(2)},
  BTCUSD:    {label:'Bitcoin',        fmt:v=>'$'+Number(v).toLocaleString(undefined,{maximumFractionDigits:0})},
  ETHUSD:    {label:'Ethereum',       fmt:v=>'$'+Number(v).toLocaleString(undefined,{maximumFractionDigits:0})},
  GOLD_GLD:  {label:'Gold (GLD proxy)',fmt:v=>'$'+Number(v).toFixed(1)},
  FED_RATE:  {label:'Fed Funds Rate', fmt:v=>Number(v).toFixed(2)+'%'},
  BOT_RATE:  {label:'BOT Policy Rate',fmt:v=>Number(v).toFixed(2)+'%'},
  US10Y:     {label:'US 10Y Yield',   fmt:v=>Number(v).toFixed(2)+'%'},
  GOLD_XAU:  {label:'Gold Spot (XAU)',fmt:v=>'$'+Number(v).toLocaleString(undefined,{maximumFractionDigits:0})},
  US_CPI:    {label:'US CPI YoY',     fmt:v=>Number(v).toFixed(1)+'%'},
  US_PCE:    {label:'US PCE YoY',     fmt:v=>Number(v).toFixed(1)+'%'},
  NFP:       {label:'NFP (Jobs)',     fmt:v=>(v>=0?'+':'')+Number(v).toLocaleString()+'K'},
  US_GDP:    {label:'US GDP QoQ',     fmt:v=>(v>=0?'+':'')+Number(v).toFixed(1)+'%'},
  ISM_MFG:   {label:'ISM Manufacturing', fmt:v=>Number(v).toFixed(1)},
  ISM_SVC:   {label:'ISM Services',   fmt:v=>Number(v).toFixed(1)},
  YIELD_CURVE:{label:'Yield Curve 2s10s', fmt:v=>(v>=0?'+':'')+Number(v).toFixed(0)+'bps', signed:true},
  CREDIT_SPREAD:{label:'Credit Spread HY-IG', fmt:v=>Number(v).toFixed(1)+'%'},
  TH_CPI:    {label:'CPI ไทย YoY',    fmt:v=>Number(v).toFixed(1)+'%'},
  TH_GDP:    {label:'GDP ไทย YoY',    fmt:v=>(v>=0?'+':'')+Number(v).toFixed(1)+'%'},
  TH_TOURISTS:{label:'นักท่องเที่ยว/เดือน', fmt:v=>Number(v).toFixed(1)+'M'},
  TH_FDI:    {label:'FDI ไทย',        fmt:v=>'฿'+Number(v).toLocaleString()+'B'},
  SP500_RSI: {label:'S&P 500 RSI (14d)', fmt:v=>Number(v).toFixed(0)},
  SET_RSI:   {label:'SET RSI (14d)',  fmt:v=>Number(v).toFixed(0)},
  PUT_CALL:  {label:'Put/Call Ratio', fmt:v=>Number(v).toFixed(2)},
  SP500_MA200:{label:'S&P vs MA200',  fmt:v=>String(v)},
  SET_MA200: {label:'SET vs MA200',   fmt:v=>String(v)},
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
    const curT = cur?.updated ? Date.parse(cur.updated) : 0;
    const actT = v.updated ? Date.parse(v.updated) : 0;
    if(!cur || actT >= curT) md.data[k] = { value:v.value, updated:v.updated, note:'🤖 '+(v.note||'pipeline') };
  });
  return md;
}
function loadMarketData(){
  try{
    let md = JSON.parse(localStorage.getItem('finOS_market')||'null');
    md = mergeActionsIntoMarket(md);   // Method 3
    return mergeExtIntoMarket(md);     // Method 2 (crypto สดสุด ชนะเสมอ)
  }catch(e){ return null; }
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
  'Provident Fund': {label:'Provident Fund',color:'#ffa94d',target:5},
  'Other':          {label:'Other',        color:'#5a5a8a', target:2},
};
const CASH_TARGET = 22; // default เท่านั้น — ค่าจริงมาจาก getTargets()

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
  if(!series || !series.length) return null;
  let best = series[0][1];
  for(let i=0;i<series.length;i++){
    if(Date.parse(series[i][0]) <= tMs) best = series[i][1];
    else break;
  }
  return best;
}
function benchmarkXIRR(flows){
  const act = loadActions();
  const h = act && act.history;
  if(!h || !h.SP500 || h.SP500.length<10 || !h.USDTHB || !h.USDTHB.length) return null;
  let units = 0;
  for(const f of flows){
    const px = priceAt(h.SP500, f.t), fx = priceAt(h.USDTHB, f.t);
    if(!px || !fx) return null;
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
  return r===null ? null : { rate:r, terminal, asOf };
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
