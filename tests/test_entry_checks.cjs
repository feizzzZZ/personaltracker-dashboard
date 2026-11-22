/* v92 — ตรวจก่อนบันทึก: รายการที่น่าจะซ้ำ (ธุรกรรม · ลงทุน) + ยอดจริงที่เก่าเกินจะใช้
 *
 *   node tests/test_entry_checks.cjs js/shared.js
 *
 * ข้อมูลทั้งหมดเป็นตัวเลขสมมติ (repo เป็น public — ห้ามใส่ข้อมูลจริงจากชีต)
 */
const fs = require('fs');
const store = {};
global.window = {};
global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
eval(fs.readFileSync(process.argv[2] || 'js/shared.js', 'utf8'));

let FAIL = 0;
const chk = (name, cond, detail) => { console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : '  ' + JSON.stringify(detail)}`); if (!cond) FAIL++; };

console.log('\n═══ ธุรกรรมที่น่าจะซ้ำ (findDuplicateTx) ═══');
{
  const rows = [
    { dateStr: '2026-11-20', type: 'Expense', category: 'Food', acct: { 'Bank A': -120 }, sheetRow: 30 },
    { dateStr: '2026-11-20', type: 'Transfer', category: 'Top up', acct: { 'Bank A': -500, 'Wallet C': 500 }, sheetRow: 31 },
    { dateStr: '2026-11-21', type: 'Expense', category: 'Food', acct: { 'Card B': -120 }, sheetRow: 32 },
    { dateStr: '2026-11-21', type: 'Debt', category: 'Clear Debt Card B', acct: { 'Bank A': -3000.5, 'Card B': 3000.5 }, sheetRow: 33 },
  ];
  const d = q => findDuplicateTx(rows, q).map(r => r.sheetRow);
  chk('วัน · ประเภท · บัญชี · ยอดตรง → เจอ', d({ dateStr: '2026-11-20', type: 'Expense', acctName: 'Bank A', amount: -120 }).join() === '30');
  chk('คนละวัน → ไม่เจอ', d({ dateStr: '2026-11-19', type: 'Expense', acctName: 'Bank A', amount: -120 }).length === 0);
  chk('คนละบัญชี → ไม่เจอ', d({ dateStr: '2026-11-20', type: 'Expense', acctName: 'Card B', amount: -120 }).length === 0);
  chk('คนละประเภท → ไม่เจอ', d({ dateStr: '2026-11-20', type: 'Bills', acctName: 'Bank A', amount: -120 }).length === 0);
  chk('ยอดต่างกัน 1 สตางค์ → ไม่เจอ', d({ dateStr: '2026-11-20', type: 'Expense', acctName: 'Bank A', amount: -120.01 }).length === 0);
  chk('เครื่องหมายต่าง (รายรับ 120 vs รายจ่าย 120) → ไม่เจอ', d({ dateStr: '2026-11-20', type: 'Expense', acctName: 'Bank A', amount: 120 }).length === 0);
  chk('โอน: เทียบที่บัญชีต้นทาง', d({ dateStr: '2026-11-20', type: 'Transfer', acctName: 'Bank A', amount: -500 }).join() === '31');
  chk('จ่ายบัตร: ยอดมีทศนิยม', d({ dateStr: '2026-11-21', type: 'Debt', acctName: 'Bank A', amount: -3000.5 }).join() === '33');
  chk('แก้รายการเดิม: ไม่นับแถวตัวเอง (skipRow)', d({ dateStr: '2026-11-20', type: 'Expense', acctName: 'Bank A', amount: -120, skipRow: 30 }).length === 0);
  chk('ข้อมูลไม่ครบ → []', findDuplicateTx(rows, { dateStr: '', type: 'Expense', acctName: 'Bank A', amount: -120 }).length === 0
    && findDuplicateTx(rows, { dateStr: '2026-11-20', type: 'Expense', acctName: 'Bank A', amount: NaN }).length === 0
    && findDuplicateTx(null, { dateStr: '2026-11-20', type: 'Expense', acctName: 'Bank A', amount: -120 }).length === 0);
}

console.log('\n═══ รายการลงทุนที่น่าจะซ้ำ (findDuplicateAt) ═══');
{
  const D = s => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const rows = [
    { date: D('2026-11-03'), ticker: 'AAA', txType: 'Buy', qty: 100, price: 25.5, sheetRow: 10 },
    { date: D('2026-11-03'), ticker: 'BBB', txType: 'Buy', qty: 0.0123, price: 0, sheetRow: 11 },
    { date: D('2026-11-04'), ticker: 'AAA', txType: 'Dividend Payout', qty: 100, price: 0.4, sheetRow: 12 },
  ];
  const d = q => findDuplicateAt(rows, q).map(r => r.sheetRow);
  chk('วัน · ticker · ประเภท · จำนวน · ราคาตรง → เจอ', d({ date: '2026-11-03', ticker: 'aaa', txType: 'Buy', qty: 100, price: 25.5 }).join() === '10');
  chk('ราคาต่าง → ไม่เจอ (ซื้อสองไม้คนละราคา)', d({ date: '2026-11-03', ticker: 'AAA', txType: 'Buy', qty: 100, price: 26 }).length === 0);
  chk('จำนวนต่าง → ไม่เจอ', d({ date: '2026-11-03', ticker: 'AAA', txType: 'Buy', qty: 101, price: 25.5 }).length === 0);
  chk('ประเภทต่าง (Sell) → ไม่เจอ', d({ date: '2026-11-03', ticker: 'AAA', txType: 'Sell', qty: 100, price: 25.5 }).length === 0);
  chk('แถวในชีตไม่มีราคา → เทียบแค่จำนวน', d({ date: '2026-11-03', ticker: 'BBB', txType: 'Buy', qty: 0.0123, price: 99 }).join() === '11');
  chk('ปันผลซ้ำวันเดียวกัน → เจอ', d({ date: '2026-11-04', ticker: 'AAA', txType: 'Dividend Payout', qty: 100, price: 0.4 }).join() === '12');
  chk('แก้รายการเดิม: ไม่นับแถวตัวเอง', d({ date: '2026-11-03', ticker: 'AAA', txType: 'Buy', qty: 100, price: 25.5, skipRow: 10 }).length === 0);
  chk('จำนวน 0 / ไม่มี ticker → []', d({ date: '2026-11-03', ticker: 'AAA', txType: 'Buy', qty: 0 }).length === 0
    && d({ date: '2026-11-03', ticker: '', txType: 'Buy', qty: 100 }).length === 0);
}

console.log('\n═══ ยอดจริงเก่าเกินจะใช้ (reconStaleList) ═══');
{
  const now = Date.parse('2026-11-22T09:00:00Z');
  const bals = [{ name: 'Bank A', balance: 1000 }, { name: 'Card B', balance: -200 }, { name: 'Wallet C', balance: 50 }, { name: 'Bank D', balance: 10 }];
  const recon = {
    'Bank A': { date: '2026-11-01', actual: 990 },     // 21 วัน — ยังใช้
    'Card B': { date: '2026-09-01', actual: -180 },    // 82 วัน — เก่า
    'Wallet C': { date: '2026-10-08', actual: 50 },    // 45 วันพอดี — ยังใช้ (เกิน 45 ถึงจะเลิกใช้)
    'Bank D': { date: '2026-10-07', actual: 10 },      // 46 วัน — เก่า
  };
  const s = reconStaleList(bals, recon, null, now);
  chk('คืนเฉพาะบัญชีที่เกิน 45 วัน เรียงเก่าสุดก่อน', s.map(x => x.name).join() === 'Card B,Bank D', s);
  chk('บอกอายุเป็นวัน', s[0].ageDays === 82 && s[1].ageDays === 46, s);
  chk('ตรงกับ applyReconciliation (บัญชีที่ขึ้น stale)', (() => {
    const real = Date.now; Date.now = () => now;
    try { const rc = applyReconciliation(bals, recon, null, []); return Object.keys(rc.source).filter(k => rc.source[k] === 'stale').sort().join() === 'Bank D,Card B'; }
    finally { Date.now = real; }
  })());
  chk('ไม่มี Reconcile → []', reconStaleList(bals, {}, null, now).length === 0 && reconStaleList(bals, null, null, now).length === 0);
  chk('กำหนดเพดานเองได้', reconStaleList(bals, recon, 10, now).length === 4);
}

console.log(FAIL ? `\n✗ ${FAIL} ข้อไม่ผ่าน` : '\n✓ ผ่านทั้งหมด');
process.exit(FAIL ? 1 : 0);
