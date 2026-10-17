/* ชุดทดสอบคลังเอกสาร (v71)
   รัน:  node scripts/test_docs.cjs shared.js                                   */
const fs = require('fs');
const FILE = process.argv[2] || 'shared.js';

let FAIL = 0;
const chk = (n, c, d = '') => {
  if (c) console.log('  ✓ ' + n);
  else { FAIL++; console.log('  ✗ ' + n + '  ' + d); }
};

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
global.window = {};
global.document = { getElementById: () => null, querySelector: () => null };
const src = fs.readFileSync(FILE, 'utf8');
const api = new Function(src + '; return {parseDocumentRows,docCategoryOf,docSafeUrl,driveFileId,' +
  'docThumbUrl,docEmbedUrl,docDateIso,docSearch,docCategoryList,docRowValues,DOC_HEADER};')();
const { parseDocumentRows, docCategoryOf, docSafeUrl, driveFileId, docThumbUrl, docEmbedUrl,
        docDateIso, docSearch, docCategoryList, docRowValues, DOC_HEADER } = api;

console.log('หมวด');
chk('Tax → tax', docCategoryOf('Tax').id === 'tax');
chk('ภ.ง.ด → tax', docCategoryOf('ภ.ง.ด').id === 'tax');
chk('Salary Slip → salary', docCategoryOf('Salary Slip').id === 'salary');
chk('บัตรเครดิต → card', docCategoryOf('บัตรเครดิต').id === 'card');
chk('Trade Confirmation → trade', docCategoryOf('Trade Confirmation').id === 'trade');
chk('ว่าง → other', docCategoryOf('').id === 'other');
const cu = docCategoryOf('Car loan');
chk('หมวดใหม่ไม่ตกไป other', cu.id === 'x:carloan' && cu.label === 'Car loan', JSON.stringify(cu));

console.log('ลิงก์');
chk('javascript: ถูกตัด', docSafeUrl('javascript:alert(1)') === '');
chk('https ผ่าน', docSafeUrl(' https://x.com/a.pdf ') === 'https://x.com/a.pdf');
const ID = '1AbCdEfGhIjKlMnOpQrStUv';
chk('Drive /file/d/', driveFileId(`https://drive.google.com/file/d/${ID}/view?usp=sharing`) === ID);
chk('Drive open?id=', driveFileId(`https://drive.google.com/open?id=${ID}`) === ID);
chk('ไม่ใช่ Drive → ไม่มี id', driveFileId(`https://evil.com/file/d/${ID}/view`) === '');
chk('thumbnail ของ Drive', docThumbUrl(`https://drive.google.com/file/d/${ID}/view`).includes('thumbnail?id=' + ID));
chk('รูปตรง ๆ ใช้เป็น thumbnail', docThumbUrl('https://x.com/a.jpg') === 'https://x.com/a.jpg');
chk('PDF นอก Drive ไม่มี thumbnail', docThumbUrl('https://x.com/a.pdf') === '');
chk('embed ของ Drive', docEmbedUrl(`https://drive.google.com/file/d/${ID}/view`).endsWith(ID + '/preview'));

console.log('วันที่');
chk('serial 45658 = 2025-01-01', docDateIso(45658) === '2025-01-01', docDateIso(45658));
chk('ISO', docDateIso('2025-03-31') === '2025-03-31');
chk('DD/MM/YYYY พ.ศ.', docDateIso('31/03/2568') === '2025-03-31', docDateIso('31/03/2568'));
chk('ขยะ → ว่าง', docDateIso('hello') === '');

console.log('อ่านชีต');
const rows = [
  ['Category', 'Title', 'Date', 'Issuer', 'Amount', 'Tags', 'File URL', 'Note', 'Year'],
  ['Tax', 'ภ.ง.ด.90 ปี 2567', 45720, 'กรมสรรพากร', '฿12,500', 'ภงด90, คืนภาษี', `https://drive.google.com/file/d/${ID}/view`, 'ยื่นออนไลน์', 2024],
  ['Salary slip', 'สลิป ม.ค. 2025', '2025-01-31', 'ACME', 85000, '', 'https://x.com/s.pdf', '', ''],
  [],
  ['Credit card', 'KBank statement', '2025-02-10', 'KBank', '(1,200)', 'kbank;statement', 'javascript:alert(1)', '', ''],
  ['', '', '', '', '', '', '', '', ''],
];
const { docs, meta } = parseDocumentRows(rows);
chk('3 รายการ (ข้ามแถวว่าง)', docs.length === 3, docs.length);
chk('เรียงวันที่ใหม่สุดก่อน', docs[0].title === 'ภ.ง.ด.90 ปี 2567', docs.map(d => d.title).join('|'));
chk('ปีภาษีจากคอลัมน์ Year', docs[0].year === 2024);
chk('ปีจากวันที่เมื่อไม่มี Year', docs.find(d => d.cat === 'salary').year === 2025);
chk('ยอด ฿12,500', docs[0].amount === 12500);
chk('ยอดวงเล็บติดลบ', docs.find(d => d.cat === 'card').amount === -1200);
chk('แท็กแยกด้วย , และ ;', docs[0].tags.length === 2 && docs.find(d => d.cat === 'card').tags.length === 2);
chk('ลิงก์อันตรายเหลือ url ว่าง', docs.find(d => d.cat === 'card').url === '');
chk('แถวจริงในชีต', docs.find(d => d.cat === 'card').row === 5);
chk('meta.lastRow', meta.lastRow === 5, meta.lastRow);
chk('ชีตไม่มีหัวตาราง → ว่าง', parseDocumentRows([['a', 'b']]).docs.length === 0);
const th = parseDocumentRows([['หมวด', 'ชื่อเอกสาร', 'ลิงก์'], ['ภาษี', 'ลดหย่อน', 'https://x.com/a']]);
chk('หัวตารางภาษาไทย', th.docs.length === 1 && th.docs[0].cat === 'tax');

console.log('ค้นหา');
chk('คำเดียว', docSearch(docs, 'kbank').length === 1);
chk('หลายคำ AND', docSearch(docs, 'ภาษี 2024').length === 1 && docSearch(docs, 'kbank 2024').length === 0);
chk('ค้นด้วยชื่อหมวดภาษาอังกฤษ', docSearch(docs, 'salary').length === 1);
chk('ค้นว่าง = ทั้งหมด', docSearch(docs, '  ').length === 3);

console.log('หมวดที่ใช้ + เขียนกลับ');
const cl = docCategoryList(docs);
chk('นับต่อหมวด', cl.find(c => c.id === 'tax').n === 1 && cl.find(c => c.id === 'trade').n === 0);
const out = docRowValues(meta, { cat: 'Tax', title: 'T', amount: '100', tags: 'a, b,', url: 'https://x.com' });
chk('เขียนตามตำแหน่งคอลัมน์', out[0] === 'Tax' && out[1] === 'T' && out[4] === 100 && out[5] === 'a, b' && out[6] === 'https://x.com');
const meta2 = parseDocumentRows([['Title', 'Note', 'Link']]).meta;
const out2 = docRowValues(meta2, { cat: 'Tax', title: 'T', url: 'https://x.com', note: 'n' });
chk('ชีตเรียงคอลัมน์ต่างไปก็เขียนถูกช่อง', out2.length === 3 && out2[0] === 'T' && out2[1] === 'n' && out2[2] === 'https://x.com');
chk('DOC_HEADER 9 คอลัมน์', DOC_HEADER.length === 9);

console.log(FAIL ? `\n✗ ไม่ผ่าน ${FAIL} ข้อ` : '\n✓ ผ่านทั้งหมด');
process.exit(FAIL ? 1 : 0);
