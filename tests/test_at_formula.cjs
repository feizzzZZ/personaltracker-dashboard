/* v83 — คอลัมน์สูตรใน Asset_Tracker: สูตรรายแถว (คัดลอก) vs สูตรกระจายทั้งคอลัมน์ (ห้ามเขียนทับ)
   รัน:  node tests/test_at_formula.cjs js/shared.js                            */
const fs = require('fs');
let FAIL = 0;
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { FAIL++; console.log('  ✗ ' + n + '  ' + d); } };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.window = {}; global.document = { getElementById: () => null, querySelector: () => null };
const { atFormulaKinds } = new Function(fs.readFileSync(process.argv[2] || 'js/shared.js', 'utf8') + '; return {atFormulaKinds};')();

console.log('\n═══ ชีตผู้ใช้จริง: E (Name) + F (Industry) เป็น ARRAYFORMULA ที่แถว 2 · M เป็นสูตรรายแถว ═══');
// คอลัมน์ A..M — แถว 2 (FORMULA): E/F มีสูตร · แถวอ้างอิง 300: E/F เป็นค่าที่สูตรกระจายลงมา · M = สูตรรายแถว
const row2 = ['45292', 'Buy', 'KBANK', 'Thai_Stock',
  '=ARRAYFORMULA(IF(C2:C="", "", XLOOKUP(C2:C, Asset_Live_Price_Feed!A:A, Asset_Live_Price_Feed!B:B, "Not Found")))',
  '=ARRAYFORMULA(IF(C2:C="", "", XLOOKUP(C2:C, Asset_Live_Price_Feed!A:A, Asset_Live_Price_Feed!D:D, "Not Found")))',
  'Streaming', 1, 300, 140, 0, '', '=I2*J2*G2'];
const ref = ['46000', 'Buy', 'AAPL', 'US_Stock', 'Apple Inc', 'Information Technology', 'Dime', 34, 0.1, 200, 0, '', '=I300*J300*G300'];
const K = atFormulaKinds(row2, ref);
chk('E (Name) = กระจายทั้งคอลัมน์', K[4] && K[4].spill, JSON.stringify(K[4]));
chk('F (Industry) = กระจายทั้งคอลัมน์ → ห้ามเขียน', K[5] && K[5].spill);
chk('M = สูตรรายแถว → คัดลอกจากแถวอ้างอิง', K[12] === '=I300*J300*G300');
chk('คอลัมน์ที่เป็นค่า ไม่ถูกนับเป็นสูตร', Object.keys(K).map(Number).sort((a, b) => a - b).join() === '4,5,12', Object.keys(K).join());

console.log('\n═══ รูปแบบสูตรอื่น ═══');
chk('สูตรกระจายที่ขึ้นด้วย FILTER / QUERY / SORT / MAP', ['=FILTER(A2:A, B2:B="Buy")', '=QUERY(A1:C, "select A")', '=sort(A2:A)', '=MAP(C2:C, LAMBDA(x, x))']
  .every(f => { const k = atFormulaKinds([f], []); return k[0] && k[0].spill; }));
chk('ช่วงเปิดท้าย (C2:C) โดยไม่มี ARRAYFORMULA = กระจาย', (() => { const k = atFormulaKinds(['=XLOOKUP(C2:C, X!A:A, X!D:D)'], []); return k[0] && k[0].spill; })());
chk('ช่วงปิด (B2:B5) = สูตรรายแถว', atFormulaKinds([], ['=SUM(B2:B5)'])[0] === '=SUM(B2:B5)');
chk('อ้างทั้งคอลัมน์แบบ A:A (ไม่มีเลขแถว) รายแถว = สูตรรายแถว', atFormulaKinds([], ['=XLOOKUP(C300, X!A:A, X!D:D)'])[0] === '=XLOOKUP(C300, X!A:A, X!D:D)');
chk('$C$2:$C ก็นับเป็นช่วงเปิดท้าย', (() => { const k = atFormulaKinds(['=ARRAYFORMULA($C$2:$C*2)'], []); return k[0] && k[0].spill; })());
chk('แถวอ้างอิงคือแถว 2 เอง (มีรายการเดียว) — ARRAYFORMULA ยังเป็น "ห้ามเขียน" ไม่ใช่ "คัดลอก"', (() => { const k = atFormulaKinds([row2[5]], [row2[5]]); return k[0] && k[0].spill; })());
chk('ไม่มีข้อมูล → {}', Object.keys(atFormulaKinds(null, undefined)).length === 0);

console.log(FAIL ? `\n✗ ไม่ผ่าน ${FAIL} ข้อ` : '\n✓ ผ่านทั้งหมด');
process.exit(FAIL ? 1 : 0);
