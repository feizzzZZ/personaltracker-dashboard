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
     POST /reset  {startTHB}→ เริ่มพอร์ตจำลองใหม่                                                        */
import '../../autobot.js';
const AutoBot = globalThis.AutoBot;

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
