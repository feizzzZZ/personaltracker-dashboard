/* v75 — Cloudflare Worker ของบอท: auth · CORS · ตรวจกฎ · run · cron (KV/fetch จำลอง ไม่ใช้ network)
   รัน:  node scripts/test_autobot_worker.mjs                                   */
import fs from 'fs'; import path from 'path'; import os from 'os'; import { pathToFileURL } from 'url';
let FAIL = 0;
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { FAIL++; console.log('  ✗ ' + n + '  ' + d); } };

new Function(fs.readFileSync('autobot.js', 'utf8'))();
const src = fs.readFileSync('cloudflare-worker/autobot/worker.js', 'utf8').replace(/^import '\.\.\/\.\.\/autobot\.js';$/m, '');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'abw-')), 'worker.mjs');
fs.writeFileSync(tmp, src);
const W = (await import(pathToFileURL(tmp).href)).default;

const kv = new Map();
const env = { BOT_TOKEN: 'x'.repeat(32), ALLOWED_ORIGIN: 'https://me.github.io', MARKET_URL: 'https://md/market-data.json', START_THB: '50000',
  BOT: { get: async (k, t) => kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null, put: async (k, v) => { kv.set(k, v); } } };
const MD = { prices: { PTT: { price: 32, ccy: 'THB' }, BTC: { price: 60000, ccy: 'USD' } },
             signals: { PTT: { rsi: 25, drawdown: -10 }, BTC: { rsi: 50, drawdown: -5 } }, data: { USDTHB: { value: 34 } } };
let binanceCalls = 0;
globalThis.fetch = async (url) => {
  url = String(url);
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

console.log(FAIL ? `\n✗ ไม่ผ่าน ${FAIL} ข้อ` : '\n✓ ผ่านทั้งหมด');
process.exit(FAIL ? 1 : 0);
