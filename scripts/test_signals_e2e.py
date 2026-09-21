#!/usr/bin/env python3
"""
ทดสอบ fetch_signals.py ทั้งกระบวนการ โดยปลอม network ทั้งหมด

    python3 scripts/test_signals_e2e.py

จุดประสงค์: พิสูจน์ว่าไฟล์ที่เขียนออกมา "หน้าตาถูก" ก่อนเอาไปรันบน Actions จริง
เพราะบน Actions ถ้าพังจะพังกับข้อมูลจริงในไฟล์จริง ซึ่งแก้คืนยากกว่า
รวมถึงกรณีที่ต้องรอดให้ได้: Yahoo ล่มบางตัว · BLS ล่ม · ไม่มีไฟล์ประวัติเดิม
"""
import json
import math
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


# ── ชุดข้อมูลปลอม ────────────────────────────────────────────────────
def series(start, n=260, drift=0.0004, amp=0.02):
    """ราคาสมมติที่มีทั้งเทรนด์และคลื่น — ไม่ใช่เส้นตรง เพื่อให้ RSI/vol มีค่าจริง"""
    return [start * (1 + drift) ** i * (1 + amp * math.sin(i / 9)) for i in range(n)]


DATES = [f"2026-{(i // 28) % 12 + 1:02d}-{i % 28 + 1:02d}" for i in range(260)]

YIELD_LAST = {"^IRX": 3.978, "2YY=F": 4.416, "^FVX": 4.856,
              "^TNX": 4.998, "^TYX": 5.331}


def fake_chart(symbol, rng="1y", interval="1d"):
    if symbol in YIELD_LAST:
        base = YIELD_LAST[symbol]
        v = [base * (1 + 0.01 * math.sin(i / 11)) for i in range(260)]
        v[-1] = base
        return DATES, v
    if symbol == "DEAD":
        return [], []
    # HYG กับ IEF ต้องเคลื่อนไหวคนละจังหวะ ไม่งั้นอัตราส่วนคงที่ → sd = 0
    # แล้ว zscore คืน None ทำให้ทดสอบ CREDIT_STRESS ไม่ได้เลย
    if symbol == "HYG":
        return DATES, series(78.0, drift=0.0002, amp=0.03)
    if symbol == "IEF":
        return DATES, series(90.0, drift=0.0006, amp=0.01)
    return DATES, series(100.0)


def bls_body(rows, status="REQUEST_SUCCEEDED"):
    return json.dumps({"status": status,
                       "Results": {"series": [{"data": rows}]}}).encode()


def row(y, m, v):
    return {"year": str(y), "period": f"M{m:02d}", "value": str(v)}


CPI_ROWS = [row(2026, 8, 312.0), row(2025, 8, 303.0)]
CORE_ROWS = [row(2026, 8, 330.0), row(2025, 8, 321.0)]
UNEMP_ROWS = [row(2026, 8, 4.3)]


def fake_http(url, tries=2, timeout=12):
    if "CUUR0000SA0L1E" in url:
        return bls_body(CORE_ROWS)
    if "CUUR0000SA0" in url:
        return bls_body(CPI_ROWS)
    if "LNS14000000" in url:
        return bls_body(UNEMP_ROWS)
    return None


BASE_MD = {
    "generated_at": "2026-09-20T00:00:00+00:00",
    "data": {
        # ค่าค้างยุค FRED — ไม่มี fetched_at
        "FED_RATE": {"value": 3.75, "updated": "2026-07-28", "note": "FRED DFEDTARU"},
        "US_CPI": {"value": 3.7, "updated": "2026-06-01", "note": "FRED CPIAUCSL"},
        "US_PCE": {"value": 4.1, "updated": "2026-05-01", "note": "FRED PCEPI"},
        "CREDIT_SPREAD": {"value": 2.81, "updated": "2026-07-27", "note": "FRED"},
        "US10Y": {"value": 4.65, "updated": "2026-07-27", "note": "FRED DGS10"},
        # ค่าปัจจุบันจาก Yahoo — มี fetched_at
        "VIX": {"value": 15.13, "updated": "2026-09-19",
                "fetched_at": "2026-09-19T00:00:00+00:00", "note": "Yahoo ^VIX"},
        "SP500": {"value": 7674.0, "updated": "2026-09-19",
                  "fetched_at": "2026-09-19T00:00:00+00:00", "note": "Yahoo ^GSPC"},
    },
    "history": {"sectors": {
        "XLK": {"name": "Technology", "price": 183.31, "vsMA200": 15.73},
        "XLV": {"name": "Healthcare", "price": 174.62, "vsMA200": 13.25},
        "XLU": {"name": "Utilities", "price": 42.77, "vsMA200": -4.42},
        "XLE": {"name": "Energy", "price": 63.64, "vsMA200": 18.07},
    }},
    "prices": {
        "AAPL": {"price": 309.35, "ccy": "USD", "updated": "2026-09-19",
                 "src": "Yahoo AAPL"},
        "KBANK": {"price": 257.0, "ccy": "THB", "updated": "2026-09-19",
                  "src": "Yahoo KBANK.BK"},
        "BTC": {"price": 78334.0, "ccy": "USD", "updated": "2026-09-19",
                "src": "Yahoo BTC-USD"},
        "Gold": {"price": 4661.6, "ccy": "USD", "updated": "2026-09-19",
                 "src": "Yahoo GC=F"},
        # ตัวที่ไม่ได้มาจาก Yahoo (กองทุนไทยในชีต) — ต้องถูกข้าม ไม่ใช่ crash
        "K-USA": {"price": 25.1, "ccy": "THB", "updated": "2026-09-19",
                  "src": "sheet Asset_Live_Price_Feed"},
    },
}


def run(md_obj, http=fake_http, chart=fake_chart, hist_obj=None):
    """รัน main() ในโฟลเดอร์ชั่วคราว คืน (rc, market-data, signal-history)"""
    td = tempfile.mkdtemp()
    mdp = os.path.join(td, "market-data.json")
    hp = os.path.join(td, "signal-history.json")
    with open(mdp, "w", encoding="utf-8") as f:
        json.dump(md_obj, f)
    if hist_obj is not None:
        with open(hp, "w", encoding="utf-8") as f:
            json.dump(hist_obj, f)
    with mock.patch.object(fs, "MD", mdp), mock.patch.object(fs, "HIST", hp), \
         mock.patch.object(fs, "http_get", http), \
         mock.patch.object(fs, "yahoo_chart", chart), \
         mock.patch.object(fs, "warnings", []):
        rc = fs.main()
    with open(mdp, encoding="utf-8") as f:
        out = json.load(f)
    with open(hp, encoding="utf-8") as f:
        hist = json.load(f)
    return rc, out, hist


print("══ กรณีปกติ ════════════════════════════════════")
rc, out, hist = run(json.loads(json.dumps(BASE_MD)))
check("จบด้วยรหัส 0", rc == 0, f"ได้ {rc}")

d = out["data"]
print("── macro ────────────────────────────────────")
check("US10Y มาจาก ^TNX ไม่ใช่ค่า FRED เดิม",
      d["US10Y"]["value"] == 4.998 and "fetched_at" in d["US10Y"],
      f"ได้ {d.get('US10Y')}")
check("US2Y มาจาก 2YY=F", d["US2Y"]["value"] == 4.416, f"ได้ {d.get('US2Y')}")
# 2s10s = 4.998 − 4.416 = 0.582% = 58 bps  (ปัดขึ้นเป็น 58)
check("YIELD_CURVE = 2s10s ตัวจริง 58 bps",
      d["YIELD_CURVE"]["value"] == 58, f"ได้ {d.get('YIELD_CURVE')}")
check("3m10y แยก key ไม่ทับ 2s10s",
      d["YIELD_CURVE_3M10Y"]["value"] == 102, f"ได้ {d.get('YIELD_CURVE_3M10Y')}")
# CPI: 312/303 − 1 = 2.97%
check("US_CPI มาจาก BLS ไม่ใช่ค่าค้าง 3.7",
      d["US_CPI"]["value"] == 2.97 and d["US_CPI"]["updated"] == "2026-08-01",
      f"ได้ {d.get('US_CPI')}")
check("US_CORE_CPI มาจาก BLS", d["US_CORE_CPI"]["value"] == 2.8,
      f"ได้ {d.get('US_CORE_CPI')}")
check("US_UNEMP มาจาก BLS", d["US_UNEMP"]["value"] == 4.3, f"ได้ {d.get('US_UNEMP')}")
# real = 4.998 − 2.97 = 2.03
check("US_REAL10Y = 10Y − CPI (ex-post)", d["US_REAL10Y"]["value"] == 2.03,
      f"ได้ {d.get('US_REAL10Y')}")
check("CREDIT_STRESS เป็น key ใหม่ ไม่ทับ CREDIT_SPREAD",
      "CREDIT_STRESS" in d, f"keys {sorted(d)}")
check("หน่วยของ CREDIT_STRESS เป็น SD ไม่ใช่ %",
      "SD" not in str(d["CREDIT_STRESS"]["value"]) and
      "ไม่ใช่ HY OAS" in d["CREDIT_STRESS"]["note"])

print("── ล้างค่าค้าง ───────────────────────────────")
for k in ("FED_RATE", "US_PCE", "CREDIT_SPREAD"):
    check(f"{k} ถูกลบ (ไม่มีแหล่งใหม่ + ไม่มี fetched_at)", k not in d,
          f"ยังอยู่: {d.get(k)}")
check("VIX/SP500 ของ Yahoo ไม่ถูกแตะ", "VIX" in d and "SP500" in d)
check("signals_meta บันทึกว่าลบอะไรไป",
      set(out["signals_meta"]["dropped_stale_fred"]) == {"FED_RATE", "US_PCE",
                                                         "CREDIT_SPREAD"},
      f"ได้ {out['signals_meta']['dropped_stale_fred']}")

print("── สัญญาณรายตัว ──────────────────────────────")
sg = out["signals"]
check("ได้สัญญาณครบทุกตัวที่มาจาก Yahoo + 3 ดัชนี",
      set(sg) == {"AAPL", "KBANK", "BTC", "Gold", "SP500", "NASDAQ", "SET"},
      f"ได้ {sorted(sg)}")
check("ตัวที่ราคามาจากชีต (K-USA) ถูกข้าม ไม่ crash", "K-USA" not in sg)
check("symbol ถูก map ถูก (KBANK → KBANK.BK)", sg["KBANK"]["sym"] == "KBANK.BK",
      f"ได้ {sg['KBANK']['sym']}")
one = sg["AAPL"]
check("มีครบทุกฟิลด์ที่หน้าเว็บจะใช้",
      all(k in one for k in ("price", "rsi", "ma50", "ma200", "chg1m", "chg3m",
                             "pos52w", "drawdown", "vol30d", "score", "action",
                             "why", "spark", "updated")),
      f"ขาด {[k for k in ('price','rsi','ma50','ma200','chg1m','chg3m','pos52w','drawdown','vol30d','score','action','why','spark','updated') if k not in one]}")
check("sparkline ไม่เกิน 26 จุด", len(one["spark"]) <= 26, f"ได้ {len(one['spark'])}")
check("sparkline จบที่ราคาล่าสุด", one["spark"][-1] == round(one["price"], 4),
      f"{one['spark'][-1]} vs {one['price']}")
check("คะแนนอยู่ในช่วง ±4", all(-4 <= e["score"] <= 4 for e in sg.values()))
check("ทุกตัวมีคำอธิบายเหตุผล", all(isinstance(e["why"], list) for e in sg.values()))

print("── ความเสี่ยงระดับตลาด ────────────────────────")
r = out["risk"]
# 3 ใน 4 sector เหนือ MA200 = 75%
check("breadth sector คำนวณจาก vsMA200", r["breadth_sectors"] == 75.0,
      f"ได้ {r['breadth_sectors']}")
check("มีระดับความเสี่ยง", r["level"] in ("normal", "elevated", "high"))
check("VIX 15 ไม่ติดธงเตือน", not any(f["k"] == "vix" for f in r["flags"]))

print("── ไฟล์ประวัติ ──────────────────────────────")
day = list(hist["days"].values())[0]
check("มี snapshot ของวันนี้", fs.TODAY in hist["days"], f"ได้ {list(hist['days'])}")
check("snapshot เก็บ macro", "US10Y" in day["macro"])
check("snapshot เก็บ [ราคา, RSI, คะแนน] ต่อสินทรัพย์",
      len(day["assets"]["AAPL"]) == 3, f"ได้ {day['assets'].get('AAPL')}")
check("snapshot เก็บระดับความเสี่ยง", "level" in day["risk"])

# เขียนต่อจากไฟล์เดิม ต้องไม่ล้างของเก่า
old = {"schema": 1, "days": {"2026-09-01": {"macro": {}, "assets": {}, "risk": {}}}}
rc2, _, hist2 = run(json.loads(json.dumps(BASE_MD)), hist_obj=old)
check("เขียนต่อจากไฟล์ประวัติเดิม ไม่ทับทิ้ง",
      "2026-09-01" in hist2["days"] and fs.TODAY in hist2["days"],
      f"ได้ {sorted(hist2['days'])}")

# ไฟล์ประวัติเสียหาย ต้องเริ่มใหม่ ไม่ crash
rc3, _, hist3 = run(json.loads(json.dumps(BASE_MD)), hist_obj={"broken": True})
check("ไฟล์ประวัติผิดรูปแบบ → เริ่มใหม่ ไม่ crash",
      rc3 == 0 and fs.TODAY in hist3["days"], f"rc={rc3}")


print("\n══ กรณี BLS ล่ม ════════════════════════════════")
rc4, out4, _ = run(json.loads(json.dumps(BASE_MD)), http=lambda *a, **k: None)
d4 = out4["data"]
check("ยังจบด้วยรหัส 0 (yields ยังได้)", rc4 == 0, f"ได้ {rc4}")
check("ได้ yields ครบแม้ BLS ล่ม", d4["US10Y"]["value"] == 4.998)
check("US_CPI ที่ค้างถูกลบทิ้ง ไม่โชว์ค่าเดือน มิ.ย. ต่อ", "US_CPI" not in d4,
      f"ยังอยู่: {d4.get('US_CPI')}")
check("ไม่มี US_REAL10Y เมื่อไม่มี CPI (ไม่เดา)", "US_REAL10Y" not in d4)


print("\n══ กรณี Yahoo ล่มทั้งหมด ═══════════════════════")
rc5, out5, _ = run(json.loads(json.dumps(BASE_MD)),
                   http=lambda *a, **k: None,
                   chart=lambda s, r="1y", i="1d": ([], []))
check("จบด้วยรหัส 1 — workflow ต้องไม่รายงานว่าสำเร็จ", rc5 == 1, f"ได้ {rc5}")
check("ไฟล์ยังถูกเขียน ข้อมูลเดิมไม่หาย", out5["data"].get("VIX") is not None)


print("\n══ กรณีสินทรัพย์ใหม่ ข้อมูลไม่ถึง 200 วัน ══════")
short_md = json.loads(json.dumps(BASE_MD))
short_md["prices"] = {"NEW": {"price": 10.0, "ccy": "USD", "updated": "2026-09-19",
                              "src": "Yahoo NEWCO"}}


def short_chart(symbol, rng="1y", interval="1d"):
    if symbol == "NEWCO":
        return DATES[:60], series(10.0, 60)
    return fake_chart(symbol, rng, interval)


rc6, out6, _ = run(short_md, chart=short_chart)
n = out6["signals"]["NEW"]
check("MA200 เป็น None เมื่อข้อมูลไม่พอ (ไม่ใช่ 'Below')", n["ma200"] is None,
      f"ได้ {n['ma200']}")
check("ไม่ถูกลงโทษว่าเทรนด์หัก",
      "MA200" not in " ".join(n["why"]), f"ได้ {n['why']}")


print("\n══ กรณีตลาดเครียด ════════════════════════════")
stress_md = json.loads(json.dumps(BASE_MD))
stress_md["data"]["VIX"] = {"value": 34.0, "updated": "2026-09-19",
                            "fetched_at": "x", "note": "Yahoo ^VIX"}
for k in stress_md["history"]["sectors"]:
    stress_md["history"]["sectors"][k]["vsMA200"] = -8.0
rc7, out7, _ = run(stress_md)
r7 = out7["risk"]
check("VIX 34 ติดธงระดับ 2", any(f["k"] == "vix" and f["sev"] == 2 for f in r7["flags"]),
      f"ได้ {r7['flags']}")
check("breadth 0% ติดธง", any(f["k"] == "breadth" for f in r7["flags"]))
check("ระดับความเสี่ยงขึ้นเป็น high", r7["level"] == "high",
      f"ได้ {r7['level']} severity {r7['severity']}")

print("─────────────────────────────────────────────")
if FAIL:
    print(f"❌ ไม่ผ่าน {FAIL} ข้อ")
    sys.exit(1)
print("✅ ผ่านทั้งหมด")
