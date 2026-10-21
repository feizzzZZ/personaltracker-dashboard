/* v74 — vault.js: ล็อกด้วยรหัสผ่าน + เข้ารหัสข้อมูลในเครื่อง
   รัน:  node scripts/test_vault.cjs vault.js                                  */
const fs = require('fs');
let FAIL = 0;
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { FAIL++; console.log('  ✗ ' + n + '  ' + d); } };

class Mem {
  constructor(){ this.m = new Map(); }
  get length(){ return this.m.size; }
  key(i){ return [...this.m.keys()][i] ?? null; }
  getItem(k){ return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v){ this.m.set(k, String(v)); }
  removeItem(k){ this.m.delete(k); }
}
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.atob = s => Buffer.from(s, 'base64').toString('binary');
new Function(fs.readFileSync(process.argv[2] || 'vault.js', 'utf8'))();
const V = globalThis.Vault;
const ITER = 1000;   // เทสต์ใช้รอบน้อย — ของจริง 600k

(async () => {
  const local = new Mem(), sess = new Mem();
  V._setStorage(local, sess);

  console.log('\n═══ สร้างบัญชี ═══');
  chk('ยังไม่มีบัญชี', !V.exists());
  chk('รหัสสั้นเกิน → validate บอก password', V.validate('fei', '1234567') === 'password');
  chk('ชื่อว่าง → validate บอก username', V.validate(' ', 'longenough') === 'username');
  let threw = false; try{ await V.create('fei', 'short', ITER); }catch(e){ threw = true; }
  chk('สร้างด้วยรหัสสั้นไม่ได้', threw && !V.exists());
  await V.create('  Fei ', 'correct horse', ITER);
  chk('สร้างแล้ว + ปลดล็อกอยู่', V.exists() && V.isUnlocked());
  chk('ตัดช่องว่างชื่อผู้ใช้', V.user() === 'Fei');
  const stored = local.getItem('finOS_vault');
  chk('ไม่เก็บรหัสผ่านเป็นข้อความ', !stored.includes('correct horse'));

  console.log('\n═══ เข้ารหัสข้อมูล ═══');
  const big = JSON.stringify({txRows: Array.from({length: 20000}, (_, i) => ({i, amt: i * 1.5, note: 'ค่าอาหาร ' + i}))});
  await V.setItem('dataCache', big);
  const raw = local.getItem('finOS_enc:dataCache');
  chk('เก็บแบบเข้ารหัส (ไม่มีข้อความเดิม)', raw && !raw.includes('ค่าอาหาร') && !raw.includes('txRows'));
  chk('ข้อมูลใหญ่ (~1 MB) ถอดกลับได้ครบ', (await V.getItem('dataCache')) === big, big.length + ' bytes');
  chk('คีย์ที่ไม่มี → null', (await V.getItem('nope')) === null);
  const raw2 = (await V.setItem('dataCache', big), local.getItem('finOS_enc:dataCache'));
  chk('IV สุ่มใหม่ทุกครั้ง', JSON.parse(raw).iv !== JSON.parse(raw2).iv);

  console.log('\n═══ ล็อก / ปลดล็อก ═══');
  V.lock();
  chk('ล็อกแล้ว', !V.isUnlocked());
  threw = false; try{ await V.getItem('dataCache'); }catch(e){ threw = true; }
  chk('ล็อกอยู่อ่านไม่ได้', threw);
  chk('ล็อกแล้ว resume ไม่ได้ (ล้าง session)', !(await V.resume()));
  let r = await V.unlock('fei', 'wrong password', 1e12);
  chk('รหัสผิด → ไม่ผ่าน', !r.ok && r.reason === 'password');
  r = await V.unlock('someone', 'correct horse', 1e12);
  chk('ชื่อผิดแต่รหัสถูก → ไม่ผ่าน', !r.ok && !V.isUnlocked());
  r = await V.unlock('FEI', 'correct horse', 1e12);
  chk('ชื่อไม่สนตัวพิมพ์ + รหัสถูก → ผ่าน', r.ok && V.isUnlocked());
  chk('ใส่ถูกแล้วรีเซ็ตตัวนับ', V.attempts().n === 0 || V.attempts().n === undefined);
  chk('ถอดข้อมูลเดิมได้หลังปลดล็อก', (await V.getItem('dataCache')) === big);

  console.log('\n═══ รีโหลดหน้า (session) ═══');
  // จำลองรีโหลด: กุญแจในหน่วยความจำหาย แต่ sessionStorage ยังอยู่
  V._setStorage(local, sess);
  chk('หลังรีโหลดยังล็อก', !V.isUnlocked());
  chk('resume จาก sessionStorage ได้', await V.resume());
  chk('ถอดได้หลัง resume', (await V.getItem('dataCache')) === big);
  // ปิดแท็บ = sessionStorage ใหม่
  V._setStorage(local, new Mem());
  chk('ปิดแท็บแล้ว resume ไม่ได้', !(await V.resume()));
  sess.setItem('finOS_vaultSession', btoa('x'.repeat(32)));
  V._setStorage(local, sess);
  chk('กุญแจปลอมใน session → ไม่ผ่าน', !(await V.resume()) && sess.getItem('finOS_vaultSession') === null);

  console.log('\n═══ หน่วงเวลาหลังใส่ผิด ═══');
  const t0 = 2e12;
  for(let i = 0; i < 4; i++) await V.unlock('fei', 'bad' + i, t0);
  chk('ผิด 4 ครั้งยังไม่ต้องรอ', V.waitMs(t0) === 0);
  r = await V.unlock('fei', 'bad5', t0);
  chk('ผิดครั้งที่ 5 → รอ 30 วิ', r.waitMs === 30000, String(r.waitMs));
  r = await V.unlock('fei', 'correct horse', t0 + 1000);
  chk('ระหว่างรอ แม้รหัสถูกก็ยังไม่ให้เข้า', !r.ok && r.reason === 'wait');
  r = await V.unlock('fei', 'bad6', t0 + 31000);
  chk('ผิดอีก → รอนานขึ้นเท่าตัว (60 วิ)', r.waitMs === 60000, String(r.waitMs));
  r = await V.unlock('fei', 'correct horse', t0 + 92000);
  chk('พ้นเวลารอ + รหัสถูก → ผ่าน และรีเซ็ต', r.ok && V.waitMs(t0 + 92000) === 0);

  console.log('\n═══ เปลี่ยนรหัสผ่าน ═══');
  await V.setItem('token', JSON.stringify({t: 'ya29.abc', exp: 123}));
  threw = false; try{ await V.changePassword('not it', 'new password 1'); }catch(e){ threw = true; }
  chk('รหัสเดิมผิด → เปลี่ยนไม่ได้', threw);
  await V.unlock('fei', 'correct horse');
  await V.changePassword('correct horse', 'new password 1');
  chk('ข้อมูลยังถอดได้หลังเปลี่ยนรหัส', (await V.getItem('dataCache')) === big && JSON.parse(await V.getItem('token')).t === 'ya29.abc');
  V.lock();
  chk('รหัสเก่าใช้ไม่ได้แล้ว', !(await V.unlock('fei', 'correct horse')).ok);
  chk('รหัสใหม่ใช้ได้', (await V.unlock('fei', 'new password 1')).ok);

  console.log('\n═══ ลบบัญชี ═══');
  V.destroy();
  chk('ลบบัญชี + ข้อมูลเข้ารหัสหมด', !V.exists() && !V.isUnlocked() &&
      local.getItem('finOS_enc:dataCache') === null && local.getItem('finOS_enc:token') === null);

  console.log(FAIL ? `\n✗ ไม่ผ่าน ${FAIL} ข้อ` : '\n✓ ผ่านทั้งหมด');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
