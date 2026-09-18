#!/usr/bin/env python3
"""ทดสอบการเซ็น JWT เองโดยไม่ใช้ requests — สร้างคีย์จริงแล้วตรวจว่าถอดกลับได้"""
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("MARKET_DATA_OUT", "/tmp/t-market.json")

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
pem = key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption()).decode()

INFO = {
    "type": "service_account",
    "project_id": "finance-tracker-507616",
    "private_key_id": "7519f42ffc183241458a483203f7f4f43cb2cf4f",
    "private_key": pem,
    "client_email": "finance-notify@finance-tracker-507616.iam.gserviceaccount.com",
    "client_id": "111233597446513842340",
    "token_uri": "https://oauth2.googleapis.com/token",
}

import line_notify as LN  # noqa: E402

assertion = LN._build_jwt_assertion(INFO, LN.SCOPE)
print(f"assertion ยาว {len(assertion)} ตัวอักษร")

head_b64, body_b64, sig_b64 = assertion.split(".")


def unb64(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


head = json.loads(unb64(head_b64))
body = json.loads(unb64(body_b64))
print("header:", head)
print("payload:", json.dumps(body, indent=2, ensure_ascii=False))

assert head["alg"] == "RS256", head
assert head["kid"] == INFO["private_key_id"], "ต้องใส่ kid ให้ Google หาคีย์ถูกใบ"
assert body["iss"] == INFO["client_email"]
assert body["aud"] == INFO["token_uri"]
assert body["scope"] == LN.SCOPE
assert body["exp"] - body["iat"] == 3600
assert abs(body["iat"] - int(time.time())) < 5, "iat เพี้ยน — Google จะปฏิเสธ"
assert len(unb64(sig_b64)) == 256, "ลายเซ็น RSA-2048 ต้องยาว 256 ไบต์"

# ── ตรวจว่าลายเซ็นถูกต้องจริง ไม่ใช่แค่มีความยาวถูก ──
from cryptography.hazmat.primitives import hashes  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import padding  # noqa: E402

key.public_key().verify(
    unb64(sig_b64), f"{head_b64}.{body_b64}".encode(),
    padding.PKCS1v15(), hashes.SHA256())
print("✓ ลายเซ็นผ่านการตรวจสอบด้วย public key")

# ══════════════════════════════════════════════════════════════════════
# ต้องเซ็นได้แม้ไม่มี requests เลย — นี่คือบั๊กที่เพิ่งเจอบน GitHub Actions
# ══════════════════════════════════════════════════════════════════════
# ต้องรันใน process ใหม่ ไม่ใช่ reload ใน process เดิม เพราะ sys.modules
# cache ไว้แล้ว การบล็อกทีหลังจึงไม่มีอะไรถูกเรียกจริง (เทสต์จะผ่านแบบหลอกๆ)
import subprocess  # noqa: E402
import tempfile  # noqa: E402

GUARD = r'''
import sys, json, os
class Block:
    def find_module(self, name, path=None): return self.find_spec(name, path)
    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] in ("requests", "urllib3"):
            raise ImportError("ถูกบล็อกโดยเจตนา: " + name)
        return None
sys.meta_path.insert(0, Block())
sys.path.insert(0, SCRIPTS)
import line_notify as LN
info = json.load(open(KEYFILE))
a = LN._build_jwt_assertion(info, LN.SCOPE)
assert len(a.split(".")) == 3, a
print("OK", len(a))
'''

with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
    json.dump(INFO, f)
    keyfile = f.name
script = (f"SCRIPTS={os.path.dirname(os.path.abspath(__file__))!r}\n"
          f"KEYFILE={keyfile!r}\n" + GUARD)
r = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True,
                   env={**os.environ, "MARKET_DATA_OUT": "/tmp/t-market.json"})
os.unlink(keyfile)
if r.returncode != 0:
    print(r.stdout)
    print(r.stderr, file=sys.stderr)
    raise SystemExit("❌ เซ็น JWT ไม่ได้เมื่อไม่มี requests — บั๊กเดิมยังอยู่")
print(f"✓ เซ็น JWT ได้ใน process ที่ห้าม import requests/urllib3 ({r.stdout.strip()})")

print("\n✅ ผ่านทั้งหมด")
