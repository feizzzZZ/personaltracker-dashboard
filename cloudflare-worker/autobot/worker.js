/* ══ FinanceTracker AutoBot — Cloudflare Worker (v75 · phase 1 = PAPER เท่านั้น) ══════════════════════
   ทำอะไร: ทุก 15 นาที (cron) อ่านกฎจาก KV → ดึงราคา → ประเมินด้วย autobot.js (ไฟล์เดียวกับในแอป) → บันทึกพอร์ตจำลองลง KV
   แอปคุยกับ Worker ผ่าน HTTPS + Bearer token (secret BOT_TOKEN)

   ★ ไม่มีโค้ดส่งคำสั่งซื้อขายจริงในไฟล์นี้ — ไม่ต้องใส่ API key ของ Binance/Settrade ที่นี่ในเฟสนี้
     เฟส 2 (เงินจริง) จะเพิ่มทีหลังเมื่อผล paper น่าพอใจ: แยกฟังก์ชันส่งคำสั่ง · key แบบ "trade only, no withdraw" ·
     จำกัด IP · วงเงินต่อวัน · ปุ่มหยุดฉุกเฉิน

   Endpoints (ต้องมี Authorization: Bearer <BOT_TOKEN> ทุกตัว):
     GET  /state            → {mode, rules, state, valuation, lastRun}
     PUT  /rules  {rules}   → ตรวจแล้วบันทึก (กฎผิดรูปแบบ = 400 พร้อมเหตุผล)
     POST /run              → ประเมินเดี๋ยวนี้ (เหมือน cron)
     POST /reset  {startTHB}→ เริ่มพอร์ตจำลองใหม่

   v78 — พอร์ตสด (อ่านอย่างเดียว · ไม่มี endpoint ส่งคำสั่ง):
     GET  /live/holdings    → ยอดคงเหลือ Binance (Spot/Funding/Earn) + MetaMask (อ่านจาก blockchain) + ต้นทุนจากประวัติเทรด
     POST /live/costs {since}→ ดึงประวัติ myTrades เพิ่ม (ทีละไม่เกิน TRADE_BUDGET คำขอ) → {done, pending}
     GET  /live/config · PUT /live/config {wallets, tokens} → ที่อยู่กระเป๋า MetaMask + เหรียญที่จะอ่าน
   secret (ไม่บังคับ): BINANCE_KEY · BINANCE_SECRET — ต้องเป็น key ที่ "อ่านอย่างเดียว"
     Worker ตรวจสิทธิ์ของ key ทุกชั่วโมง (apiRestrictions) ถ้าเปิดเทรดหรือถอนได้ จะไม่ใช้ key นั้นเลย              */
import '../../js/autobot.js';
import '../../js/liveport.js';
const AutoBot = globalThis.AutoBot;
const LivePort = globalThis.LivePort;

const json = (obj, status, cors) => new Response(JSON.stringify(obj), {
  status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8', ...cors } });

// เทียบ token แบบใช้เวลาคงที่ — กันการเดาทีละตัวอักษรจากเวลาตอบ
function safeEqual(a, b){
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  for(let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function loadAll(env){
  const [rules, state, lastRun] = await Promise.all([
    env.BOT.get('rules', 'json'), env.BOT.get('state', 'json'), env.BOT.get('lastRun', 'json')]);
  return { rules: rules || [], state: state || AutoBot.newState(Number(env.START_THB) || 100000), lastRun };
}

// ราคา: market-data.json ของแอป (วันละ 2 รอบ · หุ้นไทย/US/RSI/จุดสูงสุด) + ราคา crypto สดจาก Binance
// data-api.binance.vision = endpoint ข้อมูลตลาดสาธารณะของ Binance (ไม่ต้องใช้ key · ไม่ติดบล็อกตามประเทศแบบ api.binance.com)
async function loadMarket(env, rules){
  const md = await fetch(env.MARKET_URL, { cf: { cacheTtl: 300 } }).then(r => r.ok ? r.json() : null).catch(() => null);
  const live = {};
  const syms = [...new Set(rules.filter(r => r.enabled && r.broker === 'binance').map(r => r.symbol))];
  if(syms.length){
    const q = encodeURIComponent(JSON.stringify(syms.map(s => s + 'USDT')));
    const arr = await fetch('https://data-api.binance.vision/api/v3/ticker/price?symbols=' + q)
      .then(r => r.ok ? r.json() : []).catch(() => []);
    (Array.isArray(arr) ? arr : []).forEach(x => { live[String(x.symbol).replace(/USDT$/, '')] = { price: Number(x.price), ccy: 'USD' }; });
  }
  return { market: AutoBot.marketFromData(md || {}, Date.now(), live), mdOk: !!md, liveN: Object.keys(live).length };
}

async function runOnce(env, source){
  const { rules, state } = await loadAll(env);
  const { market, mdOk, liveN } = await loadMarket(env, rules);
  const r = AutoBot.runPaper(rules, state, market);
  const lastRun = { t: Date.now(), source, orders: r.orders.length, skipped: r.skipped, mdOk, liveN, mode: 'paper' };
  await Promise.all([env.BOT.put('state', JSON.stringify(r.state)), env.BOT.put('lastRun', JSON.stringify(lastRun))]);
  return { ...lastRun, newOrders: r.orders, valuation: AutoBot.valuate(r.state, market) };
}

/* ══ v78 — พอร์ตสด ══════════════════════════════════════════════════════════════════
   เรียกเฉพาะตอนแอปขอ (fetch) ไม่เรียกใน cron: Binance ปฏิเสธคำขอจากบางประเทศ (HTTP 451) และ cron ของ
   Cloudflare รันที่ศูนย์ข้อมูลไหนก็ได้ ส่วนคำขอจากแอปรันที่ศูนย์ใกล้ผู้ใช้ (ไทย)                          */
const BINANCE = 'https://api.binance.com';
const TRADE_BUDGET = 35;              // คำขอ myTrades ต่อรอบ — Worker ฟรีจำกัด 50 subrequest ต่อคำขอ
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

function binErr(status, j, raw = '', h = null){
  const code = j && j.code, msg = (j && j.msg) || '';
  if(status === 451) return 'Binance ปฏิเสธคำขอจากตำแหน่งของเซิร์ฟเวอร์ (HTTP 451)';
  if(code === -2015 || code === -2014) return 'API key ไม่ถูกต้อง หรือ key ถูกจำกัด IP ไว้ (' + code + ')';
  if(code === -1021) return 'เวลาไม่ตรงกับ Binance (-1021) — ลองใหม่';
  if(status === 429 || status === 418) return 'เรียก Binance ถี่เกินไป (HTTP ' + status + ') — รอสักครู่';
  // v79 รอบ 2 — ไม่มี code = ไม่ใช่คำตอบของระบบ API (ไม่ได้ตรวจ key เลย) แต่เป็นด่านหน้า (CloudFront/WAF) ที่ตัดก่อน
  // เดิมทิ้งเนื้อหาไป เหลือแค่ "HTTP 403" ซึ่งบอกไม่ได้ว่าโดนบล็อกเพราะอะไร → เก็บ server/x-cache + ข้อความสั้น ๆ ไว้ด้วย
  if(code === undefined || code === null){
    const via = [h && h.get('server'), h && h.get('x-cache')].filter(Boolean).join(' · ');
    const txt = String(raw).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    return 'Binance HTTP ' + status + ' — ถูกด่านหน้าของ Binance บล็อกก่อนถึงระบบ API (ไม่ใช่ปัญหา key)'
      + (via ? ' [' + via + ']' : '') + (txt ? ': ' + txt : '');
  }
  return 'Binance HTTP ' + status + ' ' + code + (msg ? ' ' + msg : '');
}
// fetch ใน Worker ไม่ใส่ User-Agent ให้เอง — ด่าน WAF หลายแห่งตอบ 403 กับคำขอที่ไม่มี User-Agent
const UA = 'FinanceTracker-Worker/1.0 (read-only)';
async function bnb(env, path, params = {}, method = 'GET'){
  const qs = new URLSearchParams({ ...params, recvWindow: '10000', timestamp: String(Date.now()) }).toString();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.BINANCE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(qs)));
  const r = await fetch(`${BINANCE}${path}?${qs}&signature=${sig}`, { method, headers: { 'X-MBX-APIKEY': env.BINANCE_KEY, 'user-agent': UA } });
  const raw = await r.text();
  let j = null; try{ j = JSON.parse(raw); }catch(e){}
  if(!r.ok){ const e = new Error(binErr(r.status, j, raw, r.headers)); e.code = j && j.code; throw e; }
  return j;
}
// key ต้องอ่านได้อย่างเดียว — เปิดเทรด/ถอน/margin/futures/โอนภายใน อย่างใดอย่างหนึ่ง = ไม่ใช้
const RISKY = ['enableWithdrawals', 'enableSpotAndMarginTrading', 'enableMargin', 'enableFutures',
  'enableInternalTransfer', 'permitsUniversalTransfer', 'enableVanillaOptions', 'enablePortfolioMarginTrading'];
async function keyIsReadOnly(env){
  const c = await env.BOT.get('liveKeyCheck', 'json');
  if(c && c.key === env.BINANCE_KEY.slice(-6) && Date.now() - c.t < 3600e3) return c;
  const r = await bnb(env, '/sapi/v1/account/apiRestrictions');
  const bad = RISKY.filter(k => r[k] === true);
  const out = { t: Date.now(), key: env.BINANCE_KEY.slice(-6), ok: bad.length === 0 && r.enableReading !== false, bad };
  await env.BOT.put('liveKeyCheck', JSON.stringify(out));
  return out;
}
const liveCfg = async env => (await env.BOT.get('liveCfg', 'json')) || { wallets: [], tokens: [] };
const rpc = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then(r => { if(!r.ok) throw new Error('RPC HTTP ' + r.status); return r.json(); });

async function liveHoldings(env){
  const out = { t: Date.now(), binance: { configured: !!(env.BINANCE_KEY && env.BINANCE_SECRET), ok: false, err: '', warn: [], rows: [] },
    evm: { rows: [], errs: [] } };
  const cfg = await liveCfg(env);
  const evmJobs = Object.entries(LivePort.evmRequests(cfg)).map(async ([chain, req]) => {
    try{ const p = LivePort.evmParse(chain, req, await rpc(req.rpc, req.body)); out.evm.rows.push(...p.rows); out.evm.errs.push(...p.errs); }
    catch(e){ out.evm.errs.push(LivePort.CHAINS[chain].name + ': ' + e.message); }
  });
  const binJob = (async () => {
    if(!out.binance.configured) return;
    try{
      const chk = await keyIsReadOnly(env);
      if(!chk.ok){ out.binance.err = 'key นี้มีสิทธิ์เกินอ่าน (' + chk.bad.join(', ') + ') — Worker จะไม่ใช้ ให้สร้าง key ใหม่แบบอ่านอย่างเดียว'; out.binance.unsafe = true; return; }
      const [spot, funding, flex, locked] = await Promise.allSettled([
        bnb(env, '/api/v3/account', { omitZeroBalances: 'true' }),
        bnb(env, '/sapi/v1/asset/get-funding-asset', {}, 'POST'),
        bnb(env, '/sapi/v1/simple-earn/flexible/position', { size: '100' }),
        bnb(env, '/sapi/v1/simple-earn/locked/position', { size: '100' })]);
      if(spot.status === 'rejected'){ out.binance.err = spot.reason.message; return; }
      [['Funding', funding], ['Earn ยืดหยุ่น', flex], ['Earn ล็อก', locked]].forEach(([n, r]) => {
        if(r.status === 'rejected') out.binance.warn.push(n + ': ' + r.reason.message); });
      const v = r => r.status === 'fulfilled' ? r.value : null;
      out.binance.rows = LivePort.binanceRows(spot.value, v(funding), v(flex), v(locked));
      out.binance.ok = true;
    }catch(e){ out.binance.err = e.message; }
  })();
  await Promise.all([...evmJobs, binJob]);
  const trades = (await env.BOT.get('liveTrades', 'json')) || { pairs: {} };
  out.cost = { assets: LivePort.costFromTrades(trades.pairs), t: trades.t || null };
  // สินทรัพย์ที่ถือ (ทุกที่) — /live/costs ใช้เลือกคู่ที่จะดึงประวัติ
  const assets = [...new Set([...out.binance.rows, ...out.evm.rows].map(r => r.asset))];
  if(out.binance.ok) await env.BOT.put('liveAssets', JSON.stringify(assets));
  return out;
}

async function liveCosts(env, since){
  if(!(env.BINANCE_KEY && env.BINANCE_SECRET)) return { done: true, pending: 0, fetched: 0, err: 'ยังไม่ได้ตั้ง BINANCE_KEY / BINANCE_SECRET' };
  const chk = await keyIsReadOnly(env);
  if(!chk.ok) return { done: true, pending: 0, fetched: 0, err: 'key นี้มีสิทธิ์เกินอ่าน — Worker ไม่ใช้' };
  const assets = (await env.BOT.get('liveAssets', 'json')) || [];
  const store = (await env.BOT.get('liveTrades', 'json')) || { pairs: {} };
  const round = Number(since) > 0 ? Number(since) : Date.now();
  let calls = 0, fetched = 0, err = '';
  const todo = LivePort.tradePairsFor(assets).filter(c => {
    const p = store.pairs[c.pair];
    return !(p && (p.none || p.checked >= round));
  });
  outer: for(const c of todo){
    const p = store.pairs[c.pair] || (store.pairs[c.pair] = { base: c.base, quote: c.quote, rows: [], lastId: null });
    for(;;){
      if(calls >= TRADE_BUDGET) break outer;
      calls++;
      let arr;
      try{ arr = await bnb(env, '/api/v3/myTrades', { symbol: c.pair, limit: '1000', fromId: String(p.lastId == null ? 0 : p.lastId + 1) }); }
      catch(e){
        if(e.code === -1121){ p.none = true; delete p.rows; break; }      // ไม่มีคู่นี้บน Binance
        err = e.message; break outer;
      }
      (arr || []).forEach(t => { p.rows.push(LivePort.compactTrade(t)); p.lastId = Math.max(p.lastId == null ? -1 : p.lastId, Number(t.id)); });
      fetched += (arr || []).length;
      if(!arr || arr.length < 1000){ p.checked = Date.now(); break; }
    }
  }
  store.t = Date.now();
  await env.BOT.put('liveTrades', JSON.stringify(store));
  const pending = LivePort.tradePairsFor(assets).filter(c => { const p = store.pairs[c.pair]; return !(p && (p.none || p.checked >= round)); }).length;
  return { done: pending === 0 || !!err, pending, fetched, calls, err };
}

// เติม symbol/decimals ของเหรียญที่ผู้ใช้เพิ่มด้วยที่อยู่สัญญาอย่างเดียว (อ่านจาก blockchain)
async function resolveTokens(cfg){
  const need = cfg.tokens.filter(t => t.decimals == null || !t.symbol);
  const byChain = {};
  need.forEach(t => (byChain[t.chain] = byChain[t.chain] || []).push(t));
  await Promise.all(Object.entries(byChain).map(async ([chain, list]) => {
    const body = list.flatMap((t, i) => [
      { jsonrpc: '2.0', id: i * 2 + 1, method: 'eth_call', params: [{ to: t.address, data: LivePort.SEL_DECIMALS }, 'latest'] },
      { jsonrpc: '2.0', id: i * 2 + 2, method: 'eth_call', params: [{ to: t.address, data: LivePort.SEL_SYMBOL }, 'latest'] }]);
    const resp = await rpc(LivePort.CHAINS[chain].rpc, body);
    const byId = {}; (Array.isArray(resp) ? resp : []).forEach(r => { byId[r.id] = r; });
    list.forEach((t, i) => {
      const d = byId[i * 2 + 1], s = byId[i * 2 + 2];
      const dec = d && d.result && d.result !== '0x' ? Number(BigInt(d.result)) : null;
      const sym = s && s.result ? LivePort.decodeAbiString(s.result) : '';
      if(t.decimals == null){ if(dec == null || dec > 36) throw new Error(`อ่าน decimals ของ ${t.address} บน ${LivePort.CHAINS[chain].name} ไม่ได้ — ตรวจที่อยู่สัญญาและเครือข่าย`); t.decimals = dec; }
      if(!t.symbol){ if(!sym) throw new Error(`อ่านชื่อเหรียญ ${t.address} ไม่ได้ — ใส่ชื่อเอง`); t.symbol = sym.toUpperCase(); }
    });
  }));
  return cfg;
}

export default {
  async fetch(req, env){
    const origin = req.headers.get('origin') || '';
    const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = allowed.includes(origin) ? {
      'access-control-allow-origin': origin, 'vary': 'origin',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, PUT, POST, OPTIONS' } : {};
    if(req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if(!env.BOT_TOKEN || env.BOT_TOKEN.length < 24) return json({ error: 'ตั้ง secret BOT_TOKEN (ยาวอย่างน้อย 24 ตัว) ก่อน' }, 500, cors);
    const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if(!safeEqual(auth, env.BOT_TOKEN)) return json({ error: 'unauthorized' }, 401, cors);

    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    try{
      if(req.method === 'GET' && path === '/state'){
        const all = await loadAll(env);
        const { market } = await loadMarket(env, all.rules);
        return json({ mode: 'paper', ...all, valuation: AutoBot.valuate(all.state, market) }, 200, cors);
      }
      if(req.method === 'PUT' && path === '/rules'){
        const body = await req.json().catch(() => null);
        const rules = body && Array.isArray(body.rules) ? body.rules : null;
        if(!rules || rules.length > 50) return json({ error: 'ส่ง {rules:[…]} ไม่เกิน 50 กฎ' }, 400, cors);
        for(const r of rules){ const e = AutoBot.validateRule(r); if(e) return json({ error: (r && r.name || '?') + ': ' + e }, 400, cors); }
        await env.BOT.put('rules', JSON.stringify(rules));
        return json({ ok: true, n: rules.length }, 200, cors);
      }
      if(req.method === 'POST' && path === '/run') return json(await runOnce(env, 'manual'), 200, cors);
      if(req.method === 'GET' && path === '/live/holdings') return json(await liveHoldings(env), 200, cors);
      if(req.method === 'POST' && path === '/live/costs'){
        const body = await req.json().catch(() => ({}));
        return json(await liveCosts(env, body && body.since), 200, cors);
      }
      if(req.method === 'GET' && path === '/live/config') return json(await liveCfg(env), 200, cors);
      if(req.method === 'PUT' && path === '/live/config'){
        const body = await req.json().catch(() => null);
        const cfg = { wallets: (body && body.wallets) || [], tokens: (body && body.tokens) || [] };
        cfg.wallets = cfg.wallets.map(w => ({ address: String(w.address || '').trim(), label: String(w.label || '').slice(0, 40), chains: w.chains }));
        cfg.tokens = cfg.tokens.map(t => ({ chain: t.chain, address: String(t.address || '').trim(),
          symbol: t.symbol ? String(t.symbol).trim().toUpperCase().slice(0, 16) : '', decimals: t.decimals === '' || t.decimals == null ? null : Number(t.decimals) }));
        const e = LivePort.validateConfig(cfg);
        if(e) return json({ error: e, errorEn: LivePort.CFG_ERR_EN[e] || e }, 400, cors);
        try{ await resolveTokens(cfg); }catch(err){ return json({ error: err.message }, 400, cors); }
        await env.BOT.put('liveCfg', JSON.stringify(cfg));
        return json({ ok: true, cfg }, 200, cors);
      }
      if(req.method === 'POST' && path === '/reset'){
        const body = await req.json().catch(() => ({}));
        const st = AutoBot.newState(Number(body.startTHB) || Number(env.START_THB) || 100000);
        await env.BOT.put('state', JSON.stringify(st));
        return json({ ok: true, state: st }, 200, cors);
      }
      return json({ error: 'not found' }, 404, cors);
    }catch(e){ return json({ error: String(e && e.message || e) }, 500, cors); }
  },
  async scheduled(_evt, env, ctx){ ctx.waitUntil(runOnce(env, 'cron')); },
};
