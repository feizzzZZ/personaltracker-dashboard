#!/usr/bin/env python3
"""
สำรวจว่าแหล่งข้อมูลไหน "เข้าถึงได้จริงจาก GitHub Actions" ก่อนเขียน pipeline

ทำไมต้องมีขั้นนี้: v44 ตัด FRED ออกเพราะมันบล็อก IP ของ GitHub Actions
(fred_ok 0/14 · TimeoutError 42 ครั้ง) ขณะที่ Yahoo ผ่าน 23/23 ในรอบเดียวกัน
— ความต่างนี้มองไม่เห็นจากเครื่อง dev และเดาไม่ได้ ต้องวัดจากที่ที่โค้ดรันจริง

สคริปต์นี้ไม่เขียนไฟล์อะไร ไม่กระทบระบบเดิม รันแล้วอ่านผลอย่างเดียว

  python3 scripts/probe_sources.py

ผลที่ได้จะบอกว่าสัญญาณที่ตายอยู่ (Fed rate · yield curve · CPI · ว่างงาน ·
credit spread · real yield) เอากลับมาได้จากแหล่งไหน
"""
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

UA_BOT = "Mozilla/5.0 (compatible; FinanceOS-probe/1)"
CTX = ssl.create_default_context()
TIMEOUT = 15


def get(url, headers=None):
    """คืน (สถานะ, วินาทีที่ใช้, เนื้อหา 400 ตัวแรก) — ไม่ throw"""
    t0 = time.monotonic()
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA_BOT})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX) as r:
            body = r.read()
            return f"OK {r.status}", time.monotonic() - t0, body[:400]
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}", time.monotonic() - t0, e.read()[:200]
    except Exception as e:                                   # noqa: BLE001
        return f"{type(e).__name__}", time.monotonic() - t0, str(e)[:200].encode()


def yahoo_last(symbol):
    """ราคาปิดล่าสุดจาก Yahoo — endpoint เดียวกับที่ pipeline ใช้อยู่แล้ว"""
    u = ("https://query1.finance.yahoo.com/v8/finance/chart/"
         + urllib.parse.quote(symbol, safe="") + "?range=5d&interval=1d")
    st, dt, body = get(u)
    if not st.startswith("OK"):
        return st, dt, None
    try:
        res = json.loads(body if len(body) >= 400 else body)["chart"]["result"][0]
        closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
        return st, dt, round(closes[-1], 4) if closes else None
    except Exception:                                        # noqa: BLE001
        return st, dt, "(อ่านค่าไม่ได้ — body ถูกตัดที่ 400 ไบต์)"


def yahoo_full(symbol):
    """ดึงเต็ม ๆ เพื่ออ่านค่าจริง (ใช้เฉพาะตัวที่ผ่านแล้ว)"""
    u = ("https://query1.finance.yahoo.com/v8/finance/chart/"
         + urllib.parse.quote(symbol, safe="") + "?range=5d&interval=1d")
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA_BOT})
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX) as r:
            res = json.loads(r.read())["chart"]["result"][0]
            closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
            return round(closes[-1], 4) if closes else None
    except Exception:                                        # noqa: BLE001
        return None


# ══════════════════════════════════════════════════════════════════════
# สิ่งที่ต้องหาแหล่งใหม่ — สัญญาณที่ computeRegime() ใช้แต่ข้อมูลตายไปแล้ว
# ══════════════════════════════════════════════════════════════════════
YAHOO_CANDIDATES = [
    # (สัญลักษณ์, ใช้แทนอะไร, หน่วยที่คาด)
    ("^TNX",  "US10Y — ผลตอบแทนพันธบัตร 10 ปี",        "% เช่น 4.65"),
    ("^IRX",  "US3M — ตั๋วเงินคลัง 13 สัปดาห์",          "% เช่น 4.30"),
    ("^FVX",  "US5Y",                                    "% "),
    ("^TYX",  "US30Y",                                   "% "),
    ("2YY=F", "US2Y — สัญญาล่วงหน้าผลตอบแทน 2 ปี",     "% เช่น 4.31"),
    ("HYG",   "หุ้นกู้ผลตอบแทนสูง (ใช้ทำ credit spread proxy)", "$"),
    ("LQD",   "หุ้นกู้ระดับลงทุน",                        "$"),
    ("IEF",   "พันธบัตรรัฐบาล 7-10 ปี",                   "$"),
    ("TIP",   "TIPS (ใช้ประมาณ real yield)",              "$"),
    ("^VIX",  "VIX — ตัวที่ใช้อยู่แล้ว (ใช้เป็นกลุ่มควบคุม)", "จุด"),
]

OTHER_SOURCES = [
    ("US Treasury — เส้นอัตราผลตอบแทนรายวัน (มีครบทุกอายุ รวม 2Y)",
     "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
     "daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve"
     "&field_tdr_date_year=2026&page&_format=csv", None),

    ("BLS — CPI สหรัฐ (ไม่ต้องใช้ API key · 25 ครั้ง/วัน)",
     "https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0", None),

    ("BLS — อัตราว่างงานสหรัฐ",
     "https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000", None),

    ("World Bank — ตัวที่ใช้อยู่แล้ว (กลุ่มควบคุม)",
     "https://api.worldbank.org/v2/country/THA/indicator/FP.CPI.TOTL.ZG"
     "?format=json&per_page=2&mrnev=2", None),

    ("FRED — ทดสอบซ้ำว่ายังบล็อกอยู่ไหม (v44 เจอ 0/14)",
     "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10", None),

    ("Stooq — แหล่งสำรองฟรี ไม่ต้องใช้ key",
     "https://stooq.com/q/d/l/?s=%5Espx&i=d", None),
]


def main():
    now = datetime.now(timezone.utc)
    print("═" * 70)
    print(f"สำรวจแหล่งข้อมูล · {now:%Y-%m-%d %H:%M} UTC")
    print(f"python {sys.version.split()[0]} · timeout {TIMEOUT}s")
    print("═" * 70)

    print("\n┌─ Yahoo Finance ─────────────────────────────────────────────")
    print("│  pipeline ใช้ host นี้อยู่แล้วและผ่าน 23/23 — ถ้าตัวไหนที่นี่ล้ม")
    print("│  แปลว่าไม่มีสัญลักษณ์นั้นจริง ไม่ใช่ปัญหาเครือข่าย")
    y_ok = []
    for sym, what, unit in YAHOO_CANDIDATES:
        st, dt, val = yahoo_last(sym)
        good = st.startswith("OK") and val is not None
        if good:
            val = yahoo_full(sym)
            y_ok.append(sym)
        mark = "✓" if good else "✗"
        print(f"│ {mark} {sym:<8} {st:<12} {dt:5.2f}s  {str(val):<12} {what}")
    print("└─────────────────────────────────────────────────────────────")

    print("\n┌─ แหล่งอื่น ─────────────────────────────────────────────────")
    o_ok = []
    for name, url, _ in OTHER_SOURCES:
        st, dt, body = get(url)
        good = st.startswith("OK")
        if good:
            o_ok.append(name)
        mark = "✓" if good else "✗"
        print(f"│ {mark} {st:<14} {dt:5.2f}s  {name}")
        # ตัวอย่างข้อมูลบรรทัดแรก ช่วยยืนยันว่าได้ของจริง ไม่ใช่หน้า error
        sample = body.decode("utf-8", "replace").strip().replace("\n", " ")[:110]
        print(f"│     {sample}")
    print("└─────────────────────────────────────────────────────────────")

    print("\n" + "═" * 70)
    print("สรุป")
    print("═" * 70)
    print(f"  Yahoo ผ่าน {len(y_ok)}/{len(YAHOO_CANDIDATES)}: {', '.join(y_ok) or '(ไม่มี)'}")
    print(f"  แหล่งอื่นผ่าน {len(o_ok)}/{len(OTHER_SOURCES)}")
    for n in o_ok:
        print(f"    · {n}")

    print("\n  สัญญาณที่กู้กลับมาได้จากผลนี้:")
    have = set(y_ok)
    plan = [
        ("US10Y", "^TNX" in have, "^TNX"),
        ("Yield curve", "^TNX" in have and "^IRX" in have,
         "^TNX − ^IRX (3m10y — งานวิจัย Fed ชี้ว่าทำนาย recession ดีกว่า 2s10s)"),
        ("Credit spread proxy", "HYG" in have and "IEF" in have,
         "อัตราส่วน HYG/IEF แปลงเป็น z-score (ไม่ใช่ OAS จริง แต่บอกทิศทางได้)"),
        ("Real yield proxy", "TIP" in have and "IEF" in have, "อัตราส่วน TIP/IEF"),
    ]
    for name, ok, how in plan:
        print(f"    {'✓' if ok else '✗'} {name:<22} {how}")

    treasury_ok = any("Treasury" in n for n in o_ok)
    bls_ok = any("BLS" in n for n in o_ok)
    print(f"    {'✓' if treasury_ok else '✗'} US2Y ตัวจริง         "
          f"{'US Treasury CSV (มีครบทุกอายุ)' if treasury_ok else 'ต้องใช้ 2YY=F หรือ 3m10y แทน'}")
    print(f"    {'✓' if bls_ok else '✗'} CPI / อัตราว่างงาน     "
          f"{'BLS API' if bls_ok else 'ยังไม่มีแหล่ง — ต้องหาต่อ'}")

    print("\n  ⚠ ค่า FRED เดิมใน market-data.json (Fed rate, CPI, ว่างงาน ฯลฯ)")
    print("     ค้างอยู่ที่ มิ.ย.–ก.ค. 2026 และจะค้างต่อไปเรื่อย ๆ เพราะกลไก merge")
    print("     เก็บค่าเดิมไว้เสมอ — ต้องตัดสินใจว่าจะแทนที่หรือลบทิ้ง")
    print("═" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
