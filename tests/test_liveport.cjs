/* v78 — พอร์ตสด: liveport.js (ไม่มี network)
   รัน:  node tests/test_liveport.cjs liveport.js                                  */
const fs = require('fs');
let FAIL = 0;
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { FAIL++; console.log('  ✗ ' + n + '  ' + d); } };
const near = (a, b, e = 1e-9) => a != null && b != null && Math.abs(a - b) <= e * Math.max(1, Math.abs(b));
new Function(fs.readFileSync(process.argv[2] || 'js/liveport.js', 'utf8'))();
const L = globalThis.LivePort;

console.log('\n═══ ตั้งค่ากระเป๋า ═══');
const A = '0x' + 'ab'.repeat(20), B = '0x' + '12'.repeat(20);
chk('ค่าว่างผ่าน', L.validateConfig({ wallets: [], tokens: [] }) === null);
chk('ที่อยู่สั้นเกิน → ผิด', /0x/.test(L.validateConfig({ wallets: [{ address: '0x1234', chains: ['eth'] }] })));
chk('ไม่เลือกเครือข่าย → ผิด', /เครือข่าย/.test(L.validateConfig({ wallets: [{ address: A, chains: [] }] })));
chk('เครือข่ายไม่รู้จัก → ผิด', !!L.validateConfig({ wallets: [{ address: A, chains: ['solana'] }] }));
chk('เหรียญซ้ำ (ตัวพิมพ์ต่างกัน) → ผิด', /ซ้ำ/.test(L.validateConfig({ wallets: [], tokens: [
  { chain: 'eth', address: B, symbol: 'X', decimals: 6 }, { chain: 'eth', address: B.toUpperCase().replace('0X', '0x'), symbol: 'X', decimals: 6 }] })));
chk('เหรียญเดียวกันคนละเครือข่ายได้', L.validateConfig({ wallets: [], tokens: [
  { chain: 'eth', address: B, symbol: 'X', decimals: 6 }, { chain: 'bsc', address: B, symbol: 'X', decimals: 18 }] }) === null);
chk('กระเป๋าเกินจำนวน → ผิด', !!L.validateConfig({ wallets: Array(6).fill({ address: A, chains: ['eth'] }) }));
chk('ข้อความ error มีภาษาอังกฤษครบ', ['ที่อยู่กระเป๋าต้องเป็น 0x ตามด้วย 40 ตัวอักษร', 'เพิ่มเหรียญซ้ำ'].every(k => L.CFG_ERR_EN[k]));

console.log('\n═══ EVM ═══');
chk('1 ETH (18 ทศนิยม)', L.hexToAmount('0xde0b6b3a7640000', 18) === 1);
chk('USDT 6 ทศนิยม 1,234.567891', near(L.hexToAmount('0x' + (1234567891n).toString(16), 6), 1234.567891));
chk('ยอดใหญ่ไม่เพี้ยนจาก BigInt', near(L.hexToAmount('0x' + (123456789n * 10n ** 18n + 5n * 10n ** 17n).toString(16), 18), 123456789.5));
chk('0x (ไม่มีข้อมูล) = 0', L.hexToAmount('0x', 18) === 0);
chk('ผิดรูปแบบ → null', L.hexToAmount('abc', 18) === null);
const abiStr = '0x' + '20'.padStart(64, '0') + '4'.padStart(64, '0') + Buffer.from('USDT').toString('hex').padEnd(64, '0');
chk('decode symbol แบบ ABI string', L.decodeAbiString(abiStr) === 'USDT');
chk('decode symbol แบบ bytes32 (เหรียญเก่า เช่น MKR)', L.decodeAbiString('0x' + Buffer.from('MKR').toString('hex').padEnd(64, '0')) === 'MKR');
chk('balanceOf data ถูกต้อง', L.balanceOfData(A) === '0x70a08231' + '0'.repeat(24) + 'ab'.repeat(20));

const cfg = { wallets: [{ address: A, label: 'หลัก', chains: ['eth', 'bsc'] }],
  tokens: [{ chain: 'eth', address: B, symbol: 'usdc', decimals: 6 }, { chain: 'eth', address: '0x' + '34'.repeat(20), symbol: '', decimals: null }] };
const reqs = L.evmRequests(cfg);
chk('สร้างคำขอ 2 เครือข่าย', Object.keys(reqs).sort().join() === 'bsc,eth');
chk('eth: เหรียญหลัก + USDC (ข้ามเหรียญที่ยังไม่รู้ decimals)', reqs.eth.body.length === 2 && reqs.eth.meta[1].asset === 'USDC');
chk('bsc: เหรียญหลักคือ BNB', reqs.bsc.meta[0].asset === 'BNB');
const p = L.evmParse('eth', reqs.eth, [{ id: 2, result: '0x' + (2500000n).toString(16) }, { id: 1, result: '0x0' }]);
chk('ยอด 0 ไม่แสดง · USDC 2.5', p.rows.length === 1 && p.rows[0].asset === 'USDC' && p.rows[0].amount === 2.5 && p.rows[0].src === 'metamask');
const pe = L.evmParse('eth', reqs.eth, [{ id: 1, error: { message: 'rate limited' } }]);
chk('error รายตัวเก็บแยก ไม่ทำทั้งชุดพัง', pe.rows.length === 0 && pe.errs.length === 2 && /rate limited/.test(pe.errs[0]));

console.log('\n═══ Binance ยอดคงเหลือ ═══');
const rows = L.binanceRows(
  { balances: [{ asset: 'BTC', free: '0.5', locked: '0.1' }, { asset: 'USDT', free: '100', locked: '0' }, { asset: 'XRP', free: '0', locked: '0' }] },
  [{ asset: 'USDT', free: '50', locked: '0', freeze: '0', withdrawing: '0' }],
  { rows: [{ asset: 'BTC', totalAmount: '0.2' }] }, { rows: [{ asset: 'ETH', amount: '1' }] });
chk('รวม free+locked · ข้ามยอด 0', rows.find(r => r.asset === 'BTC' && r.wallet === 'spot').amount === 0.6 && !rows.some(r => r.asset === 'XRP'));
chk('Funding/Earn เข้าครบ', rows.some(r => r.wallet === 'funding') && rows.some(r => r.wallet === 'earn') && rows.some(r => r.wallet === 'earn-locked'));
chk('endpoint ที่ล้ม (null) ไม่ทำพัง', L.binanceRows({ balances: [{ asset: 'BTC', free: '1', locked: '0' }] }, null, null, null).length === 1);
const merged = L.mergeHoldings([...rows, { src: 'metamask', asset: 'ETH', amount: 0.5, chain: 'arb' }]);
const btc = merged.find(h => h.asset === 'BTC'), eth = merged.find(h => h.asset === 'ETH');
chk('รวม BTC ข้าม spot + earn = 0.8', near(btc.qty, 0.8) && btc.parts.length === 2);
chk('รวม ETH ข้าม Binance + MetaMask = 1.5', near(eth.qty, 1.5) && eth.parts.some(x => x.src === 'metamask'));
chk('คู่เทรด: ไม่รวม stablecoin · ×3 quote', L.tradePairsFor(['BTC', 'USDT', 'btc']).map(x => x.pair).join() === 'BTCUSDT,BTCFDUSD,BTCUSDC');

console.log('\n═══ ต้นทุนจากประวัติเทรด ═══');
// [time, isBuyer, qty, quoteQty, commission, commissionAsset, id]
const c1 = L.costFromTrades({
  BTCUSDT: { base: 'BTC', quote: 'USDT', rows: [[1, 1, 1, 30000, 0.001, 'BTC', 1], [3, 0, 0.5, 25000, 25, 'USDT', 3]] },
  BTCFDUSD: { base: 'BTC', quote: 'FDUSD', rows: [[2, 1, 1, 50000, 50, 'FDUSD', 2]] } }).BTC;
// t1 ซื้อ 1 ได้ 0.999 ต้นทุน 30000 · t2 ซื้อ 1 ต้นทุน 50050 → 1.999 หน่วย 80050 · t3 ขาย 0.5 ที่ WACC
const w = 80050 / 1.999;
chk('ค่าธรรมเนียมเป็นเหรียญ → ได้เหรียญน้อยลง · เป็น stablecoin → บวกต้นทุน', near(c1.qty, 1.499) && near(c1.wacc, w), JSON.stringify(c1));
chk('ขายข้ามคู่ หักตาม WACC รวม (เรียงตามเวลา ไม่ใช่ตามคู่)', near(c1.costUSD, 1.499 * w) && c1.n === 3);
const c2 = L.costFromTrades({ ETHUSDT: { base: 'ETH', quote: 'USDT', rows: [[1, 1, 2, 4000, 0.003, 'BNB', 1], [2, 0, 1, 2500, 0.001, 'BNB', 2]] } }).ETH;
chk('ค่าธรรมเนียมเป็น BNB → ไม่บวกต้นทุน แต่นับแยก', near(c2.wacc, 2000) && near(c2.feeOther.BNB, 0.004) && near(c2.qty, 1));
const c3 = L.costFromTrades({ SOLUSDT: { base: 'SOL', quote: 'USDT', rows: [[1, 1, 1, 100, 0, 'USDT', 1], [2, 0, 1, 150, 0, 'USDT', 2], [3, 1, 2, 300, 0, 'USDT', 3]] } }).SOL;
chk('ขายหมดแล้วซื้อใหม่ → WACC เริ่มใหม่ (150)', near(c3.wacc, 150) && near(c3.qty, 2));
const c4 = L.costFromTrades({ XUSDT: { base: 'X', quote: 'USDT', rows: [[1, 0, 5, 50, 0, 'USDT', 1]] } }).X;
chk('ขายเกินที่มีประวัติซื้อ → ไม่ติดลบ', c4.qty === 0 && c4.costUSD === 0);
chk('คู่ที่ไม่มีบน Binance (none, ไม่มี rows) ไม่พัง', Object.keys(L.costFromTrades({ BTCUSDC: { base: 'BTC', quote: 'USDC', none: true } })).length === 0);
chk('compactTrade', JSON.stringify(L.compactTrade({ id: 9, time: 5, isBuyer: true, qty: '1.5', quoteQty: '30', commission: '0.1', commissionAsset: 'BNB' })) === '[5,1,1.5,30,0.1,"BNB",9]');

console.log('\n═══ มุมมองต่อสินทรัพย์ (2 ฐานต้นทุน) ═══');
const h = { asset: 'BTC', qty: 2, parts: [] };
const v = L.positionView(h, { priceUSD: 60000, open24USD: 50000, fx: 35, sheetWacc: 1400000, sheetQty: 2.1, bin: { qty: 1.5, wacc: 40000, n: 4, feeOther: {} } });
chk('มูลค่า USD/THB', v.valueUSD === 120000 && v.valueTHB === 4200000);
chk('24 ชม. +20% · +$20,000', near(v.chg24, 0.2) && v.d24USD === 20000);
chk('ฐานชีต: ต้นทุน 2.8M กำไร 1.4M (+50%) · ชีตบันทึก 2.1', v.sheet.costTHB === 2800000 && v.sheet.pnlTHB === 1400000 && near(v.sheet.pnlPct, 0.5) && v.sheet.sheetQty === 2.1);
chk('ฐาน Binance: นับเฉพาะ 1.5 ที่มีประวัติ (ครอบคลุม 75%)', v.bin.covered === 1.5 && near(v.bin.coverage, 0.75) && v.bin.pnlUSD === 1.5 * 20000 && near(v.bin.pnlPct, 0.5));
const vNo = L.positionView(h, { priceUSD: null, fx: 35, sheetWacc: 1, bin: null });
chk('ไม่มีราคา → ไม่คิดมูลค่า/P&L (ไม่แสดง 0)', vNo.valueUSD === null && vNo.sheet === null);
const vS = L.positionView({ asset: 'USDT', qty: 100, parts: [] }, { fx: 35, sheetWacc: 33 });
chk('stablecoin: ราคา 1 · ฐาน Binance P&L 0 · ฐานชีตเห็นกำไรค่าเงิน', vS.valueUSD === 100 && vS.bin.pnlUSD === 0 && vS.sheet.pnlTHB === 200);
const vNoHist = L.positionView({ asset: 'ETH', qty: 1, parts: [] }, { priceUSD: 3000, fx: 35, bin: { qty: 0, wacc: 0, n: 2, feeOther: {} } });
chk('มีประวัติแต่ขายหมดแล้ว (ที่ถืออยู่ได้มาทางอื่น) → ครอบคลุม 0% ไม่มี P&L', vNoHist.bin.coverage === 0 && vNoHist.bin.pnlUSD === null);
const vMore = L.positionView({ asset: 'BTC', qty: 1, parts: [] }, { priceUSD: 100, fx: 35, bin: { qty: 3, wacc: 50, n: 1, feeOther: {} } });
chk('ประวัติมากกว่าที่ถือ (ถอนออกไปที่อื่น) → ครอบคลุม 100% ไม่เกิน', vMore.bin.coverage === 1 && vMore.bin.covered === 1);

const T = L.totals([v, vS, vNo, vNoHist], 35);
chk('ยอดรวมไม่นับตัวที่ไม่มีราคา (บอกจำนวนไว้)', T.unpriced === 1 && T.valueUSD === 120000 + 100 + 3000);
chk('P&L ฐานชีตรวมเฉพาะตัวที่มีต้นทุนในชีต', T.sheet.n === 2 && T.sheet.pnlTHB === 1400000 + 200);
chk('P&L ฐาน Binance ไม่นับ stablecoin · ครอบคลุม = ส่วนของมูลค่าที่ไม่ใช่ stablecoin', T.bin.n === 1 && T.bin.pnlUSD === 30000 && near(T.bin.coverage, (1.5 * 60000) / 123000));
const Ts = L.totals([vS], 35);
chk('มีแต่ stablecoin → ฐาน Binance ว่าง (ไม่โชว์ +$0)', Ts.bin.n === 0 && Ts.bin.coverage === null && Ts.bin.pnlPct === null);
chk('24 ชม. รวม', near(T.chg24, 20000 / (123100 - 20000)));

console.log(FAIL ? `\n✗ ${FAIL} ข้อไม่ผ่าน` : '\n✓ ผ่านทั้งหมด');
process.exit(FAIL ? 1 : 0);
