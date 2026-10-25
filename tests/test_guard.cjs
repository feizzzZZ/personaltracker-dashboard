/* v72 — sheetRowMatches: ห้ามแก้/ลบแถวที่ไม่ใช่รายการเดิม
   รัน:  node tests/test_guard.cjs shared.js                                 */
const fs = require('fs');
let FAIL = 0;
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { FAIL++; console.log('  ✗ ' + n + '  ' + d); } };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.window = {}; global.document = { getElementById: () => null, querySelector: () => null };
const src = fs.readFileSync(process.argv[2] || 'js/shared.js', 'utf8');
const { sheetRowMatches } = new Function(src + '; return {sheetRowMatches};')();

// Transaction: A=Date(serial) B=Transactions C=Type D=Details
const spec = [{col:0, expect:'2025-01-01', kind:'date'}, {col:1, expect:'Expense'}, {col:2, expect:'Other', blank:'Other'}];
chk('แถวเดิม (serial date · หมวดว่าง = Other)', sheetRowMatches([45658, 'Expense', '', 'x'], spec).ok);
chk('ช่องว่างหัวท้ายไม่นับ', sheetRowMatches([45658, ' Expense ', ' Other '], spec).ok);
chk('วันที่เลื่อน → ไม่ตรง', !sheetRowMatches([45659, 'Expense', ''], spec).ok);
chk('ประเภทเปลี่ยน → ไม่ตรง', !sheetRowMatches([45658, 'Income', ''], spec).ok);
chk('แถวว่าง → ไม่ตรง', !sheetRowMatches([], spec).ok);
chk('วันที่เป็นข้อความ ISO ก็ได้', sheetRowMatches(['2025-01-01', 'Expense', 'Other'], spec).ok);
const r = sheetRowMatches([45659, 'Income', 'Food'], spec);
chk('บอกช่องที่ต่าง', r.diff.length === 3 && r.diff[0].got === '2025-01-02', JSON.stringify(r.diff));
chk('คอลัมน์ไม่รู้จัก (-1) ข้าม', sheetRowMatches([45658], [{col:-1, expect:'x'}, {col:0, expect:'2025-01-01', kind:'date'}]).ok);
chk('upper เทียบไม่สนตัวพิมพ์', sheetRowMatches(['btc'], [{col:0, expect:'BTC', kind:'upper'}]).ok);
console.log(FAIL ? `\n✗ ไม่ผ่าน ${FAIL} ข้อ` : '\n✓ ผ่านทั้งหมด');
process.exit(FAIL ? 1 : 0);
