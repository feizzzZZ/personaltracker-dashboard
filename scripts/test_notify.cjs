/* ทดสอบฟังก์ชันแจ้งเตือนใน shared.js (v67)
 *   node scripts/test_notify.cjs shared.js [ไฟล์ .enc.json ที่ Python เข้ารหัส] [NOTIFY_KEY]
 * ถ้าส่งไฟล์+กุญแจมาด้วย จะทดสอบถอดรหัสข้ามภาษา (Python → WebCrypto) ด้วย
 */
const fs = require('fs');
global.window = {}; global.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };
eval(fs.readFileSync(process.argv[2] || 'shared.js', 'utf8'));
let fail = 0;
const chk = (n, c, d) => { console.log(`  ${c?'✓':'✗'} ${n}${c?'':'  '+(d??'')}`); if(!c) fail++; };
(async () => {
  console.log('\n═══ หมวด / รวม / ยังไม่อ่าน ═══');
  chk('daily/weekly/monthly = พอร์ต', ['daily','weekly','monthly'].every(k => notifCategory(k) === 'portfolio'));
  chk('alert = ราคา', notifCategory('alert') === 'price');
  chk('ไม่รู้จัก = ระบบ', notifCategory('zzz') === 'system' && notifCategory('app') === 'system');
  const R = [{id:'a', ts:'2026-09-29T01:00:00Z', kind:'daily'}, {id:'b', ts:'2026-09-30T01:00:00Z', kind:'alert'}];
  const L = [{id:'a', ts:'2026-09-01T00:00:00Z', kind:'app'}, {id:'c', ts:'2026-09-29T12:00:00Z', kind:'app'}];
  const M = mergeNotifications(R, L);
  chk('กันซ้ำ id (remote ชนะ)', M.length === 3 && M.find(x=>x.id==='a').kind === 'daily');
  chk('เรียงใหม่→เก่า', M.map(x=>x.id).join('') === 'bca');
  chk('ใส่หมวดให้', M[0].cat === 'price');
  chk('นับยังไม่อ่าน', notifUnread(M, ['a']) === 2 && notifUnread(M, new Set()) === 3);
  let r = notifLocalAdd([], 'budget', 'งบเกิน', 'x', 'budget', '2026-09-30T10:00:00');
  const r2 = notifLocalAdd(r.list, 'budget', 'งบเกิน', 'x', 'budget', '2026-09-30T18:00:00');
  const r3 = notifLocalAdd(r2.list, 'budget', 'งบเกิน', 'x', 'budget', '2026-10-01T09:00:00');
  chk('เหตุการณ์เดียวกัน วันเดียวกัน ไม่ซ้ำ', r.added && !r2.added && r2.list.length === 1);
  chk('วันใหม่ขึ้นใหม่', r3.added && r3.list.length === 2);

  console.log('\n═══ ถอดรหัส ═══');
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey('raw', key, {name:'AES-GCM'}, false, ['encrypt']);
  const items = [{id:'x', ts:'2026-09-30T01:00:00Z', kind:'daily', title:'สรุป', body:'พอร์ต ฿1,000'}];
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:new TextEncoder().encode('finos-notify-v1')},
                                         k, new TextEncoder().encode(JSON.stringify(items)));
  const doc = {v:1, iv:bytesToB64(iv), ct:bytesToB64(new Uint8Array(ct))};
  chk('ถอดรหัสได้ (base64)', (await notifyDecrypt(doc, bytesToB64(key)))[0].body === 'พอร์ต ฿1,000');
  chk('ถอดรหัสได้ (base64url)', (await notifyDecrypt(doc, bytesToB64(key, true))).length === 1);
  let threw = false; try{ await notifyDecrypt(doc, bytesToB64(crypto.getRandomValues(new Uint8Array(32)))); }catch(e){ threw = true; }
  chk('กุญแจผิด → throw (ไม่เงียบเป็นรายการว่าง)', threw);
  threw = false; try{ await notifyDecrypt({...doc, ct: doc.ct.slice(0,-4)+'AAAA'}, bytesToB64(key)); }catch(e){ threw = true; }
  chk('ไฟล์ถูกแก้ → throw', threw);
  chk('ไฟล์ว่าง → []', (await notifyDecrypt(null, 'x')).length === 0);

  if(process.argv[3] && process.argv[4]){
    console.log('\n═══ ข้ามภาษา: Python เข้ารหัส → WebCrypto ถอด ═══');
    const py = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const got = await notifyDecrypt(py, process.argv[4]);
    chk('ถอดไฟล์จาก notify_store.py ได้', got.length > 0 && got.every(n => n.id && n.ts && n.title), JSON.stringify(got).slice(0,120));
  }
  console.log(fail ? `\n❌ ไม่ผ่าน ${fail} ข้อ` : '\n✅ ผ่านทั้งหมด');
  process.exit(fail ? 1 : 0);
})();
