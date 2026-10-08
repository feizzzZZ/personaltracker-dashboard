#!/usr/bin/env python3
"""
v67 — ช่องทางแจ้งเตือนในแอป (แทน LINE): history เข้ารหัส + Web Push

  record(kind, title, body)  → เพิ่มลง notifications.enc.json (AES-256-GCM ทั้งก้อน)
  push(title, body, kind)    → Web Push ถึงทุกเครื่องที่ลงทะเบียนไว้

ทำไมต้องเข้ารหัส: repo/GitHub Pages อ่านได้สาธารณะ แต่ข้อความมีตัวเลขพอร์ตและรายรับรายจ่าย
ผู้ถอดรหัสได้มีแค่ Actions (secret NOTIFY_KEY) กับแอปบนเครื่องที่ใส่กุญแจเดียวกันไว้

ENV (ไม่มีตัวไหน = ข้ามช่องทางนั้นแบบนุ่ม ไม่ล้มทั้งงาน)
  NOTIFY_KEY          กุญแจ AES 256-bit (base64) — สร้างจากหน้า "การแจ้งเตือน" ในแอป
  VAPID_PRIVATE_KEY   กุญแจลับ VAPID (base64url 32 ไบต์) — สร้างจากแอปเช่นกัน
  VAPID_SUBJECT       mailto:… หรือ https://… (ไม่บังคับ)
  PUSH_SUBSCRIPTIONS  JSON array ของ subscription ทุกเครื่อง (คัดลอกจากแอป)
  NOTIFY_FILE         ที่อยู่ไฟล์ (ค่าเริ่มต้น notifications.enc.json)

รูปแบบไฟล์ (ต้องตรงกับ notifyDecrypt() ใน shared.js):
  {"v":1, "updated":ISO, "n":จำนวน, "iv":base64(12 ไบต์), "ct":base64(ciphertext+tag)}
  plaintext = JSON array [{id, ts, kind, title, body, page}] เรียงใหม่→เก่า · AAD = b"finos-notify-v1"
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone

AAD = b"finos-notify-v1"
MAX_ITEMS = 300
MAX_DAYS = 180
KINDS = {"daily", "alert", "weekly", "monthly", "system", "test"}


def _file() -> str:
    return os.environ.get("NOTIFY_FILE", "notifications.enc.json")


def _b64d(s: str) -> bytes:
    s = (s or "").strip()
    s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s.replace("+", "-").replace("/", "_"))


def load_key() -> bytes | None:
    raw = os.environ.get("NOTIFY_KEY", "").strip()
    if not raw:
        return None
    try:
        k = _b64d(raw)
    except (ValueError, TypeError):
        print("⚠️  NOTIFY_KEY ไม่ใช่ base64", file=sys.stderr)
        return None
    if len(k) != 32:
        print(f"⚠️  NOTIFY_KEY ยาว {len(k)} ไบต์ — ต้องเป็น 32 (AES-256)", file=sys.stderr)
        return None
    return k


def encrypt(items: list[dict], key: bytes, now: datetime | None = None) -> dict:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = os.urandom(12)
    pt = json.dumps(items, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ct = AESGCM(key).encrypt(iv, pt, AAD)
    return {"v": 1, "updated": (now or datetime.now(timezone.utc)).isoformat(), "n": len(items),
            "iv": base64.b64encode(iv).decode(), "ct": base64.b64encode(ct).decode()}


def decrypt(doc: dict, key: bytes) -> list[dict]:
    """คืนรายการ · ถอดไม่ได้ (กุญแจผิด/ไฟล์เสีย) → ValueError — ห้ามเขียนทับ history เดิม"""
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    try:
        pt = AESGCM(key).decrypt(base64.b64decode(doc["iv"]), base64.b64decode(doc["ct"]), AAD)
    except (KeyError, TypeError, ValueError, InvalidTag) as e:
        raise ValueError(f"ถอดรหัสไม่ได้ ({type(e).__name__}) — NOTIFY_KEY ไม่ตรงกับที่ใช้เข้ารหัสไฟล์นี้?") from e
    items = json.loads(pt.decode("utf-8"))
    return items if isinstance(items, list) else []


def make_id(kind: str, title: str, body: str, ts: str) -> str:
    # วันเดียวกัน + เนื้อหาเดียวกัน = รายการเดียวกัน (rerun workflow ไม่ทำให้ history ซ้ำ)
    return hashlib.sha256(f"{kind}|{ts[:10]}|{title}|{body}".encode("utf-8")).hexdigest()[:16]


def prune(items: list[dict], now: datetime) -> list[dict]:
    cut = (now - timedelta(days=MAX_DAYS)).isoformat()
    items = [x for x in items if str(x.get("ts", "")) >= cut]
    items.sort(key=lambda x: str(x.get("ts", "")), reverse=True)
    return items[:MAX_ITEMS]


def record(kind: str, title: str, body: str, page: str | None = None,
           now: datetime | None = None) -> dict | None:
    """เพิ่มหนึ่งรายการลงไฟล์ · คืนรายการที่บันทึก หรือ None ถ้าข้าม"""
    key = load_key()
    if not key:
        print("— ข้าม history: ยังไม่ได้ตั้ง NOTIFY_KEY")
        return None
    now = now or datetime.now(timezone.utc)
    path = _file()
    items: list[dict] = []
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                items = decrypt(json.load(f), key)
        except (OSError, json.JSONDecodeError, ValueError) as e:
            print(f"::warning::history: {e} — ไม่เขียนทับไฟล์เดิม", file=sys.stderr)
            return None
    ts = now.isoformat()
    kind = kind if kind in KINDS else "system"
    item = {"id": make_id(kind, title, body, ts), "ts": ts, "kind": kind,
            "title": title[:120], "body": body[:4000], "page": page}
    if any(x.get("id") == item["id"] for x in items):
        print(f"— history: มีรายการนี้แล้ว ({item['id']})")
        return item
    items = prune([item] + items, now)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(encrypt(items, key, now), f, separators=(",", ":"))
    print(f"✓ history: บันทึก [{kind}] {title} · รวม {len(items)} รายการ")
    return item


def load_subscriptions() -> list[dict]:
    raw = os.environ.get("PUSH_SUBSCRIPTIONS", "").strip()
    if not raw:
        return []
    try:
        v = json.loads(raw)
    except json.JSONDecodeError:
        print("⚠️  PUSH_SUBSCRIPTIONS ไม่ใช่ JSON", file=sys.stderr)
        return []
    subs = v if isinstance(v, list) else [v]
    return [s for s in subs if isinstance(s, dict) and s.get("endpoint") and (s.get("keys") or {}).get("p256dh")]


def preview(body: str, n: int = 170) -> str:
    """บรรทัดแรก ๆ ที่มีเนื้อหา — จอล็อกแสดงได้ไม่กี่บรรทัด"""
    lines = [x.strip() for x in (body or "").splitlines() if x.strip() and not set(x.strip()) <= set("─━-=·")]
    s = " · ".join(lines[:3])
    return s if len(s) <= n else s[: n - 1] + "…"


# ══ v67.1 — อ่านกุญแจ VAPID ให้ทนทุกรูปแบบ + บอกเหตุผลเป็นภาษาคน ═══════════════
# อาการจริง: "Could not deserialize key data" (secret มีเครื่องหมายคำพูด/ช่องว่าง หรือวางผิดช่อง)
#           และ Apple ตอบ 400 VapidPkHashMismatch (กุญแจลับคนละชุดกับที่ iPhone ใช้ลงทะเบียน)
# รับได้: base64url/base64 ของค่า d 32 ไบต์ (แบบที่แอปสร้าง) · JWK JSON · PEM · DER (PKCS8/SEC1)
def fingerprint(pub_b64url: str | None) -> str:
    """รหัสตรวจ = 8 ตัวท้ายของกุญแจสาธารณะ — แอปแสดงเลขเดียวกัน ให้เทียบด้วยตา"""
    return (pub_b64url or "")[-8:] or "—"


def parse_vapid(raw: str):
    """คืน (Vapid | None, กุญแจสาธารณะ base64url | None, ข้อความวินิจฉัย | None)"""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from py_vapid import Vapid02   # RFC 8292 "vapid t=…,k=…" — Apple ไม่รับแบบ draft (Vapid01)
    v = (raw or "").strip().strip('"').strip("'").strip()
    if not v:
        return None, None, "ยังไม่ได้ตั้ง VAPID_PRIVATE_KEY"
    key = None
    try:
        if v.startswith("{"):
            v = str(json.loads(v).get("d") or "")
        if "-----BEGIN" in v:
            key = serialization.load_pem_private_key(v.encode(), password=None)
        else:
            b = _b64d("".join(v.split()))
            if len(b) == 32:
                key = ec.derive_private_key(int.from_bytes(b, "big"), ec.SECP256R1())
            elif len(b) == 65 and b[0] == 4:
                return None, None, ("VAPID_PRIVATE_KEY เป็นกุญแจ \"สาธารณะ\" (65 ไบต์ ขึ้นต้น 0x04) — "
                                    "ต้องใช้กุญแจลับที่แอปแสดงครั้งเดียวตอนกด \"สร้างกุญแจ\"")
            elif len(b) > 60:
                key = serialization.load_der_private_key(b, password=None)
            else:
                same = v == os.environ.get("NOTIFY_KEY", "").strip()
                return None, None, (f"VAPID_PRIVATE_KEY ถอด base64 ได้ {len(b)} ไบต์ (ต้องเป็น 32)"
                                    + (" — ค่าเดียวกับ NOTIFY_KEY: วางผิดช่อง" if same else
                                       " — ตรวจว่าคัดลอกครบและไม่มีตัวอักษรอื่นปน"))
    except Exception as e:                                       # noqa: BLE001
        return None, None, f"อ่าน VAPID_PRIVATE_KEY ไม่ได้ ({type(e).__name__}) — คัดลอกใหม่จากแอป"
    if not isinstance(key, ec.EllipticCurvePrivateKey) or key.curve.name != "secp256r1":
        return None, None, "VAPID_PRIVATE_KEY ไม่ใช่กุญแจ EC P-256"
    pub = key.public_key().public_bytes(serialization.Encoding.X962,
                                        serialization.PublicFormat.UncompressedPoint)
    return Vapid02(key), base64.urlsafe_b64encode(pub).decode().rstrip("="), None


def vapid_subject() -> str:
    s = os.environ.get("VAPID_SUBJECT", "").strip().strip('"').strip("'")
    if s and not (s.startswith("mailto:") or s.startswith("https://")):
        print(f"::warning::VAPID_SUBJECT ต้องขึ้นต้นด้วย mailto: หรือ https:// (ได้ \"{s[:30]}\") — "
              "Apple จะปฏิเสธ (BadJwtToken) จึงใช้ค่าเริ่มต้นแทน", file=sys.stderr)
        s = ""
    return s or "mailto:finance-os@users.noreply.github.com"


MISMATCH_HELP = ("กุญแจลับใน secret ไม่ใช่คู่ของกุญแจที่เครื่องนี้ใช้ลงทะเบียน — "
                 "แก้: ในแอป 🔔 → ⚙ ขั้น 2 กด \"เปิดการแจ้งเตือน\" ใหม่บนเครื่องที่สร้างกุญแจชุดปัจจุบัน "
                 "แล้วคัดลอกไปแทน PUSH_SUBSCRIPTIONS (หรือใส่ VAPID_PRIVATE_KEY ชุดที่ตรง)")


def push(title: str, body: str, kind: str = "system", item_id: str | None = None) -> dict:
    """ส่ง Web Push ทุก subscription · คืน {"sent":n, "expired":[endpoint…], "failed":n, "skipped":เหตุผล}"""
    subs = load_subscriptions()
    raw = os.environ.get("VAPID_PRIVATE_KEY", "")
    if not subs or not raw.strip():
        why = "ยังไม่ได้ตั้ง PUSH_SUBSCRIPTIONS" if not subs else "ยังไม่ได้ตั้ง VAPID_PRIVATE_KEY"
        print(f"— ข้าม push: {why}")
        return {"sent": 0, "expired": [], "failed": 0, "skipped": why}
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        print("::warning::ไม่มี pywebpush — ข้าม push (workflow ต้อง pip install pywebpush)", file=sys.stderr)
        return {"sent": 0, "expired": [], "failed": 0, "skipped": "no pywebpush"}
    try:
        vapid, pub, why = parse_vapid(raw)
    except ImportError as e:
        vapid, pub, why = None, None, f"ไม่มีไลบรารี ({e})"
    if not vapid:
        print(f"::error title=push: กุญแจ VAPID ใช้ไม่ได้::{why}", file=sys.stderr)
        return {"sent": 0, "expired": [], "failed": len(subs), "skipped": why}
    print(f"  VAPID รหัสตรวจ …{fingerprint(pub)}  (ต้องตรงกับที่แอปแสดงในขั้น 1/2)")
    claims = {"sub": vapid_subject()}
    data = json.dumps({"title": title, "body": preview(body), "kind": kind, "id": item_id,
                       "url": "./#notify"}, ensure_ascii=False)
    sent, failed, expired, mismatch = 0, 0, [], 0
    for s in subs:
        host = urllib.parse.urlsplit(s["endpoint"]).netloc
        sp = s.get("vapidPub")
        if sp and sp != pub:
            # รู้ล่วงหน้าว่าจะโดนปฏิเสธ — ไม่ต้องยิง (เครื่องที่ลงทะเบียนตั้งแต่ v67.1 แนบกุญแจที่ใช้มาด้วย)
            mismatch += 1; failed += 1
            print(f"::warning::push ข้าม {host}: เครื่องนี้ลงทะเบียนด้วยกุญแจ …{fingerprint(sp)} "
                  f"แต่ secret คือ …{fingerprint(pub)} — {MISMATCH_HELP}", file=sys.stderr)
            continue
        info = {"endpoint": s["endpoint"], "keys": s["keys"]}
        try:
            webpush(subscription_info=info, data=data, vapid_private_key=vapid,
                    vapid_claims=dict(claims), ttl=86400)
            sent += 1
        except WebPushException as e:
            resp = getattr(e, "response", None)
            code = getattr(resp, "status_code", None)
            text = (getattr(resp, "text", "") or str(e))[:300]
            if code in (404, 410):
                expired.append(s["endpoint"])
            elif "VapidPkHashMismatch" in text or "BadJwtToken" in text and "subject" not in text.lower():
                mismatch += 1; failed += 1
                print(f"::warning::push ถูก {host} ปฏิเสธ ({code}) — {MISMATCH_HELP} "
                      f"[secret รหัสตรวจ …{fingerprint(pub)}]", file=sys.stderr)
            else:
                failed += 1
                print(f"::warning::push ล้ม {host} ({code}): {text[:200]}", file=sys.stderr)
        except Exception as e:                                   # noqa: BLE001
            failed += 1
            print(f"::warning::push ล้ม ({type(e).__name__}): {str(e)[:160]}", file=sys.stderr)
    for ep in expired:
        print(f"::warning::subscription หมดอายุ — ลบออกจาก PUSH_SUBSCRIPTIONS: …{ep[-24:]}")
    print(f"✓ push: ส่ง {sent}/{len(subs)} เครื่อง" + (f" · หมดอายุ {len(expired)}" if expired else "")
          + (f" · ล้ม {failed}" if failed else ""))
    return {"sent": sent, "expired": expired, "failed": failed, "skipped": None, "mismatch": mismatch,
            "fingerprint": fingerprint(pub)}
