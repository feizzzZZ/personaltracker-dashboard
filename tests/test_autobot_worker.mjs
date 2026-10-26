/* v75 — Cloudflare Worker ของบอท: auth · CORS · ตรวจกฎ · run · cron (KV/fetch จำลอง ไม่ใช้ network)
   รัน:  node tests/test_autobot_worker.mjs                                   */
import fs from 'fs'; import path from 'path'; import os from 'os'; import { pathToFileURL } from 'url';
let FAIL = 0;
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { FAIL++; console.log('  ✗ ' + n + '  ' + d); } };

new Function(fs.readFileSync('js/autobot.js', 'utf8'))();
new Function(fs.readFileSync('js/liveport.js', 'utf8'))();
const src = fs.readFileSync('cloudflare-worker/autobot/worker.js', 'utf8').replace(/^import '\.\.\/\.\.\/js\/(autobot|liveport)\.js';$/mg, '');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'abw-')), 'worker.mjs');
fs.writeFileSync(tmp, src);
const W = (await import(pathToFileURL(tmp).href)).default;

const kv = new Map();
const env = { BOT_TOKEN: 'x'.repeat(32), ALLOWED_ORIGIN: 'https://me.github.io', MARKET_URL: 'https://md/market-data.json', START_THB: '50000',
  BOT: { get: async (k, t) => kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } } };
const MD = { prices: { PTT: { price: 32, ccy: 'THB' }, BTC: { price: 60000, ccy: 'USD' } },
             signals: { PTT: { rsi: 25, drawdown: -10 }, BTC: { rsi: 50, drawdown: -5 } }, data: { USDTHB: { value: 34 } } };
let binanceCalls = 0;
let liveFetch = null;
const BN_HOST = /^https:\/\/api(-gcp|\d)?\.binance\.com\//;   // v79 รอบ 4 — ทุกโดเมนของ Binance API
const RPC_ALT = /drpc\.org|1rpc\.io|llamarpc\.com|bnbchain\.org|arbitrum\.io|base\.org|optimism\.io/;   // v79 รอบ 3 — RPC สำรอง                  // v78 — ตัวจำลอง api.binance.com / RPC (ตั้งในส่วนพอร์ตสด)
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (liveFetch && (BN_HOST.test(url) || url.includes('publicnode.com') || RPC_ALT.test(url))) return liveFetch(url, init);
  if (url.startsWith(env.MARKET_URL)) return new Response(JSON.stringify(MD));
  if (url.includes('data-api.binance.vision')) { binanceCalls++; return new Response(JSON.stringify([{ symbol: 'BTCUSDT', price: '58000' }])); }
  throw new Error('unexpected fetch ' + url);
};
const call = (method, p, body, headers = {}) => W.fetch(new Request('https://w' + p, { method,
  headers: { authorization: 'Bearer ' + env.BOT_TOKEN, origin: 'https://me.github.io', 'content-type': 'application/json', ...headers },
  body: body ? JSON.stringify(body) : undefined }), env);

console.log('\n═══ auth / CORS ═══');
chk('ไม่มี token → 401', (await call('GET', '/state', null, { authorization: '' })).status === 401);
chk('token ผิด → 401', (await call('GET', '/state', null, { authorization: 'Bearer ' + 'y'.repeat(32) })).status === 401);
const ok = await call('GET', '/state');
chk('token ถูก → 200', ok.status === 200);
chk('origin ที่อนุญาต → มี CORS header', ok.headers.get('access-control-allow-origin') === 'https://me.github.io');
const bad = await call('GET', '/state', null, { origin: 'https://evil.example' });
chk('origin อื่น → ไม่มี CORS header', !bad.headers.get('access-control-allow-origin'));
chk('token สั้นเกิน → ไม่ยอมทำงาน', (await W.fetch(new Request('https://w/state', { headers: { authorization: 'Bearer abc' } }), { ...env, BOT_TOKEN: 'abc' })).status === 500);
const st0 = await ok.json();
chk('state เริ่มต้นใช้ START_THB', st0.state.cash === 50000 && st0.mode === 'paper');

console.log('\n═══ กฎ ═══');
const bad1 = await call('PUT', '/rules', { rules: [{ id: 'a', name: 'x', enabled: true, broker: 'robinhood', symbol: 'PTT', side: 'buy', trigger: { kind: 'rsi_below', value: 30 }, amountTHB: 1000 }] });
chk('กฎผิด → 400 + เหตุผล', bad1.status === 400 && /โบรกเกอร์/.test((await bad1.json()).error));
const rules = [
  { id: 'p', name: 'PTT RSI', enabled: true, broker: 'settrade', symbol: 'PTT', side: 'buy', trigger: { kind: 'rsi_below', value: 30 }, amountTHB: 3200, cooldownDays: 7 },
  { id: 'b', name: 'BTC < 59k', enabled: true, broker: 'binance', symbol: 'BTC', side: 'buy', trigger: { kind: 'price_below', value: 59000 }, amountTHB: 1000, cooldownDays: 1 }];
chk('บันทึกกฎ', (await call('PUT', '/rules', { rules })).status === 200 && JSON.parse(kv.get('rules')).length === 2);

console.log('\n═══ run ═══');
const run = await (await call('POST', '/run')).json();
chk('ยิง 2 คำสั่ง (PTT RSI 25 · BTC สด 58k < 59k)', run.orders === 2, JSON.stringify(run.skipped));
chk('ใช้ราคา Binance สดแทน market-data', run.newOrders.find(o => o.symbol === 'BTC').price === 58000 && binanceCalls === 1);
chk('ทุกคำสั่งเป็น paper', run.newOrders.every(o => o.mode === 'paper'));
chk('เงินสดจำลองลด', Math.abs(JSON.parse(kv.get('state')).cash - (50000 - 4200)) < 1e-6);
const run2 = await (await call('POST', '/run')).json();
chk('รอบถัดไปติดระยะพัก ไม่ซื้อซ้ำ', run2.orders === 0 && run2.skipped.every(s => /พัก/.test(s.why)));

console.log('\n═══ cron / reset ═══');
let waited; await W.scheduled({}, env, { waitUntil: p => { waited = p; } }); await waited;
chk('cron บันทึก lastRun', JSON.parse(kv.get('lastRun')).source === 'cron');
const rs = await call('POST', '/reset', { startTHB: 20000 });
chk('reset เริ่มใหม่ ฿20,000', rs.status === 200 && JSON.parse(kv.get('state')).cash === 20000 && JSON.parse(kv.get('state')).ledger.length === 0);
chk('path ไม่รู้จัก → 404', (await call('GET', '/nope')).status === 404);
chk('ในไฟล์ Worker ไม่มีการเรียก endpoint ส่งคำสั่ง', !/\/api\/v3\/order|placeOrder|settrade.*order/i.test(src));

console.log('\n═══ v78 พอร์ตสด ═══');
const A = '0x' + 'ab'.repeat(20), TOK = '0x' + 'cd'.repeat(20);
const restr = { enableReading: true, enableWithdrawals: false, enableSpotAndMarginTrading: false };
const calls = [];
const uaSeen = []; let bnBlocked = false;
let bnBlockHosts = []; const bnHits = [];   // v79 รอบ 4 — โดเมนที่ให้ CloudFront บล็อก · host+path ที่ถูกเรียก
let rpcDown = []; const rpcHits = [];   // v79 รอบ 3 — host ของ RPC ที่ให้ตอบ 429 · host ที่ถูกเรียก   // v79 รอบ 2 — User-Agent ที่ส่งไป Binance · จำลองด่าน CloudFront ตอบ 403
const TR = {   // myTrades จำลอง: BTCUSDT 2 หน้า (1000 + 1) · BTCFDUSD ไม่มีคู่ · อื่น ๆ ว่าง
  BTCUSDT: Array.from({ length: 1001 }, (_, i) => ({ id: i, time: i, isBuyer: true, qty: '0.001', quoteQty: '50', commission: '0', commissionAsset: 'USDT' })) };
liveFetch = async (url, init) => {
  const u = new URL(url); calls.push(u.pathname);
  if (/^api(-gcp|\d)?\.binance\.com$/.test(u.hostname)) {
    uaSeen.push(init.headers['user-agent']); bnHits.push(u.hostname + u.pathname);
    if (bnBlocked || bnBlockHosts.includes(u.hostname)) return new Response('<HTML><HEAD><TITLE>ERROR: The request could not be satisfied</TITLE></HEAD><BODY><H1>403 ERROR</H1>Request blocked.</BODY></HTML>',
      { status: 403, headers: { server: 'CloudFront', 'x-cache': 'Error from cloudfront' } });
    if (u.pathname === '/api/v3/ping') return new Response('{}');
    if (init.headers['X-MBX-APIKEY'] !== 'k'.repeat(64)) return new Response('{"code":-2015,"msg":"bad key"}', { status: 401 });
    if (!/^[0-9a-f]{64}$/.test(u.searchParams.get('signature') || '')) return new Response('{"code":-1022}', { status: 400 });
    switch (u.pathname) {
      case '/sapi/v1/account/apiRestrictions': return new Response(JSON.stringify(restr));
      case '/api/v3/account': return new Response(JSON.stringify({ balances: [{ asset: 'BTC', free: '1', locked: '0' }, { asset: 'USDT', free: '10', locked: '0' }] }));
      case '/sapi/v1/asset/get-funding-asset': return new Response('{"code":-1002,"msg":"no"}', { status: 401 });
      case '/sapi/v1/simple-earn/flexible/position': return new Response(JSON.stringify({ rows: [{ asset: 'BTC', totalAmount: '0.5' }] }));
      case '/sapi/v1/simple-earn/locked/position': return new Response(JSON.stringify({ rows: [] }));
      case '/api/v3/myTrades': {
        const sym = u.searchParams.get('symbol'), from = Number(u.searchParams.get('fromId'));
        if (sym === 'BTCFDUSD') return new Response('{"code":-1121,"msg":"Invalid symbol."}', { status: 400 });
        return new Response(JSON.stringify((TR[sym] || []).filter(t => t.id >= from).slice(0, 1000)));
      }
    }
    return new Response('{}', { status: 404 });
  }
  rpcHits.push(u.hostname);
  if (rpcDown.some(h => u.hostname.includes(h))) return new Response('rate limited', { status: 429 });
  const body = JSON.parse(init.body);
  return new Response(JSON.stringify(body.map(r => r.method === 'eth_getBalance' ? { id: r.id, result: '0xde0b6b3a7640000' }
    : r.params[0].data === LivePort.SEL_DECIMALS ? { id: r.id, result: '0x6' }
    : r.params[0].data === LivePort.SEL_SYMBOL ? { id: r.id, result: '0x' + '20'.padStart(64, '0') + '4'.padStart(64, '0') + Buffer.from('USDC').toString('hex').padEnd(64, '0') }
    : { id: r.id, result: '0x' + (5000000n).toString(16) })));
};
const LivePort = globalThis.LivePort;
let h0 = await (await call('GET', '/live/holdings')).json();
chk('ไม่มี key Binance → configured=false ไม่เรียก Binance', h0.binance.configured === false && !calls.some(c => c.startsWith('/api') || c.startsWith('/sapi')));
chk('/live ต้องมี token', (await call('GET', '/live/holdings', null, { authorization: '' })).status === 401);
const envK = { ...env, BINANCE_KEY: 'k'.repeat(64), BINANCE_SECRET: 's'.repeat(64) };
const callK = (method, p, body) => W.fetch(new Request('https://w' + p, { method,
  headers: { authorization: 'Bearer ' + env.BOT_TOKEN, origin: 'https://me.github.io', 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined }), envK);
const badCfg = await callK('PUT', '/live/config', { wallets: [{ address: '0x12', chains: ['eth'] }] });
chk('config ผิด → 400 + ข้อความ 2 ภาษา', badCfg.status === 400 && (await badCfg.json()).errorEn);
const okCfg = await (await callK('PUT', '/live/config', { wallets: [{ address: A, chains: ['eth'] }], tokens: [{ chain: 'eth', address: TOK }] })).json();
chk('เติม symbol/decimals ของเหรียญจาก blockchain', okCfg.ok && okCfg.cfg.tokens[0].symbol === 'USDC' && okCfg.cfg.tokens[0].decimals === 6);
let h1 = await (await callK('GET', '/live/holdings')).json();
chk('Binance: spot + earn (funding ล้ม = คำเตือน ไม่ล้มทั้งหมด)', h1.binance.ok && h1.binance.rows.length === 3 && h1.binance.warn.length === 1, JSON.stringify(h1.binance));
chk('MetaMask: ETH 1 + USDC 5', h1.evm.rows.find(r => r.asset === 'ETH').amount === 1 && h1.evm.rows.find(r => r.asset === 'USDC').amount === 5);
chk('ตรวจสิทธิ์ key แล้ว cache (ไม่เรียกซ้ำทุกครั้ง)', calls.filter(c => c === '/sapi/v1/account/apiRestrictions').length === 1);
const c1 = await (await callK('POST', '/live/costs', { since: Date.now() })).json();
chk('ดึงประวัติ 2 หน้า (1001 รายการ) · คู่ที่ไม่มี → ข้าม', c1.done && c1.fetched === 1001 && c1.pending === 0, JSON.stringify(c1));
const lt = JSON.parse(kv.get('liveTrades'));
chk('จำคู่ที่ไม่มีบน Binance', lt.pairs.BTCFDUSD.none === true);
h1 = await (await callK('GET', '/live/holdings')).json();
chk('ต้นทุน BTC จากประวัติ = $50,000/หน่วย', Math.abs(h1.cost.assets.BTC.wacc - 50000) < 1e-6 && Math.abs(h1.cost.assets.BTC.qty - 1.001) < 1e-9);
const before = calls.filter(c => c === '/api/v3/myTrades').length;
await callK('POST', '/live/costs', { since: 1 });
chk('เรียกซ้ำในรอบเดียวกัน → คู่ที่ตามทันแล้วไม่ดึงอีก', calls.filter(c => c === '/api/v3/myTrades').length === before);
await callK('POST', '/live/costs', { since: Date.now() + 1 });
chk('รอบใหม่: คู่ละ 1 คำขอ · BTC 2 คู่ (ข้าม FDUSD ที่ไม่มี) + ETH จาก MetaMask 3 คู่', calls.filter(c => c === '/api/v3/myTrades').length - before === 5);
TR.BTCUSDT.push({ id: 1001, time: 1001, isBuyer: false, qty: '0.001', quoteQty: '60', commission: '0', commissionAsset: 'USDT' });
await callK('POST', '/live/costs', { since: Date.now() + 1 });
chk('เทรดใหม่เข้ามาต่อท้าย ไม่ซ้ำ', JSON.parse(kv.get('liveTrades')).pairs.BTCUSDT.rows.length === 1002);
// key ที่เปิดเทรดได้ → ไม่ใช้
restr.enableSpotAndMarginTrading = true; kv.delete('liveKeyCheck');
const h2 = await (await callK('GET', '/live/holdings')).json();
chk('key เปิดเทรดได้ → ไม่ใช้ ไม่ดึงยอด', h2.binance.unsafe && !h2.binance.ok && /อ่านอย่างเดียว/.test(h2.binance.err));
const c2 = await (await callK('POST', '/live/costs', {})).json();
chk('key เปิดเทรดได้ → ไม่ดึงประวัติ', !!c2.err && c2.fetched === 0);
restr.enableSpotAndMarginTrading = false; restr.enableWithdrawals = true; kv.delete('liveKeyCheck');
chk('key เปิดถอนได้ → ไม่ใช้', (await (await callK('GET', '/live/holdings')).json()).binance.unsafe === true);
chk('ส่ง User-Agent ทุกคำขอที่ไป api.binance.com', uaSeen.length > 0 && uaSeen.every(u => typeof u === 'string' && u.length > 0));
restr.enableWithdrawals = false; kv.delete('liveKeyCheck'); bnBlocked = true;
const h3 = await (await callK('GET', '/live/holdings')).json();
chk('403 จากด่านหน้า (ไม่มี code) → บอกว่าไม่ใช่ปัญหา key + server + ข้อความ', !h3.binance.ok
  && /HTTP 403/.test(h3.binance.err) && /ไม่ใช่ปัญหา key/.test(h3.binance.err) && /CloudFront/.test(h3.binance.err) && /Request blocked/.test(h3.binance.err) && !/</.test(h3.binance.err), h3.binance.err);
bnBlocked = false; kv.delete('liveKeyCheck');
const h4 = await (await callK('GET', '/live/holdings')).json();
chk('ด่านหน้าเลิกบล็อก → กลับมาดึงยอดได้ · error ที่มี code ยังแปลเหมือนเดิม', h4.binance.ok && /^Funding: Binance HTTP 401 -1002 no$/.test(h4.binance.warn[0]), JSON.stringify(h4.binance.warn));
// v79 รอบ 4 — api.binance.com โดน CloudFront บล็อก (IP ของ Worker) → ลองโดเมนอื่นแล้วจำไว้
bnBlockHosts = ['api.binance.com'];
const h7 = await (await callK('GET', '/live/holdings')).json();
chk('โดเมนที่จำไว้เพิ่งโดนบล็อก → รอบนี้ error · ลืมโดเมนนั้น', !h7.binance.ok && /HTTP 403/.test(h7.binance.err) && !kv.has('liveBinHost'), h7.binance.err);
const h8 = await (await callK('GET', '/live/holdings')).json();
chk('รอบถัดไปลอง ping ทีละโดเมน → ใช้ api-gcp ได้ยอดครบ · จำไว้ใน KV', h8.binance.ok && h8.binance.host === 'api-gcp.binance.com' && h8.binance.rows.length === 3
  && JSON.parse(kv.get('liveBinHost')).host === 'https://api-gcp.binance.com' && bnHits.includes('api-gcp.binance.com/api/v3/account'), JSON.stringify(h8.binance));
let pings = bnHits.filter(h => h.endsWith('/api/v3/ping')).length;
await callK('GET', '/live/holdings');
chk('โดเมนที่จำไว้ยังใช้ได้ → ไม่ ping ซ้ำทุกครั้ง', bnHits.filter(h => h.endsWith('/api/v3/ping')).length === pings);
const c3 = await (await callK('POST', '/live/costs', { since: Date.now() + 5 })).json();
chk('ประวัติเทรดก็ใช้โดเมนเดียวกัน', !c3.err && bnHits.includes('api-gcp.binance.com/api/v3/myTrades'), JSON.stringify(c3));
bnBlocked = true;
await callK('GET', '/live/holdings');                               // api-gcp ที่จำไว้โดนบล็อก → ลืม
const h9 = await (await callK('GET', '/live/holdings')).json();     // ลองครบ 6 โดเมน
chk('บล็อกทุกโดเมน → บอกว่าไม่ใช่ปัญหา key + ผลของทุกโดเมน', !h9.binance.ok && /ทุกโดเมน/.test(h9.binance.err) && /ไม่ใช่ปัญหา key/.test(h9.binance.err)
  && /api\.binance\.com 403/.test(h9.binance.err) && /api-gcp\.binance\.com 403/.test(h9.binance.err) && /api4\.binance\.com 403/.test(h9.binance.err), h9.binance.err);
const before9 = bnHits.length;
const c4 = await (await callK('POST', '/live/costs', { since: Date.now() + 9 })).json();
chk('บล็อกทุกโดเมน → /live/costs หยุดพร้อมเหตุผล ไม่ยิงประวัติเทรด', /ทุกโดเมน/.test(c4.err) && c4.fetched === 0
  && bnHits.slice(before9).every(h => h.endsWith('/api/v3/ping')), JSON.stringify(c4));
bnBlocked = false; bnBlockHosts = [];
const h10 = await (await callK('GET', '/live/holdings')).json();
chk('เลิกบล็อก → กลับมาใช้ api.binance.com', h10.binance.ok && h10.binance.host === 'api.binance.com', JSON.stringify(h10.binance));
rpcDown = ['publicnode.com']; rpcHits.length = 0;
const h5 = await (await callK('GET', '/live/holdings')).json();
chk('RPC ตัวหลักตอบ 429 → ใช้ตัวสำรอง ยอด MetaMask ยังมา', h5.evm.errs.length === 0 && h5.evm.rows.find(r => r.asset === 'ETH').amount === 1
  && rpcHits[0] === 'ethereum-rpc.publicnode.com' && rpcHits[1] === 'eth.drpc.org', JSON.stringify({ errs: h5.evm.errs, rpcHits }));
rpcDown = ['publicnode.com', 'drpc.org', '1rpc.io', 'llamarpc.com'];
const h6 = await (await callK('GET', '/live/holdings')).json();
chk('RPC ล้มทุกตัว → error เดียวบอกผลทุกตัว · ไม่ล้มทั้งหน้า', h6.evm.rows.length === 0 && h6.evm.errs.length === 1
  && /publicnode\.com HTTP 429/.test(h6.evm.errs[0]) && /eth\.drpc\.org HTTP 429/.test(h6.evm.errs[0]) && /eth\.llamarpc\.com HTTP 429/.test(h6.evm.errs[0]), h6.evm.errs[0]);
rpcDown = [];
chk('ไม่มี endpoint ส่งคำสั่ง/ถอน ในไฟล์ Worker', !/\/order\b|\/withdraw|\/capital\/withdraw|placeOrder/i.test(src));

console.log(FAIL ? `\n✗ ไม่ผ่าน ${FAIL} ข้อ` : '\n✓ ผ่านทั้งหมด');
process.exit(FAIL ? 1 : 0);
