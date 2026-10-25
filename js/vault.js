/* ══ vault.js — ล็อกแอปด้วยชื่อผู้ใช้/รหัสผ่าน + เข้ารหัสข้อมูลในเครื่อง (v74) ═══════════
   ไม่มี server — "บัญชี" นี้อยู่ในเครื่องนี้เครื่องเดียว หน้าที่คือ:
   • กันคนที่หยิบเครื่อง/เปิดเบราว์เซอร์ต่อจากคุณ ไม่ให้เห็นข้อมูลการเงินที่ cache ไว้
   • ข้อมูลที่ cache (ธุรกรรม · ยอดบัญชี · พอร์ต · token Google) เก็บแบบเข้ารหัส AES-GCM 256
     กุญแจได้จากรหัสผ่านด้วย PBKDF2-SHA256 600,000 รอบ (ค่าแนะนำ OWASP 2023) + salt สุ่มต่อเครื่อง
   • รหัสผ่านไม่ถูกเก็บที่ไหนเลย — เก็บแค่ salt กับ "ข้อความตรวจ" ที่เข้ารหัสไว้
     ถอดได้ = รหัสถูก (AES-GCM ตรวจความถูกต้องในตัว ถอดด้วยกุญแจผิดจะ throw)

   ลืมรหัส = ถอดข้อมูลในเครื่องไม่ได้อีก → ล้างแล้ว sync ใหม่จาก Google Sheets (ข้อมูลจริงอยู่ที่ชีต ไม่หาย)

   ใช้ WebCrypto อย่างเดียว (มีทั้งในเบราว์เซอร์และ Node ≥19) — tests/test_vault.cjs เรียกไฟล์นี้ตรง ๆ */
(function(root){
'use strict';

const VAULT_KEY   = 'finOS_vault';         // {v, user, salt, iter, check:{iv,ct}, created}
const ATTEMPT_KEY = 'finOS_vaultAttempts'; // {n, until} — หน่วงเวลาหลังใส่ผิดติดกัน
const SESSION_KEY = 'finOS_vaultSession';  // sessionStorage: กุญแจดิบ (base64) — อยู่ได้แค่แท็บนี้ ปิดแท็บ = ล็อก
const ITER        = 600000;
const CHECK_TEXT  = 'finOS-vault-ok';
const MIN_PW      = 8;

const subtle = () => (root.crypto && root.crypto.subtle) ||
  (() => { throw new Error('WebCrypto ไม่พร้อม (ต้องเปิดผ่าน https หรือ localhost)'); })();
const enc = new TextEncoder(), dec = new TextDecoder();

// base64 แบบแบ่งก้อน — String.fromCharCode(...bytes) กับข้อมูล ~1 MB จะ stack overflow
function b64(buf){
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for(let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s){
  const bin = atob(s), u = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function rand(n){ const u = new Uint8Array(n); root.crypto.getRandomValues(u); return u; }

let _store = null;                 // localStorage (เบราว์เซอร์) หรือของปลอมในเทสต์
let _session = null;               // sessionStorage
function store(){ return _store || root.localStorage; }
function session(){ return _session || root.sessionStorage; }

// ── กุญแจ ────────────────────────────────────────────────────────────
async function deriveKey(password, salt, iter){
  const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  // deriveBits แทน deriveKey — ต้องได้ไบต์ดิบไว้เก็บใน sessionStorage (รีโหลดหน้าไม่ต้องใส่รหัสใหม่)
  const bits = await subtle().deriveBits({name:'PBKDF2', hash:'SHA-256', salt, iterations:iter}, base, 256);
  return new Uint8Array(bits);
}
function importAes(raw){
  return subtle().importKey('raw', raw, {name:'AES-GCM'}, false, ['encrypt','decrypt']);
}

async function encryptWith(key, text){
  const iv = rand(12);
  const ct = await subtle().encrypt({name:'AES-GCM', iv}, key, enc.encode(text));
  return {iv:b64(iv), ct:b64(ct)};
}
async function decryptWith(key, box){
  if(!box || !box.iv || !box.ct) throw new Error('ไม่มีข้อมูลเข้ารหัส');
  const pt = await subtle().decrypt({name:'AES-GCM', iv:unb64(box.iv)}, key, unb64(box.ct));
  return dec.decode(pt);
}

// ── สถานะ ───────────────────────────────────────────────────────────
let _key = null;                   // CryptoKey ในหน่วยความจำ — null = ล็อกอยู่

function read(){
  try{ const v = JSON.parse(store().getItem(VAULT_KEY) || 'null');
       return v && v.v === 1 && v.salt && v.check ? v : null; }
  catch(e){ return null; }
}
function exists(){ return !!read(); }
function user(){ const v = read(); return v ? v.user : ''; }
function isUnlocked(){ return !!_key; }

function normUser(u){ return String(u || '').trim(); }
function validate(username, password){
  const u = normUser(username);
  if(u.length < 2 || u.length > 64) return 'username';
  if(String(password || '').length < MIN_PW) return 'password';
  return '';
}

// ── หน่วงเวลาหลังใส่ผิด: 5 ครั้งแรกฟรี จากนั้น 30 วิ แล้วเพิ่มเท่าตัว (สูงสุด 15 นาที) ──
// กันการเดารหัสผ่านหน้าจอ · คนที่เข้าถึงไฟล์ในเครื่องได้ข้ามตัวนี้ได้ — ด่านจริงคือ PBKDF2 600k รอบ
function attempts(){
  try{ return JSON.parse(store().getItem(ATTEMPT_KEY) || '{"n":0,"until":0}'); }
  catch(e){ return {n:0, until:0}; }
}
function waitMs(now){
  const a = attempts(); return Math.max(0, (a.until || 0) - (now || Date.now()));
}
function _fail(now){
  const a = attempts(); a.n = (a.n || 0) + 1;
  if(a.n >= 5) a.until = (now || Date.now()) + Math.min(15*60e3, 30e3 * Math.pow(2, a.n - 5));
  store().setItem(ATTEMPT_KEY, JSON.stringify(a));
  return a;
}
function _resetAttempts(){ store().removeItem(ATTEMPT_KEY); }

// ── สร้าง / ปลดล็อก / ล็อก ─────────────────────────────────────────────
async function create(username, password, iter){
  const bad = validate(username, password);
  if(bad) throw new Error(bad === 'username' ? 'ชื่อผู้ใช้ 2–64 ตัวอักษร' : 'รหัสผ่านอย่างน้อย '+MIN_PW+' ตัวอักษร');
  const salt = rand(16), it = iter || ITER;
  const raw = await deriveKey(password, salt, it);
  const key = await importAes(raw);
  const check = await encryptWith(key, CHECK_TEXT);
  store().setItem(VAULT_KEY, JSON.stringify({v:1, user:normUser(username), salt:b64(salt), iter:it, check, created:Date.now()}));
  _resetAttempts();
  _key = key; _remember(raw);
  return true;
}

// คืน {ok:true} หรือ {ok:false, reason:'wait'|'user'|'password'|'none', waitMs}
async function unlock(username, password, now){
  const v = read();
  if(!v) return {ok:false, reason:'none'};
  const w = waitMs(now);
  if(w > 0) return {ok:false, reason:'wait', waitMs:w};
  // ชื่อผู้ใช้ไม่สนตัวพิมพ์ — ผิดก็นับเป็นครั้งที่ผิดเหมือนรหัส (ไม่บอกว่าผิดช่องไหน)
  const userOk = normUser(username).toLowerCase() === String(v.user).toLowerCase();
  let key = null;
  try{
    const raw = await deriveKey(String(password || ''), unb64(v.salt), v.iter || ITER);
    key = await importAes(raw);
    if(await decryptWith(key, v.check) !== CHECK_TEXT) throw new Error('check');
    if(!userOk) throw new Error('user');
    _key = key; _remember(raw); _resetAttempts();
    return {ok:true};
  }catch(e){
    const a = _fail(now);
    return {ok:false, reason:'password', waitMs:Math.max(0,(a.until||0)-(now||Date.now())), tries:a.n};
  }
}

// รีโหลดหน้าในแท็บเดิมไม่ต้องใส่รหัสใหม่ · ปิดแท็บ/ปิดแอป = sessionStorage หาย = ล็อก
function _remember(raw){ try{ session().setItem(SESSION_KEY, b64(raw)); }catch(e){} }
async function resume(){
  if(_key) return true;
  if(!exists()) return false;
  let s = null; try{ s = session().getItem(SESSION_KEY); }catch(e){}
  if(!s) return false;
  try{
    const key = await importAes(unb64(s));
    if(await decryptWith(key, read().check) !== CHECK_TEXT) throw new Error('check');
    _key = key; return true;
  }catch(e){ try{ session().removeItem(SESSION_KEY); }catch(_){} return false; }
}

function lock(){ _key = null; try{ session().removeItem(SESSION_KEY); }catch(e){} }

async function changePassword(oldPw, newPw){
  const v = read(); if(!v) throw new Error('ยังไม่มีบัญชี');
  if(String(newPw||'').length < MIN_PW) throw new Error('รหัสผ่านใหม่อย่างน้อย '+MIN_PW+' ตัวอักษร');
  const r = await unlock(v.user, oldPw);
  if(!r.ok) throw new Error(r.reason === 'wait' ? 'ใส่ผิดหลายครั้ง — รอสักครู่' : 'รหัสผ่านเดิมไม่ถูกต้อง');
  // ถอดของเดิมทั้งหมดด้วยกุญแจเก่า → สร้างกุญแจใหม่ → เข้ารหัสใหม่
  const blobs = {};
  for(const k of _blobKeys()){ try{ blobs[k] = await getItem(k); }catch(e){} }
  const salt = rand(16), raw = await deriveKey(newPw, salt, v.iter || ITER);
  const key = await importAes(raw);
  const check = await encryptWith(key, CHECK_TEXT);
  store().setItem(VAULT_KEY, JSON.stringify({...v, salt:b64(salt), check}));
  _key = key; _remember(raw);
  for(const [k, val] of Object.entries(blobs)) if(val != null) await setItem(k, val);
  return true;
}

// ลบบัญชี + ข้อมูลที่เข้ารหัสทั้งหมด (ข้อมูลจริงยังอยู่ใน Google Sheets)
function destroy(){
  _blobKeys().forEach(k => store().removeItem(PREFIX + k));
  store().removeItem(VAULT_KEY); _resetAttempts(); lock();
}

// ── เก็บ/อ่านข้อมูลแบบเข้ารหัส: คีย์ขึ้นต้น "finOS_enc:" ใน localStorage ──
const PREFIX = 'finOS_enc:';
function _blobKeys(){
  const out = [], s = store();
  for(let i = 0; i < s.length; i++){ const k = s.key(i); if(k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length)); }
  return out;
}
async function setItem(name, text){
  if(!_key) throw new Error('locked');
  store().setItem(PREFIX + name, JSON.stringify(await encryptWith(_key, String(text))));
}
async function getItem(name){
  if(!_key) throw new Error('locked');
  const raw = store().getItem(PREFIX + name);
  if(raw == null) return null;
  return decryptWith(_key, JSON.parse(raw));
}
function removeItem(name){ store().removeItem(PREFIX + name); }

root.Vault = {
  exists, user, isUnlocked, validate, create, unlock, resume, lock, changePassword, destroy,
  setItem, getItem, removeItem, waitMs, attempts, MIN_PW,
  // เทสต์เท่านั้น — สลับ storage เป็นของปลอม
  _setStorage(local, sess){ _store = local; _session = sess; _key = null; },
};
})(typeof window !== 'undefined' ? window : globalThis);
