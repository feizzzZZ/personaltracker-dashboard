#!/usr/bin/env python3
"""
ชุดทดสอบ scripts/notify_store.py (v67) — รันโดยไม่ต่อเน็ต

    python3 scripts/test_notify_store.py

ต้องมี cryptography (workflow ติดตั้งให้) · ไม่มี = ข้ามทั้งไฟล์พร้อมบอกเหตุผล
"""
import base64
import json
import os
import sys
import tempfile
import unittest.mock as mock
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: F401
except BaseException as e:                                         # noqa: BLE001 — pyo3 panic ไม่ใช่ Exception
    if isinstance(e, (KeyboardInterrupt, SystemExit)):
        raise
    print(f"— ข้าม: ใช้ cryptography ไม่ได้ในเครื่องนี้ ({type(e).__name__})")
    sys.exit(0)
import notify_store as ns                                          # noqa: E402

FAIL = 0


def check(name, cond, detail=""):
    global FAIL
    print(f"  {'✓' if cond else '✗'} {name}{'' if cond else '  ' + str(detail)}")
    if not cond:
        FAIL += 1


KEY = os.urandom(32)
ENV = {"NOTIFY_KEY": base64.b64encode(KEY).decode()}
T0 = datetime(2026, 9, 30, 1, 0, tzinfo=timezone.utc)

with tempfile.TemporaryDirectory() as d:
    path = os.path.join(d, "n.enc.json")
    env = {**ENV, "NOTIFY_FILE": path}

    print("\n═══ record + เข้ารหัส ═══")
    with mock.patch.dict(os.environ, env):
        a = ns.record("daily", "สรุปพอร์ตรายวัน", "พอร์ต ฿1,234,567\nกำไร +฿5,000", "overview", now=T0)
        doc = json.load(open(path))
        check("ไฟล์ไม่มีข้อความเปิดเผย", "1,234,567" not in open(path, encoding="utf-8").read() and "พอร์ต" not in json.dumps(doc))
        check("รูปแบบ {v,updated,n,iv,ct}", set(doc) == {"v", "updated", "n", "iv", "ct"} and doc["n"] == 1)
        items = ns.decrypt(doc, KEY)
        check("ถอดรหัสได้ตรง", items[0]["body"].startswith("พอร์ต ฿1,234,567") and items[0]["kind"] == "daily")
        b = ns.record("daily", "สรุปพอร์ตรายวัน", "พอร์ต ฿1,234,567\nกำไร +฿5,000", "overview", now=T0 + timedelta(hours=1))
        check("rerun วันเดียวกันเนื้อหาเดิม → ไม่ซ้ำ", ns.decrypt(json.load(open(path)), KEY).__len__() == 1 and a["id"] == b["id"])
        ns.record("alert", "ราคาเคลื่อนไหว", "BTC −9%", now=T0 + timedelta(hours=2))
        items = ns.decrypt(json.load(open(path)), KEY)
        check("เรียงใหม่→เก่า", [x["kind"] for x in items] == ["alert", "daily"])
        ns.record("weird", "x", "y", now=T0 + timedelta(hours=3))
        check("kind ไม่รู้จัก → system", ns.decrypt(json.load(open(path)), KEY)[0]["kind"] == "system")
        check("iv ใหม่ทุกครั้ง", json.load(open(path))["iv"] != doc["iv"])

    print("\n═══ กุญแจผิด / ไม่มีกุญแจ ═══")
    before = open(path).read()
    with mock.patch.dict(os.environ, {"NOTIFY_KEY": base64.b64encode(os.urandom(32)).decode(), "NOTIFY_FILE": path}):
        check("กุญแจผิด → ไม่บันทึก", ns.record("daily", "t", "b", now=T0) is None)
    check("กุญแจผิด → ไม่เขียนทับ history เดิม", open(path).read() == before)
    with mock.patch.dict(os.environ, {"NOTIFY_KEY": "", "NOTIFY_FILE": path}):
        check("ไม่มีกุญแจ → ข้ามนุ่ม", ns.record("daily", "t", "b") is None)
    with mock.patch.dict(os.environ, {"NOTIFY_KEY": base64.b64encode(b"short").decode()}):
        check("กุญแจสั้น → None", ns.load_key() is None)
    with mock.patch.dict(os.environ, {"NOTIFY_KEY": base64.urlsafe_b64encode(KEY).decode().rstrip("=")}):
        check("รับ base64url ไม่มี padding", ns.load_key() == KEY)

    print("\n═══ prune ═══")
    many = [{"id": str(i), "ts": (T0 - timedelta(hours=i)).isoformat()} for i in range(400)]
    old = [{"id": "old", "ts": (T0 - timedelta(days=200)).isoformat()}]
    p = ns.prune(many + old, T0)
    check("เก็บไม่เกิน 300", len(p) == 300)
    check("ตัดเก่ากว่า 180 วัน", all(x["id"] != "old" for x in ns.prune(old + many[:3], T0)))

print("\n═══ push ═══")
SUB = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "x", "auth": "y"}}
with mock.patch.dict(os.environ, {"PUSH_SUBSCRIPTIONS": "", "VAPID_PRIVATE_KEY": "k"}):
    check("ไม่มี subscription → ข้ามนุ่ม", ns.push("t", "b")["skipped"])
with mock.patch.dict(os.environ, {"PUSH_SUBSCRIPTIONS": json.dumps(SUB), "VAPID_PRIVATE_KEY": ""}):
    check("ไม่มี VAPID → ข้ามนุ่ม", ns.push("t", "b")["skipped"])
with mock.patch.dict(os.environ, {"PUSH_SUBSCRIPTIONS": json.dumps(SUB)}):
    check("subscription เดี่ยว (ไม่ใช่ array) รับได้", len(ns.load_subscriptions()) == 1)
with mock.patch.dict(os.environ, {"PUSH_SUBSCRIPTIONS": json.dumps([SUB, {"endpoint": "x"}])}):
    check("ตัด subscription ไม่ครบคีย์", len(ns.load_subscriptions()) == 1)
try:
    import pywebpush                                               # noqa: F401
    have_wp = True
except ImportError:
    have_wp = False
if have_wp:
    from pywebpush import WebPushException

    class R:
        status_code = 410
    calls = []

    def fake(**kw):
        calls.append(kw)
        if kw["subscription_info"]["endpoint"].endswith("dead"):
            raise WebPushException("gone", response=R())
    subs = [SUB, {**SUB, "endpoint": "https://push.example/dead"}]
    K = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")   # d แบบสุ่ม (P-256 รับได้แทบทุกค่า)
    with mock.patch.dict(os.environ, {"PUSH_SUBSCRIPTIONS": json.dumps(subs), "VAPID_PRIVATE_KEY": K}), \
            mock.patch("pywebpush.webpush", fake):
        r = ns.push("หัวข้อ", "บรรทัด 1\n───\nบรรทัด 2", "alert", "id1")
    check("ส่งได้ 1 · หมดอายุ 1 (410)", r["sent"] == 1 and r["expired"] == ["https://push.example/dead"], r)
    payload = json.loads(calls[0]["data"])
    check("payload มีหัวข้อ/ตัวอย่าง/ลิงก์", payload["title"] == "หัวข้อ" and payload["body"] == "บรรทัด 1 · บรรทัด 2"
          and payload["url"] == "./#notify", payload)
else:
    print("  — ข้ามเทสต์ส่งจริง: ไม่มี pywebpush")

if have_wp:
    print("\n═══ v67.1 — กุญแจ VAPID ทุกรูปแบบ + รหัสตรวจ ═══")
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    def b64u(b):
        return base64.urlsafe_b64encode(b).decode().rstrip("=")
    priv = ec.generate_private_key(ec.SECP256R1())
    d = priv.private_numbers().private_value.to_bytes(32, "big")
    PUB = b64u(priv.public_key().public_bytes(serialization.Encoding.X962,
                                              serialization.PublicFormat.UncompressedPoint))
    D = b64u(d)                                                  # รูปแบบเดียวกับ jwk.d ที่แอปสร้าง
    pem = priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption()).decode()
    for label, raw in [("แบบแอป (b64url)", D), ("มีเครื่องหมายคำพูด", f'"{D}"'), ("มีช่องว่าง/ขึ้นบรรทัด", f"  {D}\n"),
                       ("base64 ปกติ", base64.b64encode(d).decode()), ("JWK JSON", json.dumps({"d": D})), ("PEM", pem)]:
        v, p, why = ns.parse_vapid(raw)
        check(f"รับได้: {label}", v is not None and p == PUB, why)
    v, p, why = ns.parse_vapid(PUB)
    check("วางกุญแจสาธารณะ → บอกว่าเป็นกุญแจสาธารณะ", v is None and "สาธารณะ" in why, why)
    nk = base64.b64encode(os.urandom(16)).decode()
    with mock.patch.dict(os.environ, {"NOTIFY_KEY": nk}):
        v, p, why = ns.parse_vapid(nk)
    check("ความยาวผิด + ซ้ำ NOTIFY_KEY → บอกวางผิดช่อง", v is None and "16 ไบต์" in why and "ผิดช่อง" in why, why)
    v, p, why = ns.parse_vapid("not a key!!")
    check("ขยะ → ข้อความวินิจฉัย ไม่ throw", v is None and why, why)
    check("รหัสตรวจ = 8 ตัวท้ายกุญแจสาธารณะ", ns.fingerprint(PUB) == PUB[-8:])

    print("\n═══ v67.1 — ส่งด้วยกุญแจจริง / กุญแจไม่ตรง ═══")
    # subscription ของ "เบราว์เซอร์" จำลอง (p256dh/auth จริง) → pywebpush เข้ารหัส+เซ็นจริง แค่ไม่ยิงเน็ต
    ua = ec.generate_private_key(ec.SECP256R1())
    real = {"endpoint": "https://web.push.apple.com/ok", "keys": {
        "p256dh": b64u(ua.public_key().public_bytes(serialization.Encoding.X962,
                                                    serialization.PublicFormat.UncompressedPoint)),
        "auth": b64u(os.urandom(16))}}
    posted = []

    class Resp:
        def __init__(self, code, text=""):
            self.status_code, self.text, self.headers, self.reason = code, text, {}, ""
            self.content = text.encode()

    def fake_post(url, data=None, headers=None, timeout=None, **kw):
        posted.append((url, headers))
        if url.endswith("/mm"):
            return Resp(400, '{"reason":"VapidPkHashMismatch"}')
        return Resp(201)
    subs = [{**real, "vapidPub": PUB},
            {**real, "endpoint": "https://web.push.apple.com/other", "vapidPub": "B" + PUB[1:-8] + "XXXXXXXX"},
            {**real, "endpoint": "https://web.push.apple.com/mm"}]
    with mock.patch.dict(os.environ, {"PUSH_SUBSCRIPTIONS": json.dumps(subs), "VAPID_PRIVATE_KEY": f'"{D}"\n',
                                      "VAPID_SUBJECT": "me@example.com"}), \
            mock.patch("requests.post", fake_post):
        r = ns.push("หัวข้อ", "เนื้อหา", "test", "id2")
    check("ส่งจริงผ่าน 1 (กุญแจมี quote ก็อ่านได้)", r["sent"] == 1, r)
    check("vapidPub ไม่ตรง → ข้าม ไม่ยิง", all(not u.endswith("/other") for u, _ in posted), posted)
    check("400 VapidPkHashMismatch → นับเป็นกุญแจไม่ตรง", r["mismatch"] == 2 and r["failed"] == 2, r)
    check("รหัสตรวจใน log ตรงกับแอป", r["fingerprint"] == PUB[-8:], r)
    auth = (posted[0][1] or {}).get("Authorization", "")
    check("header แบบ RFC 8292 (vapid t=…, k=กุญแจสาธารณะเดียวกัน) — Apple บังคับ",
          auth.startswith("vapid ") and PUB in auth.replace("=", ""), auth[:80])
    tok = auth.split("t=")[1].split(",")[0]
    claims = json.loads(base64.urlsafe_b64decode(tok.split(".")[1] + "=="))
    check("subject ผิดรูป → ใช้ mailto: ค่าเริ่มต้น", claims.get("sub", "").startswith("mailto:"), claims)
    with mock.patch.dict(os.environ, {"PUSH_SUBSCRIPTIONS": json.dumps(subs), "VAPID_PRIVATE_KEY": PUB}):
        r = ns.push("t", "b")
    check("VAPID เป็นกุญแจสาธารณะ → ไม่ส่งเลย + มีเหตุผล", r["sent"] == 0 and "สาธารณะ" in (r["skipped"] or ""), r)

print("─────────────────────────────────────────────")
if FAIL:
    print(f"❌ ไม่ผ่าน {FAIL} ข้อ")
    sys.exit(1)
print("✅ ผ่านทั้งหมด")
