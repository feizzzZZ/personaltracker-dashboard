#!/usr/bin/env python3
"""
เทสต์คุมบั๊ก "สัญญาณหายทั้งก้อนเมื่อขั้นสัญญาณล้มหนึ่งรอบ"

    python3 scripts/test_signals_carry.py

ที่มา: fetch_market_data.py ประกอบ payload ใหม่ทุกรอบจาก key ที่ระบุตรง ๆ
เท่านั้น จึงไม่ carry บล็อก signals/risk/signals_meta ที่ fetch_signals.py
เขียนไว้ พอ Yahoo ล่มหนึ่งรอบ ไฟล์ที่ commit จะไม่มีสัญญาณเลย —
ไม่ใช่ "ของเก่าที่มีอายุ" แต่หายทั้งก้อน

ผลข้างเคียงที่ร้ายกว่า: shared.js มี SIGNAL_MAX_DAYS = 7 พร้อม UI ที่ทำแถวจาง
แยกตารางของเก่า และไม่นับรวมในสรุป — โค้ดชุดนั้นไม่มีทางถูกเรียกใช้เลย

แก้ 2 ที่:
  1. fetch_market_data.py — carry 3 บล็อกนั้นมาจากไฟล์เดิม (apply_v50_pipeline.py)
  2. fetch_signals.py     — merge ราย-ticker แบบเดียวกับที่ prices ทำ
                            + risk ต้องเป็น "unknown" ไม่ใช่ "normal" เมื่อไม่มีข้อมูล
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest.mock as mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_signals as fs                                          # noqa: E402

FAIL = 0


def check(name, cond, detail=""):
    global FAIL
    if cond:
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}  {detail}")


ISO = fs.NOW
def d(n):                                                           # noqa: E302
    from datetime import timedelta
    return (ISO - timedelta(days=n)).strftime("%Y-%m-%d")


def sig(tk, days_old, score=1, ma="Above"):
    return {"sym": tk, "price": 100.0, "updated": d(days_old), "rsi": 50.0,
            "ma50": "Above", "ma200": ma, "chg1m": 1.0, "chg3m": 2.0,
            "chg6m": 3.0, "pos52w": 50.0, "drawdown": -5.0, "vol30d": 20.0,
            "score": score, "action": "ถือ", "why": [], "spark": [1, 2, 3]}


def base_file(with_signals=True, carry=True):
    """สร้าง market-data.json ที่ fetch_market_data.py จะทิ้งไว้ให้

    carry=True  จำลองพฤติกรรม *หลังแพตช์* v50 (carry บล็อกเดิมมา)
    carry=False จำลองพฤติกรรม *ก่อนแพตช์* (ทิ้งบล็อกเดิม)
    """
    p = {
        "generated_at": ISO.isoformat(), "stats": {},
        "data": {"VIX": {"value": 15.1, "updated": d(0), "fetched_at": "x"}},
        "prices": {"AAPL": {"price": 338.98, "ccy": "USD", "updated": d(0),
                            "src": "Yahoo AAPL"},
                   "KBANK": {"price": 258.0, "ccy": "THB", "updated": d(0),
                             "src": "Yahoo KBANK.BK"}},
        "history": {"sectors": {"XLK": {"name": "Tech", "vsMA200": 5.0},
                                "XLU": {"name": "Util", "vsMA200": -3.0}}},
    }
    if with_signals and carry:
        p["signals"] = {"AAPL": sig("AAPL", 1, 3), "KBANK": sig("KBANK", 1, -1),
                        "SP500": sig("^GSPC", 1, 1)}
        p["risk"] = {"level": "normal", "severity": 0, "flags": [],
                     "breadth_sectors": 50.0, "breadth_portfolio": 100.0}
        p["signals_meta"] = {"count": 3, "generated_at": "x"}
    return p


def run(md_obj, chart_fn, http_fn=lambda *a, **k: None):
    td = tempfile.mkdtemp()
    mdp, hp = (os.path.join(td, "market-data.json"),
               os.path.join(td, "signal-history.json"))
    with open(mdp, "w", encoding="utf-8") as f:
        json.dump(md_obj, f)
    with mock.patch.object(fs, "MD", mdp), mock.patch.object(fs, "HIST", hp), \
         mock.patch.object(fs, "http_get", http_fn), \
         mock.patch.object(fs, "yahoo_chart", chart_fn), \
         mock.patch.object(fs, "warnings", []):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = fs.main()
    with open(mdp, encoding="utf-8") as f:
        out = json.load(f)
    with open(hp, encoding="utf-8") as f:
        hist = json.load(f)
    return rc, out, hist, buf.getvalue()


DEAD = (lambda s, r="1y", i="1d": ([], []))


def series(start, n=260):
    import math
    return [start * (1 + 0.0004 * k) * (1 + 0.02 * math.sin(k / 9))
            for k in range(n)]


DATES = [d(259 - k) for k in range(260)]   # ตัวสุดท้าย = วันนี้
ALIVE = (lambda s, r="1y", i="1d": (DATES, series(100.0)))


print("── Yahoo ล่มทั้งหมด · ไฟล์เดิมมีสัญญาณอยู่ ──────────────")
rc, out, hist, log = run(base_file(), DEAD)
check("สัญญาณรอบก่อนไม่หาย (3 ตัว)", len(out.get("signals") or {}) == 3,
      f"ได้ {list((out.get('signals') or {}).keys())}")
check("signals_meta บอกว่า fresh 0 · carried 3",
      out["signals_meta"]["fresh_this_run"] == 0
      and out["signals_meta"]["carried_over"] == 3,
      json.dumps(out["signals_meta"], ensure_ascii=False)[:120])
check("log บอกว่าคงของรอบก่อนไว้", "คงสัญญาณรอบก่อนไว้ 3 ตัว" in log)
check("วันที่ของสัญญาณยังเป็นวันเดิม ไม่ถูกฟอกเป็นวันนี้",
      out["signals"]["AAPL"]["updated"] == d(1),
      out["signals"]["AAPL"]["updated"])
check("ยังคืน exit 1 — job ต้องขึ้นแดง", rc == 1, str(rc))
# ประวัติต้องไม่บันทึกค่าที่ลอกมา ไม่งั้น backtest เห็นราคานิ่งปลอม ๆ
check("ประวัติวันนี้ไม่บันทึก asset ที่ลอกมาจากรอบก่อน",
      list(hist["days"].values())[0]["assets"] == {},
      json.dumps(list(hist["days"].values())[0]["assets"])[:80])

print("\n── ไม่เคยมีสัญญาณมาก่อน + Yahoo ล่ม ────────────────────")
rc2, out2, _, _ = run(base_file(with_signals=False), DEAD)
r2 = out2["risk"]
check("risk เป็น 'unknown' ไม่ใช่ 'normal'", r2["level"] == "unknown",
      r2["level"])
check("มีธงบอกว่าประเมินไม่ได้",
      any(f["k"] == "nodata" for f in r2["flags"]), json.dumps(r2["flags"])[:90])
check("basis_count = 0", r2["basis_count"] == 0, str(r2.get("basis_count")))

print("\n── Yahoo ล่ม แต่สัญญาณรอบก่อนยังไม่เก่าเกิน 7 วัน ──────")
rc3, out3, _, _ = run(base_file(), DEAD)
r3 = out3["risk"]
check("ยังประเมินความเสี่ยงได้จากของรอบก่อน", r3["level"] != "unknown",
      r3["level"])
check("basis_count นับจากสัญญาณที่ยังใช้ได้", r3["basis_count"] == 3,
      str(r3.get("basis_count")))

print("\n── สัญญาณรอบก่อนเก่าเกิน 7 วัน ─────────────────────────")
old = base_file()
for k in old["signals"]:
    old["signals"][k]["updated"] = d(20)
rc4, out4, _, _ = run(old, DEAD)
check("ของเก่ายังถูกเก็บไว้ในไฟล์ (ให้ frontend ตัดสินใจเอง)",
      len(out4["signals"]) == 3, str(len(out4.get("signals") or {})))
check("แต่ไม่ถูกนับเป็นฐานประเมินความเสี่ยง",
      out4["risk"]["level"] == "unknown" and out4["risk"]["basis_count"] == 0,
      f"{out4['risk']['level']} basis={out4['risk'].get('basis_count')}")

print("\n── รอบปกติ: ดึงได้ทับของเก่า ───────────────────────────")
rc5, out5, hist5, log5 = run(base_file(), ALIVE)
check("ตัวที่ดึงได้รอบนี้มีวันที่เป็นวันล่าสุด",
      out5["signals"]["AAPL"]["updated"] == d(0),
      out5["signals"]["AAPL"]["updated"])
check("carried_over = 0 เมื่อดึงได้ครบ",
      out5["signals_meta"]["carried_over"] == 0,
      str(out5["signals_meta"]["carried_over"]))
check("ประวัติบันทึก asset ครบ",
      len(list(hist5["days"].values())[0]["assets"]) == len(out5["signals"]),
      f"{len(list(hist5['days'].values())[0]['assets'])} vs {len(out5['signals'])}")
check("exit 0", rc5 == 0, str(rc5))

print("\n── ดึงได้บางตัว (KBANK ล่มตัวเดียว) ────────────────────")
def partial(s, r="1y", i="1d"):
    return ([], []) if s == "KBANK.BK" else (DATES, series(100.0))


rc6, out6, hist6, log6 = run(base_file(), partial)
check("KBANK คงของรอบก่อนไว้", out6["signals"]["KBANK"]["updated"] == d(1),
      out6["signals"]["KBANK"]["updated"])
check("AAPL เป็นของสด", out6["signals"]["AAPL"]["updated"] == d(0))
check("carried_over = 1", out6["signals_meta"]["carried_over"] == 1,
      str(out6["signals_meta"]["carried_over"]))
check("ประวัติไม่บันทึก KBANK ที่ลอกมา",
      "KBANK" not in list(hist6["days"].values())[0]["assets"],
      str(list(list(hist6["days"].values())[0]["assets"].keys())))

print("\n── จำลองพฤติกรรมก่อนแพตช์ fetch_market_data.py ─────────")
# ถ้า carry ไม่เกิดขึ้น (ไฟล์ยังไม่ถูกแพตช์) สัญญาณจะหายจริง — คุมไว้ให้เห็นชัด
rc7, out7, _, _ = run(base_file(carry=False), DEAD)
check("ยืนยันว่าถ้าไม่ carry สัญญาณจะหายจริง",
      out7.get("signals") == {},
      "ไม่หาย — แปลว่าการทดสอบนี้ไม่ได้วัดสิ่งที่คิด")
check("แต่ risk ยังรายงานตรงว่า unknown", out7["risk"]["level"] == "unknown")

print("\n─────────────────────────────────────────────")
if FAIL:
    print(f"❌ ไม่ผ่าน {FAIL} ข้อ")
    sys.exit(1)
print("✅ ผ่านทั้งหมด")
