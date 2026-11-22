/* v92 — ตรวจว่าไฟล์ที่ต้องแก้คู่กันทุกครั้งที่ออกเวอร์ชันใหม่ ถูกแก้ครบ
 *
 *   node tests/check_build.cjs
 *
 * เดิมต้องจำเองว่าต้อง bump 3 ที่ (APP_BUILD · EXPECTED_SHARED_BUILD · CACHE_NAME) — ลืมที่เดียว:
 *   - CACHE_NAME ไม่เปลี่ยน → PWA ที่ติดตั้งแล้วเสิร์ฟ shared.js เก่าต่อไป
 *   - EXPECTED_SHARED_BUILD ไม่ตรง → console เตือนทุกครั้งที่เปิดแอป
 * และ index.html เรียกฟังก์ชันใน shared.js ตามรายการ REQUIRED_SHARED_FNS — ชื่อที่ไม่มีจริง = หน้าแอปบล็อก
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let FAIL = 0;
const chk = (name, cond, detail) => { console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail == null ? '' : '  ' + detail}`); if (!cond) FAIL++; };

const shared = read('js/shared.js'), html = read('index.html'), sw = read('service-worker.js');
const app = (shared.match(/const APP_BUILD = '(v\d+)'/) || [])[1];
const exp = (html.match(/const EXPECTED_SHARED_BUILD = '(v\d+)'/) || [])[1];
const cache = (sw.match(/const CACHE_NAME = 'finance-os-(v\d+)'/) || [])[1];

console.log('\n═══ เลขเวอร์ชันสามที่ต้องตรงกัน ═══');
chk(`js/shared.js APP_BUILD = ${app}`, !!app, 'หาไม่เจอ');
chk(`index.html EXPECTED_SHARED_BUILD = ${exp}`, exp === app, `ต้องเป็น ${app}`);
chk(`service-worker.js CACHE_NAME = finance-os-${cache}`, cache === app, `ต้องเป็น finance-os-${app}`);
chk(`มีบันทึกเวอร์ชัน docs/releases/release-${app}.md`, fs.existsSync(path.join(ROOT, 'docs/releases', `release-${app}.md`)), 'เขียนบันทึกเวอร์ชันด้วย');

console.log('\n═══ ฟังก์ชันที่ index.html ต้องการจาก shared.js ═══');
{
  const list = (html.match(/const REQUIRED_SHARED_FNS = \[([\s\S]*?)\];/) || [])[1] || '';
  const names = [...list.replace(/\/\/.*$/gm, '').matchAll(/'([A-Za-z_$][\w$]*)'/g)].map(m => m[1]);
  global.window = {};
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const log = console.log; console.log = () => {};
  try { (0, eval)(shared); } finally { console.log = log; }
  const missing = names.filter(n => typeof globalThis[n] !== 'function' && typeof window[n] !== 'function');
  chk(`${names.length} ชื่อใน REQUIRED_SHARED_FNS มีอยู่จริง`, names.length > 0 && !missing.length, missing.join(', '));
}

console.log('\n═══ ไฟล์ที่หน้าเว็บ / service worker อ้างถึง ═══');
{
  const srcs = [...html.matchAll(/<script src="(?!https?:)([^"]+)"/g)].map(m => m[1]);
  const block = (sw.match(/const SHELL_FILES = \[([\s\S]*?)\];/) || [])[1] || '';
  const shell = [...block.matchAll(/BASE \+ '\/([^']+)'/g)].map(m => m[1]);
  const gone = [...new Set(srcs.concat(shell))].filter(f => !fs.existsSync(path.join(ROOT, f)));
  chk(`<script src> ${srcs.length} ไฟล์ + SHELL_FILES ${shell.length} ไฟล์ มีอยู่จริง`, !gone.length, gone.join(', '));
}

console.log(FAIL ? `\n✗ ${FAIL} ข้อไม่ผ่าน` : '\n✓ ผ่านทั้งหมด');
process.exit(FAIL ? 1 : 0);
