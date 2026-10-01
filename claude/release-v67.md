# v67 — เมนูที่ 10 "การแจ้งเตือน" (Push ในแอป + History) แทน LINE

ฐาน: v66 · ตัดสินใจร่วมกับผู้ใช้: history เป็น **ไฟล์เข้ารหัสใน repo** · **ส่งคู่ LINE ก่อน แล้วปิดด้วยสวิตช์**

## ภาพรวม
```
GitHub Actions (Notify · เวลาเดิม: 08:00 daily · 20:00 alert · จันทร์ weekly · วันที่ 1 monthly)
   └─ line_notify.py → deliver(kind, ข้อความ)
         ├─ 1. history  → notifications.enc.json   (AES-256-GCM · secret NOTIFY_KEY)   ─┐
         ├─ 2. Web Push → ทุกเครื่องที่ลงทะเบียน   (VAPID_PRIVATE_KEY · PUSH_SUBSCRIPTIONS)│
         └─ 3. LINE     → เหมือนเดิม จนกว่าจะตั้ง  NOTIFY_LINE = off                      │
แอป (เมนู 🔔 การแจ้งเตือน) ← ถอดรหัสด้วยกุญแจในเครื่อง ←──────────────────────────────┘
   + เหตุการณ์ในแอป: sync ล้ม · งบเกิน · เรื่องสีแดงใน "ต้องลงมือ" (วันละครั้งต่อเรื่อง)
```

## ในแอป
- **เมนูที่ 10 🔔 การแจ้งเตือน** (sidebar กลุ่ม "ระบบ") + ตัวเลขยังไม่อ่าน · **มือถือ: กระดิ่งมุมขวาบนพร้อม badge**
- กล่องแจ้งเตือน: แท็บ ทั้งหมด / พอร์ต / ราคา / ระบบ (มีตัวเลขยังไม่อ่านต่อแท็บ) · แตะเพื่ออ่านเต็ม + ปุ่มไปหน้าที่เกี่ยวข้อง ·
  อ่านทั้งหมด · รีเฟรช · เก็บย้อนหลัง 180 วัน / 300 รายการ
- **⚙ ตั้งค่า 3 ขั้น**
  1. **สร้างกุญแจ** ในเครื่อง (WebCrypto): `NOTIFY_KEY` + คู่ VAPID → ปุ่มคัดลอกไปใส่ GitHub secrets ·
     กุญแจลับ VAPID แสดงครั้งเดียว ไม่เก็บในเครื่อง · **ลิงก์ตั้งค่า** (อยู่หลัง `#` ไม่ถูกส่งไป server) สำหรับเครื่องอื่น
  2. **เปิดแจ้งเตือนบนเครื่องนี้** → คัดลอก subscription ไปใส่ secret `PUSH_SUBSCRIPTIONS` · บอกสถานะสิทธิ์ ·
     iPhone: เตือนให้ "เพิ่มไปยังหน้าจอโฮม" ก่อน (iOS 16.4+)
  3. **ทดสอบ** ในเครื่อง + วิธีรัน workflow โหมด `test`
- กุญแจไม่ตรง → บอกชัดว่า "ถอดรหัสไม่ได้" (ไม่แสดงเป็น "ไม่มีแจ้งเตือน")
- `service-worker.js`: รับ push → แสดงแจ้งเตือน (แทนที่อันเก่าหมวดเดียวกัน) · กดแล้วเปิดแอปที่ `#notify` · บอกหน้าที่เปิดอยู่ให้รีเฟรช inbox

## Pipeline
- `scripts/notify_store.py` (ใหม่): `record()` เข้ารหัสทั้งก้อน · กันซ้ำเมื่อ rerun · กุญแจผิด = **ไม่เขียนทับ history เดิม** ·
  `push()` ส่งทุกเครื่อง · subscription 404/410 = แจ้งให้ลบ · ไม่มี secret = ข้ามแบบนุ่ม
- `scripts/line_notify.py`: `broadcast()` → `deliver()` (history → push → LINE) · โหมดใหม่ `test` · ไม่มี LINE token ไม่ใช่ error แล้ว ·
  ช่องทางใหม่ล้ม **ไม่ลาก LINE ล้มตาม**
- `.github/workflows/line-notify.yml` → ชื่อ **Notify**: ติดตั้ง `cryptography pywebpush` · secrets ใหม่ · commit `notifications.enc.json`

## ทดสอบ
| ชุด | ผล |
|---|---|
| `scripts/test_notify_store.py` (ใหม่) | 22/22 (เข้ารหัส · กันซ้ำ · กุญแจผิดไม่เขียนทับ · prune · push/410 mock) |
| `scripts/test_notify.cjs` (ใหม่) | 15/15 + **ข้ามภาษา: ไฟล์ที่ Python เข้ารหัส → ถอดด้วย WebCrypto ได้** |
| `scripts/test_line_notify.py` | ผ่าน + สวิตช์ `NOTIFY_LINE=off` · ช่องทางใหม่ล้มไม่กระทบ LINE |
| กุญแจ VAPID จากแอป ↔ `pywebpush` | กุญแจสาธารณะตรงกัน · เซ็น VAPID ได้ · เข้ารหัส payload ได้ |
| Chromium: push จริงผ่าน CDP → service worker | แสดงแจ้งเตือน "สรุปพอร์ตรายวัน" tag `finos-daily` |
| Chromium: หน้าแจ้งเตือน 1280/390 × Midnight/Light × TH/EN | ถอด history 4 รายการ + เหตุการณ์ในแอป · badge · อ่าน/อ่านทั้งหมด · แท็บหมวด · กุญแจผิดขึ้นคำเตือน · สร้างกุญแจ · ไม่มี error/ล้นขอบ |
| เทสต์เดิมทั้งหมด | ผ่าน (ยกเว้น `test_token.py` — ไลบรารี cryptography ของระบบในเครื่องทดสอบเสีย) |

**ยังไม่ได้ทดสอบ:** ส่ง push ผ่าน FCM/Apple จริง (เครื่องทดสอบต่อภายนอกไม่ได้) — ขั้นตอนหลัง deploy ด้านล่างคือการทดสอบนั้น

## หลัง deploy
1. hard refresh (`finance-os-v67`) → เมนู 🔔 → ⚙ ตั้งค่า → **สร้างกุญแจ**
2. GitHub → Settings → Secrets and variables → Actions → เพิ่ม secrets: `NOTIFY_KEY` · `VAPID_PRIVATE_KEY` · (ไม่บังคับ) `VAPID_SUBJECT` = `mailto:อีเมลคุณ`
3. บนมือถือ (iPhone: เพิ่มไปยังหน้าจอโฮมก่อน) → เปิดลิงก์ตั้งค่าที่คัดลอกจากขั้น 1 → ⚙ ขั้น 2 **เปิดการแจ้งเตือน** → คัดลอกไปใส่ secret `PUSH_SUBSCRIPTIONS`
   (หลายเครื่อง: รวมเป็น `[เครื่อง1, เครื่อง2]`)
4. Actions → **Notify** → Run workflow → โหมด **test** → ต้องเด้งบนมือถือ + เห็นในกล่องแจ้งเตือน
5. ใช้คู่ LINE สักพัก → Settings → Variables → เพิ่ม `NOTIFY_LINE` = `off` → LINE หยุด (ลบ secret `LINE_CHANNEL_TOKEN` ได้ภายหลัง)
