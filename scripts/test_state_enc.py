"""v72 — notify-state.json ต้องเข้ารหัสเมื่อมี NOTIFY_KEY และอ่านไฟล์เก่าแบบไม่เข้ารหัสได้

รัน:  python3 scripts/test_state_enc.py   (ต้องมี cryptography · Python 3.10+)
"""
import base64
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
TMP = tempfile.mkdtemp()
os.environ["NOTIFY_STATE"] = os.path.join(TMP, "state.json")
import line_notify as LN  # noqa: E402

FAIL = 0


def check(name, ok, detail=""):
    global FAIL
    print(("  ✓ " if ok else "  ✗ ") + name + ("" if ok else "  " + str(detail)))
    FAIL += 0 if ok else 1


ST = {"last": {"total": 416583.67, "groups": {"คริปโต": {"value": 119898.2}}, "prices": {"BTC": [1, 2]}}}
key = base64.b64encode(os.urandom(32)).decode()

# 1) มีกุญแจ → ไฟล์ไม่มีตัวเลขพอร์ตเป็นข้อความธรรมดา
os.environ["NOTIFY_KEY"] = key
LN.save_state(ST)
raw = open(LN.STATE, encoding="utf-8").read()
check("เข้ารหัสแล้ว (enc=aesgcm)", json.loads(raw).get("enc") == "aesgcm", raw[:80])
check("ไม่มีมูลค่าพอร์ตในไฟล์", "416583" not in raw and "คริปโต" not in raw and "BTC" not in raw)
check("อ่านกลับได้ครบ", LN.load_state() == ST, LN.load_state())

# 2) กุญแจผิด → ฐานใหม่ ไม่ล้ม
os.environ["NOTIFY_KEY"] = base64.b64encode(os.urandom(32)).decode()
check("กุญแจผิด → {}", LN.load_state() == {})

# 3) ไฟล์เก่าแบบไม่เข้ารหัส (ก่อน v72) อ่านได้
with open(LN.STATE, "w", encoding="utf-8") as f:
    json.dump(ST, f, ensure_ascii=False)
os.environ["NOTIFY_KEY"] = key
check("อ่านไฟล์เก่าแบบไม่เข้ารหัสได้", LN.load_state() == ST)
LN.save_state(LN.load_state())
check("เขียนรอบถัดไปเป็นแบบเข้ารหัส", json.load(open(LN.STATE)).get("enc") == "aesgcm")

# 4) ไม่มีกุญแจ → เขียนแบบเดิม (ไม่ทำให้งานล้ม)
os.environ.pop("NOTIFY_KEY", None)
LN.save_state(ST)
check("ไม่มีกุญแจ → เขียนแบบเดิม", json.load(open(LN.STATE)) == ST)

print("\n✅ ผ่านทั้งหมด" if not FAIL else f"\n❌ ไม่ผ่าน {FAIL} ข้อ")
sys.exit(1 if FAIL else 0)
