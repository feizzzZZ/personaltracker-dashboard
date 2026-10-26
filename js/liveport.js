/* ══ v78 — พอร์ตสด (Live portfolio) · ตัวคำนวณล้วน ไม่มี network/DOM ═══════════════════════════════
   ใช้ร่วมกันทั้งแอป (index.html หน้า "พอร์ตสด") และ Cloudflare Worker (cloudflare-worker/autobot/worker.js)
   เหมือน autobot.js — แก้สูตรที่ไฟล์นี้ที่เดียว

   ของที่ถือ: Binance (Spot · Funding · Simple Earn) ผ่าน API key แบบอ่านอย่างเดียวที่อยู่ใน Worker เท่านั้น
              MetaMask = อ่านยอดจาก blockchain ตรง ๆ ด้วยที่อยู่กระเป๋า (ไม่มี key · ไม่มีสิทธิ์โอน)
   ต้นทุน 2 แบบ (ผู้ใช้ขอให้แสดงคู่กันเพื่อเทียบ):
     • ชีต   — running WACC จาก Asset_Tracker (บาท/หน่วย) ชุดเดียวกับหน้าพอร์ต
     • Binance — running WACC จากประวัติ myTrades (USD/หน่วย) เฉพาะคู่ที่ quote เป็น stablecoin
       ซื้อผ่าน Convert / Auto-Invest / ฝากเข้ามาจากที่อื่น ไม่อยู่ใน myTrades → แสดง "ครอบคลุม x%" ตรง ๆ
       ไม่เดาต้นทุนของส่วนที่ไม่มีประวัติ
   ไม่มีอะไรในไฟล์นี้ส่งคำสั่งซื้อขาย */
(function(root){
'use strict';

// ถือว่า = 1 USD (ราคาไม่ต้องดึง)
const STABLES = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD'];
// คู่ที่ไปดึงประวัติเทรดมาคิดต้นทุน — quote ต้องเป็น stablecoin ต้นทุนจึงเป็น USD ได้ตรง ๆ
const QUOTES = ['USDT', 'FDUSD', 'USDC'];

// เครือข่ายที่ MetaMask ใช้บ่อย · RPC สาธารณะ (ไม่ต้องสมัคร · รับ JSON-RPC แบบ batch)
// rpc = ตัวหลัก (publicnode) · rpcs = ลำดับที่ Worker ลองเมื่อตัวก่อนหน้าตอบ 429/5xx หรือผิดรูปแบบ
// (v79 รอบ 3 — ฟรีของ publicnode ถูกแชร์กับ Worker อื่นบน IP ของ Cloudflare จึงโดน 429 บ่อย)
const CHAINS = {
  eth:     { name: 'Ethereum', native: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com',
             rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth', 'https://eth.llamarpc.com'] },
  bsc:     { name: 'BNB Chain', native: 'BNB', rpc: 'https://bsc-rpc.publicnode.com',
             rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc.drpc.org', 'https://1rpc.io/bnb'] },
  arb:     { name: 'Arbitrum', native: 'ETH', rpc: 'https://arbitrum-one-rpc.publicnode.com',
             rpcs: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc', 'https://arbitrum.drpc.org'] },
  base:    { name: 'Base', native: 'ETH', rpc: 'https://base-rpc.publicnode.com',
             rpcs: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org', 'https://base.drpc.org'] },
  op:      { name: 'Optimism', native: 'ETH', rpc: 'https://optimism-rpc.publicnode.com',
             rpcs: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io', 'https://optimism.drpc.org'] },
  polygon: { name: 'Polygon', native: 'POL', rpc: 'https://polygon-bor-rpc.publicnode.com',
             rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org', 'https://1rpc.io/matic'] },
};
const MAX_WALLETS = 5, MAX_TOKENS = 30;

const isStable = a => STABLES.includes(String(a || '').toUpperCase());
// คู่ราคาบน Binance ของสินทรัพย์ (stablecoin ไม่ต้องใช้)
const pricePair = a => isStable(a) ? null : String(a).toUpperCase() + 'USDT';
const isAddr = s => /^0x[0-9a-fA-F]{40}$/.test(String(s || ''));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ── ตั้งค่ากระเป๋า ───────────────────────────────────────────────────────
   {wallets:[{address, label, chains:['eth','bsc',…]}], tokens:[{chain, address, symbol, decimals}]} */
function validateConfig(cfg){
  if(!cfg || typeof cfg !== 'object') return 'รูปแบบไม่ถูกต้อง';
  const w = cfg.wallets || [], t = cfg.tokens || [];
  if(!Array.isArray(w) || !Array.isArray(t)) return 'รูปแบบไม่ถูกต้อง';
  if(w.length > MAX_WALLETS) return `กระเป๋าได้ไม่เกิน ${MAX_WALLETS} อัน`;
  if(t.length > MAX_TOKENS) return `เหรียญได้ไม่เกิน ${MAX_TOKENS} ตัว`;
  for(const x of w){
    if(!isAddr(x.address)) return 'ที่อยู่กระเป๋าต้องเป็น 0x ตามด้วย 40 ตัวอักษร';
    if(!Array.isArray(x.chains) || !x.chains.length) return 'เลือกเครือข่ายอย่างน้อย 1 อัน';
    if(x.chains.some(c => !CHAINS[c])) return 'เครือข่ายไม่รู้จัก';
  }
  const seen = new Set();
  for(const x of t){
    if(!CHAINS[x.chain]) return 'เครือข่ายของเหรียญไม่รู้จัก';
    if(!isAddr(x.address)) return 'ที่อยู่สัญญาเหรียญต้องเป็น 0x ตามด้วย 40 ตัวอักษร';
    const k = x.chain + ':' + x.address.toLowerCase();
    if(seen.has(k)) return 'เพิ่มเหรียญซ้ำ';
    seen.add(k);
    if(x.decimals != null && !(Number.isInteger(x.decimals) && x.decimals >= 0 && x.decimals <= 36)) return 'decimals ไม่ถูกต้อง';
  }
  return null;
}
const CFG_ERR_EN = {
  'รูปแบบไม่ถูกต้อง': 'Invalid format',
  'ที่อยู่กระเป๋าต้องเป็น 0x ตามด้วย 40 ตัวอักษร': 'Wallet address must be 0x followed by 40 hex characters',
  'เลือกเครือข่ายอย่างน้อย 1 อัน': 'Pick at least one network',
  'เครือข่ายไม่รู้จัก': 'Unknown network',
  'เครือข่ายของเหรียญไม่รู้จัก': 'Unknown token network',
  'ที่อยู่สัญญาเหรียญต้องเป็น 0x ตามด้วย 40 ตัวอักษร': 'Token contract must be 0x followed by 40 hex characters',
  'เพิ่มเหรียญซ้ำ': 'Duplicate token',
  'decimals ไม่ถูกต้อง': 'Invalid decimals',
};

/* ── EVM (JSON-RPC) ─────────────────────────────────────────────────── */
// จำนวนเต็ม 256 บิต (hex) → ตัวเลขทศนิยม โดยไม่เสียความแม่นตอนหาร 10^decimals
function hexToAmount(hex, decimals){
  if(typeof hex !== 'string' || !/^0x[0-9a-fA-F]*$/.test(hex)) return null;
  const bi = BigInt(hex === '0x' ? '0x0' : hex), d = 10n ** BigInt(decimals || 0);
  return Number(bi / d) + Number(bi % d) / Number(d);
}
// ผลของ symbol() — ABI string (offset · length · bytes) หรือ bytes32 แบบเหรียญเก่า
function decodeAbiString(hex){
  if(typeof hex !== 'string' || !hex.startsWith('0x')) return '';
  const h = hex.slice(2);
  const bytes = s => { const out = []; for(let i = 0; i + 1 < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16)); return out; };
  const txt = arr => arr.filter(b => b > 0).map(b => String.fromCharCode(b)).join('').replace(/[^\x20-\x7e]/g, '').trim();
  if(h.length >= 192){
    const len = parseInt(h.slice(64, 128), 16);
    if(len > 0 && len <= 64) return txt(bytes(h.slice(128, 128 + len * 2)));
  }
  if(h.length === 64) return txt(bytes(h));
  return '';
}
const balanceOfData = addr => '0x70a08231' + '0'.repeat(24) + addr.slice(2).toLowerCase();
const SEL_DECIMALS = '0x313ce567', SEL_SYMBOL = '0x95d89b41';

// คำขอแบบ batch ต่อเครือข่าย: ยอดเหรียญหลักของทุกกระเป๋า + balanceOf ของทุกเหรียญที่ตั้งไว้
// คืน {chainId: {rpc, rpcs, body:[…], meta:[{asset, address, decimals, token}]}}
function evmRequests(cfg){
  const out = {};
  (cfg.wallets || []).forEach(w => (w.chains || []).forEach(c => {
    const ch = CHAINS[c]; if(!ch) return;
    const o = out[c] || (out[c] = { rpc: ch.rpc, rpcs: ch.rpcs, body: [], meta: [] });
    o.body.push({ jsonrpc: '2.0', id: o.body.length + 1, method: 'eth_getBalance', params: [w.address, 'latest'] });
    o.meta.push({ asset: ch.native, address: w.address, label: w.label || '', decimals: 18, token: null });
    (cfg.tokens || []).filter(t => t.chain === c && t.decimals != null && t.symbol).forEach(t => {
      o.body.push({ jsonrpc: '2.0', id: o.body.length + 1, method: 'eth_call', params: [{ to: t.address, data: balanceOfData(w.address) }, 'latest'] });
      o.meta.push({ asset: String(t.symbol).toUpperCase(), address: w.address, label: w.label || '', decimals: t.decimals, token: t.address });
    });
  }));
  return out;
}
// คำตอบ batch → แถวยอดคงเหลือ (ข้ามยอด 0) · error รายตัวเก็บแยกไว้ ไม่ทำให้ทั้งเครือข่ายหาย
function evmParse(chain, req, resp){
  const rows = [], errs = [];
  const byId = {}; (Array.isArray(resp) ? resp : []).forEach(r => { if(r && r.id != null) byId[r.id] = r; });
  req.meta.forEach((m, i) => {
    const r = byId[i + 1];
    if(!r || r.error || r.result == null){ errs.push(`${CHAINS[chain].name} ${m.asset}: ${r && r.error ? r.error.message || 'error' : 'ไม่มีคำตอบ'}`); return; }
    const amt = hexToAmount(r.result, m.decimals);
    if(amt == null){ errs.push(`${CHAINS[chain].name} ${m.asset}: คำตอบผิดรูปแบบ`); return; }
    if(amt > 0) rows.push({ src: 'metamask', asset: m.asset, amount: amt, chain, address: m.address, label: m.label, token: m.token });
  });
  return { rows, errs };
}

/* ── Binance ─────────────────────────────────────────────────────────── */
// /api/v3/account (spot) · /sapi/v1/asset/get-funding-asset · /sapi/v1/simple-earn/{flexible,locked}/position
function binanceRows(spot, funding, earnFlex, earnLocked){
  const rows = [];
  const add = (asset, amount, wallet) => { const a = num(amount); if(a > 0) rows.push({ src: 'binance', asset: String(asset).toUpperCase(), amount: a, wallet }); };
  ((spot && spot.balances) || []).forEach(b => add(b.asset, num(b.free) + num(b.locked), 'spot'));
  (Array.isArray(funding) ? funding : []).forEach(b => add(b.asset, num(b.free) + num(b.locked) + num(b.freeze) + num(b.withdrawing), 'funding'));
  ((earnFlex && earnFlex.rows) || []).forEach(b => add(b.asset, b.totalAmount, 'earn'));
  ((earnLocked && earnLocked.rows) || []).forEach(b => add(b.asset, b.amount, 'earn-locked'));
  return rows;
}

// คู่ที่ควรไปดึงประวัติเทรด: ทุกสินทรัพย์ที่ถือ (ไม่ใช่ stablecoin) × QUOTES
const tradePairsFor = assets => [...new Set(assets.map(a => String(a).toUpperCase()))]
  .filter(a => !isStable(a)).flatMap(a => QUOTES.map(q => ({ pair: a + q, base: a, quote: q })));

// myTrades → แถวย่อ [time, isBuyer(1/0), qty, quoteQty, commission, commissionAsset, id]
const compactTrade = t => [num(t.time), t.isBuyer ? 1 : 0, num(t.qty), num(t.quoteQty), num(t.commission), String(t.commissionAsset || ''), num(t.id)];

/* running WACC ต่อสินทรัพย์ (USD) จากทุกคู่รวมกัน เรียงตามเวลา — ขายจากคู่หนึ่งต้องหักต้นทุนที่ซื้อจากอีกคู่ได้
   pairs = {BTCUSDT:{base:'BTC', quote:'USDT', rows:[compactTrade…]}}
   ค่าธรรมเนียม: จ่ายเป็นเหรียญที่ได้ → ได้เหรียญน้อยลง · จ่ายเป็น stablecoin ฝั่งซื้อ → บวกต้นทุน ·
   จ่ายเป็นเหรียญอื่น (BNB) → ไม่รู้ราคาตอนนั้น ไม่บวกต้นทุน แต่นับจำนวนแยกไว้ (feeOther) ให้เห็น */
function costFromTrades(pairs){
  const byBase = {};
  Object.values(pairs || {}).forEach(p => {
    if(!p || !p.base || !Array.isArray(p.rows)) return;
    (byBase[p.base] = byBase[p.base] || []).push(...p.rows.map(r => ({ r, quote: p.quote })));
  });
  const out = {};
  Object.entries(byBase).forEach(([base, list]) => {
    list.sort((a, b) => a.r[0] - b.r[0] || a.r[6] - b.r[6]);
    let qty = 0, cost = 0, n = 0, bought = 0;
    const feeOther = {};
    const take = q => {
      const w = qty > 0 ? cost / qty : 0, qq = Math.min(q, qty);
      qty -= qq; cost -= qq * w;
      if(qty < 1e-12){ qty = 0; cost = 0; }
    };
    list.forEach(({ r, quote }) => {
      const [, isBuyer, q, qq, comm, ca] = r;
      n++;
      if(isBuyer){
        let got = q, c = qq;
        if(ca === base) got -= comm; else if(ca === quote) c += comm; else if(comm > 0) feeOther[ca] = (feeOther[ca] || 0) + comm;
        qty += Math.max(0, got); cost += c; bought += Math.max(0, got);
      } else {
        take(q);
        if(ca === base) take(comm);
        else if(ca !== quote && comm > 0) feeOther[ca] = (feeOther[ca] || 0) + comm;
      }
    });
    out[base] = { qty, costUSD: cost, wacc: qty > 0 ? cost / qty : 0, n, bought, feeOther };
  });
  return out;
}

/* ── รวมเป็นรายสินทรัพย์ ─────────────────────────────────────────────── */
function mergeHoldings(rows){
  const m = {};
  (rows || []).forEach(r => {
    if(!r || !(r.amount > 0)) return;
    const a = String(r.asset).toUpperCase();
    const h = m[a] || (m[a] = { asset: a, qty: 0, parts: [] });
    h.qty += r.amount; h.parts.push(r);
  });
  return Object.values(m);
}

/* ต่อสินทรัพย์ 1 ตัว
   q = {priceUSD, open24USD (ราคาเมื่อ 24 ชม.ก่อน), fx (THB ต่อ USD), sheetWacc (บาท/หน่วย), sheetQty, bin: costFromTrades()[asset]} */
function positionView(h, q){
  const p = isStable(h.asset) ? 1 : (q.priceUSD > 0 ? q.priceUSD : null);
  const fx = q.fx > 0 ? q.fx : null;
  const v = { asset: h.asset, qty: h.qty, parts: h.parts, priceUSD: p,
    valueUSD: p != null ? h.qty * p : null, valueTHB: p != null && fx ? h.qty * p * fx : null,
    chg24: null, d24USD: null, sheet: null, bin: null };
  const o = isStable(h.asset) ? 1 : q.open24USD;
  if(p != null && o > 0){ v.chg24 = p / o - 1; v.d24USD = h.qty * (p - o); }
  if(q.sheetWacc > 0 && v.valueTHB != null){
    const cost = q.sheetWacc * h.qty;
    v.sheet = { wacc: q.sheetWacc, costTHB: cost, pnlTHB: v.valueTHB - cost, pnlPct: v.valueTHB / cost - 1,
      sheetQty: q.sheetQty != null ? q.sheetQty : null };
  } else if(q.sheetQty != null) v.sheet = { wacc: 0, costTHB: null, pnlTHB: null, pnlPct: null, sheetQty: q.sheetQty };
  if(isStable(h.asset)){
    // stablecoin: ต้นทุนตาม Binance = 1 USD ต่อหน่วยโดยนิยาม
    v.bin = { wacc: 1, covered: h.qty, coverage: 1, costUSD: h.qty, pnlUSD: 0, pnlPct: 0, n: 0, feeOther: {} };
  } else if(q.bin && q.bin.qty > 0 && q.bin.wacc > 0 && p != null){
    const covered = Math.min(h.qty, q.bin.qty), cost = covered * q.bin.wacc;
    v.bin = { wacc: q.bin.wacc, covered, coverage: h.qty > 0 ? covered / h.qty : 0, costUSD: cost,
      pnlUSD: covered * p - cost, pnlPct: p / q.bin.wacc - 1, n: q.bin.n, feeOther: q.bin.feeOther || {} };
  } else if(q.bin && q.bin.n > 0){
    v.bin = { wacc: 0, covered: 0, coverage: 0, costUSD: 0, pnlUSD: null, pnlPct: null, n: q.bin.n, feeOther: q.bin.feeOther || {} };
  }
  return v;
}

// ยอดรวม — P&L แต่ละฐานต้นทุนนับเฉพาะตัวที่มีต้นทุนฐานนั้น (บอกจำนวนตัวไว้ด้วย ไม่ให้ดูเหมือนครบ)
function totals(views, fx){
  const t = { valueUSD: 0, valueTHB: 0, d24USD: 0, unpriced: 0,
    sheet: { costTHB: 0, pnlTHB: 0, n: 0 }, bin: { costUSD: 0, pnlUSD: 0, n: 0, coveredUSD: 0, baseUSD: 0 } };
  views.forEach(v => {
    if(v.valueUSD == null){ t.unpriced++; return; }
    t.valueUSD += v.valueUSD; if(v.valueTHB != null) t.valueTHB += v.valueTHB;
    if(v.d24USD != null) t.d24USD += v.d24USD;
    if(v.sheet && v.sheet.costTHB != null){ t.sheet.costTHB += v.sheet.costTHB; t.sheet.pnlTHB += v.sheet.pnlTHB; t.sheet.n++; }
    // ฐาน Binance รวมเฉพาะที่ไม่ใช่ stablecoin — stablecoin P&L = 0 เสมอ ถ้านับด้วยจะดูเหมือน "มีต้นทุนแล้ว" ทั้งที่ยังไม่ได้ดึงประวัติ
    if(!isStable(v.asset)) t.bin.baseUSD += v.valueUSD;
    if(v.bin && v.bin.pnlUSD != null && v.bin.covered > 0 && !isStable(v.asset)){
      t.bin.costUSD += v.bin.costUSD; t.bin.pnlUSD += v.bin.pnlUSD; t.bin.n++;
      t.bin.coveredUSD += v.bin.covered * v.priceUSD;
    }
  });
  t.chg24 = t.valueUSD - t.d24USD > 0 ? t.d24USD / (t.valueUSD - t.d24USD) : null;
  t.sheet.pnlPct = t.sheet.costTHB > 0 ? t.sheet.pnlTHB / t.sheet.costTHB : null;
  t.bin.pnlPct = t.bin.costUSD > 0 ? t.bin.pnlUSD / t.bin.costUSD : null;
  t.bin.coverage = t.bin.baseUSD > 0 ? t.bin.coveredUSD / t.bin.baseUSD : null;   // สัดส่วนของมูลค่าที่ไม่ใช่ stablecoin
  t.fx = fx || null;
  return t;
}

root.LivePort = { STABLES, QUOTES, CHAINS, MAX_WALLETS, MAX_TOKENS, CFG_ERR_EN,
  isStable, pricePair, isAddr, validateConfig, hexToAmount, decodeAbiString, balanceOfData, SEL_DECIMALS, SEL_SYMBOL,
  evmRequests, evmParse, binanceRows, tradePairsFor, compactTrade, costFromTrades, mergeHoldings, positionView, totals };
})(typeof window !== 'undefined' ? window : globalThis);
