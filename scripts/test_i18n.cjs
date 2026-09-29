/* ทดสอบ i18n.js — ตัวแปลไทย → อังกฤษ (v65)
 *
 *   node scripts/test_i18n.cjs i18n.js
 *
 * คุมจุดที่พังง่าย:
 *   1. ฿ (U+0E3F) อยู่ในช่วงอักษรไทย — ถ้าตัวตรวจ "ยังมีไทยค้าง" นับ ฿ ด้วย ป้ายที่มีเงินจะไม่ถูกแปลเลย
 *   2. กฎ regex ที่ส่วนแทรกเป็นไทย ต้องไม่ออกมาครึ่งไทยครึ่งอังกฤษ และต้องลองกฎถัดไปต่อ
 *   3. ข้อความที่ไม่รู้จัก → null (คงภาษาไทยไว้ ไม่เดา)
 *   4. คีย์ใน DICT ต้องไม่มีช่องว่างซ้ำ/หัวท้าย (ไม่งั้นไม่มีวันตรงกับข้อความที่ normalize แล้ว)
 */
const fs = require('fs');
global.window = {};
global.localStorage = { getItem: () => null, setItem() {} };
global.document = { readyState: 'complete', documentElement: { setAttribute() {}, lang: '' },
                    body: {}, querySelectorAll: () => [], addEventListener() {} };
global.MutationObserver = class { observe() {} };
global.NodeFilter = {};
eval(fs.readFileSync(process.argv[2] || 'i18n.js', 'utf8'));
const { translate, DICT, t } = window.I18N;

let fail = 0;
const chk = (name, cond, detail) => { console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`); if (!cond) fail++; };
const eq = (th, en) => { const got = translate(th); chk(`${th} → ${en}`, got === en, got === en ? '' : `ได้ ${JSON.stringify(got)}`); };

console.log('\n═══ DICT ═══');
eq('ภาพรวม', 'Overview');
eq('  บัญชี  &  หนี้ ', 'Accounts & Debt');            // ช่องว่างซ้ำ/หัวท้ายถูก normalize
eq('ต่ำกว่า target', 'Below target');

console.log('\n═══ RULES + ฿ ═══');
eq('ใช้ไป ฿5,500', 'Spent ฿5,500');
eq('ออม ฿0', 'Saved ฿0');
eq('⚡ ต้องลงมือ · 4 เรื่อง', '⚡ Action needed · 4');
eq('งบเกิน 2 หมวด · รวมเกิน ฿802', '2 budget categories over · ฿802 total');
eq('เหลือ ฿27,900 · รวมรูดบัตร ฿2,500', '฿27,900 left · incl. card ฿2,500');   // กฎแรกที่ตรงให้ผลครึ่งไทย → ต้องลองกฎถัดไป
eq('กสิกรไทย · ถืออยู่แล้ว', 'Kasikornbank · already held');                  // replacer แปลชื่อซ้อน
eq('−฿164,000', null);                                                         // ไม่มีอักษรไทย → ไม่แตะ

console.log('\n═══ ไม่แปลครึ่ง ๆ กลาง ๆ ═══');
eq('เหลือ ร้านค้าเจ้าประจำ', null);
eq('ข้อความที่ไม่มีในพจนานุกรม', null);
chk('t() ภาษาไทยคืนต้นฉบับ', t('ภาพรวม') === 'ภาพรวม');

console.log('\n═══ คุณภาพพจนานุกรม ═══');
const bad = Object.keys(DICT).filter(k => k !== k.replace(/\s+/g, ' ').trim());
chk('คีย์ทุกตัว normalize แล้ว', bad.length === 0, bad.join(' | '));
const empty = Object.entries(DICT).filter(([, v]) => !v || /[ก-ฺเ-๛]/.test(v)).map(([k]) => k);
chk('คำแปลไม่ว่างและไม่มีอักษรไทย', empty.length === 0, empty.join(' | '));

console.log(fail ? `\n❌ ไม่ผ่าน ${fail} ข้อ` : '\n✅ ผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
