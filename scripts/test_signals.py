#!/usr/bin/env python3
"""
ชุดทดสอบ scripts/fetch_signals.py — รันโดยไม่ต่อเน็ต

    python3 scripts/test_signals.py

ทดสอบเฉพาะส่วนที่ "ตัดสินใจ" ได้แก่ สูตรตัวชี้วัด เกณฑ์ให้คะแนน การอ่าน BLS
และการล้างค่า FRED ที่ค้าง — ส่วน network ไม่ทดสอบที่นี่ (probe_sources.py
ทำหน้าที่นั้นจาก GitHub Actions ซึ่งเป็นที่เดียวที่วัดได้จริง)
"""
import json
import os
import sys
import tempfile
import unittest.mock as mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_signals as fs                                        # noqa: E402

FAIL = 0


def check(name, cond, detail=""):
    global FAIL
    if cond:
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}  {detail}")


print("── ตัวชี้วัด ─────────────────────────────────")

# RSI ต้องตรงกับ fetch_market_data.py เป๊ะ — ถ้าสองไฟล์คำนวณคนละแบบ
# หน้า Macro กับสัญญาณรายตัวจะขัดกันเองโดยไม่มีใครเห็น
up = [100 + i for i in range(40)]
check("RSI ขาขึ้นล้วน = 100", fs.rsi14(up) == 100.0, f"ได้ {fs.rsi14(up)}")
down = [200 - i for i in range(40)]
check("RSI ขาลงล้วน = 0", fs.rsi14(down) == 0.0, f"ได้ {fs.rsi14(down)}")
check("RSI ข้อมูลน้อยกว่า 15 วัน คืน None", fs.rsi14([1, 2, 3]) is None)
flat = [100.0] * 40
check("RSI ราคานิ่ง คืน 100 (ไม่ใช่ crash)", fs.rsi14(flat) == 100.0)

check("pct_change 21 วัน", fs.pct_change([100.0] * 21 + [110.0], 21) == 10.0,
      f"ได้ {fs.pct_change([100.0]*21+[110.0], 21)}")
check("pct_change ข้อมูลไม่พอ คืน None", fs.pct_change([1.0, 2.0], 21) is None)
check("pct_change ฐานเป็นศูนย์ ไม่หารด้วยศูนย์",
      fs.pct_change([0.0] + [5.0] * 1, 1) is None)

check("sma ข้อมูลไม่พอ คืน None", fs.sma([1.0] * 10, 200) is None)
check("sma คำนวณถูก", fs.sma([1.0, 2.0, 3.0], 3) == 2.0)

rp = fs.range_pos([float(i) for i in range(1, 101)])
check("range_pos ที่จุดสูงสุด = 100 · drawdown 0", rp == (100.0, 0.0), f"ได้ {rp}")
rp2 = fs.range_pos([float(i) for i in range(100, 0, -1)])
check("range_pos ที่จุดต่ำสุด = 0", rp2 and rp2[0] == 0.0, f"ได้ {rp2}")
rp3 = fs.range_pos([100.0] * 60)
check("range_pos ราคานิ่ง ไม่หารด้วยศูนย์", rp3 == (50.0, 0.0), f"ได้ {rp3}")

check("zscore ข้อมูลนิ่ง (sd=0) คืน None", fs.zscore([5.0] * 60) is None)
z = fs.zscore([float(i) for i in range(1, 101)])
check("zscore ค่าล่าสุดสูงสุด เป็นบวก", z is not None and z > 1.5, f"ได้ {z}")

check("vol_annual ราคานิ่ง = 0", fs.vol_annual([100.0] * 40, 30) == 0.0)
check("vol_annual ข้อมูลไม่พอ คืน None", fs.vol_annual([100.0] * 10, 30) is None)


print("── เกณฑ์ 3 ชั้น: ประตู · อันดับ · ขนาดไม้ (v60) ──")
# v61 — เทสต์ชุดนี้เดิมทดสอบ "คะแนนรวม" (score = เทรนด์ + จังหวะ) ซึ่งถูกถอดออกใน v60
# เพราะมันเอา trend-following กับ mean-reversion มาบวกกัน แล้วสั่งลดของที่แข็งที่สุด
# (และพังมาตั้งแต่ signals v3 แล้ว: score_asset คืน 4 ค่า แต่เทสต์รับ 3)
# ตอนนี้ป้ายกำกับมาจาก label_of(ประตู, ขนาดไม้) — เจตนาของแต่ละข้อเดิมยังอยู่ครบ
BUY = {"ทยอยเข้าเพิ่ม", "เข้าได้ตามแผน", "เข้าได้ ลดขนาดไม้"}

def verdict(trend_up, mom, rsi, dd, pos):
    g, _ = fs.gate_of(trend_up, mom)
    sz, _ = fs.size_mult(rsi, dd, pos)
    return g, sz, fs.label_of(g, sz)

# จังหวะ DCA ที่ดีที่สุดตามนิยามที่ตั้งไว้: ย่อแรงแต่เทรนด์ยาวยังอยู่
g, sz, lab = verdict(True, 25.0, 28.0, -22.0, 10.0)
check("ย่อในเทรนด์ขาขึ้น + oversold → ทยอยเข้าเพิ่ม",
      g == "pass" and lab == "ทยอยเข้าเพิ่ม" and sz >= 1.25, f"ได้ {g} ×{sz} {lab}")

# กับดักที่ต้องไม่ติด: ราคาตกแรงแต่หลุดเทรนด์ยาวแล้ว ไม่ใช่ของถูก
g2, sz2, lab2 = verdict(False, -20.0, 28.0, -35.0, 5.0)
check("หลุด MA200 แม้ oversold หนัก → ไม่ผ่านประตู ไม่มีป้ายซื้อ",
      g2 == "fail" and lab2 not in BUY, f"ได้ {g2} ×{sz2} {lab2}")

# ของที่จุดสูงสุดในเทรนด์ขาขึ้น: ซื้อได้ แต่ไม้เล็ก (รุ่นเก่าสั่ง "ลดน้ำหนัก" — ผิด)
g3, sz3, lab3 = verdict(True, 30.0, 82.0, -0.5, 99.0)
check("ราคาสูงสุดรอบปี + overbought ในเทรนด์ขาขึ้น → ซื้อได้แต่ลดขนาดไม้",
      g3 == "pass" and lab3 == "เข้าได้ ลดขนาดไม้" and sz3 < 1.0, f"ได้ {g3} ×{sz3} {lab3}")

g4, sz4, lab4 = verdict(True, 10.0, 50.0, -5.0, 55.0)
check("เหนือ MA200 · ไม่มีอะไรผิดปกติ → เข้าได้ตามแผน",
      lab4 == "เข้าได้ตามแผน" and sz4 == 1.0, f"ได้ {g4} ×{sz4} {lab4}")

# ต้องผ่านทั้งสองอย่าง: เหนือ MA200 แต่โมเมนตัม 12-1 ติดลบ = ไม่ผ่าน
g4b, _, _ = verdict(True, -3.0, 40.0, -12.0, 30.0)
check("เหนือ MA200 แต่โมเมนตัม 12-1 ติดลบ → ไม่ผ่านประตู", g4b == "fail", f"ได้ {g4b}")

# ข้อมูลไม่ครบต้องไม่ทำให้เอียง — None ต้องแปลว่า "ไม่รู้" ไม่ใช่ "แย่"
g5, sz5, lab5 = verdict(None, None, None, None, None)
check("ไม่มีข้อมูลเลย → ยังไม่รู้ · ขนาดไม้ปกติ",
      g5 == "unknown" and sz5 == 1.0 and lab5 == "ข้อมูลไม่พอตัดสิน", f"ได้ {g5} ×{sz5} {lab5}")
g6, _, _ = verdict(None, 10.0, 50.0, -5.0, 50.0)
g7, _, _ = verdict(False, 10.0, 50.0, -5.0, 50.0)
check("MA200 ไม่รู้ ต้องไม่ถูกนับเท่ากับ 'ต่ำกว่า MA200'",
      g6 == "unknown" and g7 == "fail", f"ไม่รู้ {g6} · ต่ำกว่า {g7}")

check("ขนาดไม้ถูกจำกัดที่ ×0.5–1.5",
      all(0.5 <= fs.size_mult(r, d, p)[0] <= 1.5
          for r in (5.0, 29.0, 50.0, 65.0, 95.0, None)
          for d in (-60.0, -15.0, 0.0, None) for p in (0.0, 50.0, 100.0, None)))
check("ไม่ผ่านประตูแล้วไม่มีทางได้ป้ายซื้อ ไม่ว่าขนาดไม้เท่าไร",
      all(fs.label_of("fail", sz) not in BUY for sz in (0.5, 1.0, 1.25, 1.5)))
check("อันดับปรับด้วยความผันผวน: ขึ้น 40% แบบนิ่ง ชนะ 60% แบบเหวี่ยง",
      fs.rank_of(40.0, 10.0) > fs.rank_of(60.0, 30.0))
check("โมเมนตัม 12-1 ไม่นับเดือนล่าสุด",
      fs.mom12_1([100.0] * 232 + [110.0] * 21) == 0.0 and fs.mom12_1([100.0] * 252) is None)
# score_asset ยังคำนวณ "รายละเอียดประกอบ" (เทรนด์/จังหวะ) — คืน 4 ค่า และจังหวะไม่เกิน ±4
check("score_asset คืน (เทรนด์, จังหวะ, ป้าย, เหตุผล) และจังหวะอยู่ใน ±4",
      all(len(fs.score_asset(t, r, d, p)) == 4 and -4 <= fs.score_asset(t, r, d, p)[1] <= 4
          for t in (True, False, None) for r in (5.0, 50.0, 95.0)
          for d in (-40.0, 0.0) for p in (0.0, 100.0)))


print("── BLS ──────────────────────────────────────")


def _bls_body(rows, status="REQUEST_SUCCEEDED"):
    return json.dumps({"status": status,
                       "Results": {"series": [{"seriesID": "X", "data": rows}]}}
                      ).encode()


def _row(y, m, v):
    return {"year": str(y), "period": f"M{m:02d}", "value": str(v)}


rows = [_row(2026, 7, 110.0), _row(2026, 6, 109.0), _row(2025, 7, 100.0)]
with mock.patch.object(fs, "http_get", return_value=_bls_body(rows)):
    val, obs = fs.bls_yoy("X")
check("BLS YoY คำนวณจากเดือนเดียวกันปีก่อน", val == 10.0 and obs == "2026-07-01",
      f"ได้ {val} {obs}")

# M13 = ค่าเฉลี่ยทั้งปี ไม่ใช่ observation รายเดือน ถ้าไม่กรองจะได้ YoY ผิด
rows_m13 = [{"year": "2026", "period": "M13", "value": "999"}] + rows
with mock.patch.object(fs, "http_get", return_value=_bls_body(rows_m13)):
    val2, obs2 = fs.bls_yoy("X")
check("BLS ข้าม M13 (ค่าเฉลี่ยทั้งปี)", val2 == 10.0 and obs2 == "2026-07-01",
      f"ได้ {val2} {obs2}")

# ไม่มีเดือนเดียวกันของปีก่อน → คืน None ไม่ใช่เดาจากเดือนที่ใกล้ที่สุด
with mock.patch.object(fs, "http_get",
                       return_value=_bls_body([_row(2026, 7, 110.0), _row(2026, 6, 109.0)])):
    val3, obs3 = fs.bls_yoy("X")
check("BLS ไม่มีฐานปีก่อน → YoY เป็น None แต่ยังคืนวันที่", val3 is None and obs3 == "2026-07-01",
      f"ได้ {val3} {obs3}")

with mock.patch.object(fs, "http_get", return_value=_bls_body([], "REQUEST_NOT_PROCESSED")):
    val4, _ = fs.bls_yoy("X")
check("BLS status ไม่สำเร็จ → None", val4 is None)

with mock.patch.object(fs, "http_get", return_value=b"<html>rate limited</html>"):
    val5, _ = fs.bls_yoy("X")
check("BLS ตอบ HTML (โดน rate limit) → None ไม่ throw", val5 is None)

with mock.patch.object(fs, "http_get", return_value=_bls_body([_row(2026, 8, 4.2)])):
    lv, lobs = fs.bls_level("X")
check("bls_level คืนค่าล่าสุด", lv == 4.2 and lobs == "2026-08-01", f"ได้ {lv} {lobs}")


print("── ล้างค่า FRED ที่ค้าง ────────────────────────")

# เครื่องหมายที่ใช้แยกคือ "ไม่มี fetched_at" — entry ยุค FRED เท่านั้นที่เป็นแบบนี้
d = {
    "FED_RATE":   {"value": 3.75, "updated": "2026-07-28", "note": "FRED DFEDTARU"},
    "US_CPI":     {"value": 3.7,  "updated": "2026-06-01", "note": "FRED CPIAUCSL"},
    "US10Y":      {"value": 4.65, "updated": "2026-07-27", "note": "FRED DGS10"},
    "VIX":        {"value": 15.1, "updated": "2026-08-21", "fetched_at": "x",
                   "note": "Yahoo ^VIX"},
    "SP500":      {"value": 7674, "updated": "2026-08-21", "fetched_at": "x",
                   "note": "Yahoo ^GSPC"},
}
dropped = fs.purge_stale(d, {"US10Y"})
check("ลบ FED_RATE กับ US_CPI ที่ไม่มีใครเติมค่าใหม่",
      set(dropped) == {"FED_RATE", "US_CPI"}, f"ได้ {dropped}")
check("US10Y ที่รอบนี้เติมค่าใหม่ ต้องไม่ถูกลบ", "US10Y" in d)
check("key ของ Yahoo ต้องไม่ถูกแตะ", "VIX" in d and "SP500" in d)

# รันซ้ำต้องไม่ลบอะไรอีก (idempotent) — กันกรณี workflow รันสองครั้งในวันเดียว
check("รันซ้ำแล้วไม่มีอะไรให้ลบ", fs.purge_stale(d, {"US10Y"}) == [])

# ของที่เขียนใหม่ในรอบนี้ (มี fetched_at) ต้องไม่ถูกลบแม้ชื่ออยู่ในรายการ
d2 = {"CREDIT_SPREAD": {"value": 2.8, "fetched_at": "y", "note": "ของใหม่"}}
check("entry ใหม่ที่มี fetched_at ปลอดภัยเสมอ", fs.purge_stale(d2, set()) == [])


print("── sparkline ────────────────────────────────")
# ต้องจบที่ราคาล่าสุดเสมอ ไม่ใช่ราคาของเมื่อ 4 วันก่อน
v = [float(i) for i in range(1, 261)]
spark = [round(x, 4) for x in v[::-1][::5][::-1][-26:]]
check("sparkline จุดสุดท้าย = ราคาล่าสุด", spark[-1] == v[-1], f"ได้ {spark[-1]}")
check("sparkline ยาวไม่เกิน 26 จุด", len(spark) == 26, f"ได้ {len(spark)}")
check("sparkline เรียงจากเก่าไปใหม่", spark == sorted(spark))


print("── ไฟล์ประวัติ ──────────────────────────────")
with tempfile.TemporaryDirectory() as td:
    hp = os.path.join(td, "h.json")
    hist = {"schema": 1, "days": {f"2026-01-{i:02d}": {"x": i} for i in range(1, 29)}}
    with open(hp, "w") as f:
        json.dump(hist, f)
    # จำลองการตัดวันเก่าเมื่อเกินเพดาน
    cap = 10
    days = hist["days"]
    for old in sorted(days)[:len(days) - cap]:
        days.pop(old)
    check("ตัดวันเก่าทิ้งเมื่อเกินเพดาน", len(days) == cap, f"ได้ {len(days)}")
    check("วันที่เหลือคือวันใหม่ที่สุด", min(days) == "2026-01-19", f"ได้ {min(days)}")


print("─────────────────────────────────────────────")
if FAIL:
    print(f"❌ ไม่ผ่าน {FAIL} ข้อ")
    sys.exit(1)
print("✅ ผ่านทั้งหมด")
