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


def push(title: str, body: str, kind: str = "system", item_id: str | None = None) -> dict:
    """ส่ง Web Push ทุก subscription · คืน {"sent":n, "expired":[endpoint…], "failed":n, "skipped":เหตุผล}"""
    subs = load_subscriptions()
    vapid = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    if not subs or not vapid:
        why = "ยังไม่ได้ตั้ง PUSH_SUBSCRIPTIONS" if not subs else "ยังไม่ได้ตั้ง VAPID_PRIVATE_KEY"
        print(f"— ข้าม push: {why}")
        return {"sent": 0, "expired": [], "failed": 0, "skipped": why}
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        print("::warning::ไม่มี pywebpush — ข้าม push (workflow ต้อง pip install pywebpush)", file=sys.stderr)
        return {"sent": 0, "expired": [], "failed": 0, "skipped": "no pywebpush"}
    claims = {"sub": os.environ.get("VAPID_SUBJECT") or "mailto:finance-os@users.noreply.github.com"}
    data = json.dumps({"title": title, "body": preview(body), "kind": kind, "id": item_id,
                       "url": "./#notify"}, ensure_ascii=False)
    sent, failed, expired = 0, 0, []
    for s in subs:
        try:
            webpush(subscription_info=s, data=data, vapid_private_key=vapid,
                    vapid_claims=dict(claims), ttl=86400)
            sent += 1
        except WebPushException as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if code in (404, 410):
                expired.append(s["endpoint"])
            else:
                failed += 1
                print(f"::warning::push ล้ม ({code}): {str(e)[:160]}", file=sys.stderr)
        except Exception as e:                                   # noqa: BLE001
            failed += 1
            print(f"::warning::push ล้ม ({type(e).__name__}): {str(e)[:160]}", file=sys.stderr)
    for ep in expired:
        print(f"::warning::subscription หมดอายุ — ลบออกจาก PUSH_SUBSCRIPTIONS: …{ep[-24:]}")
    print(f"✓ push: ส่ง {sent}/{len(subs)} เครื่อง" + (f" · หมดอายุ {len(expired)}" if expired else "")
          + (f" · ล้ม {failed}" if failed else ""))
    return {"sent": sent, "expired": expired, "failed": failed, "skipped": None}
