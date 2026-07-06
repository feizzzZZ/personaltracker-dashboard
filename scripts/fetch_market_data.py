#!/usr/bin/env python3
"""
Finance OS — Market Data Pipeline (Method 3)
═════════════════════════════════════════════
Extract : FRED (keyless CSV) + Yahoo Finance (keyless chart API)
Transform: YoY %, MoM change, RSI(14), MA200, yield spread
Load    : market-data.json  (dashboard fetch same-origin — ไม่ติด CORS)

รันโดย GitHub Actions ทุกเช้า (ดู .github/workflows/market-data.yml)
ทุก series ห่อ try/except แยกกัน — ตัวไหนล้มตัวอื่นไปต่อ ไม่มีวันได้ไฟล์ว่าง
"""
import json, sys, urllib.request
from datetime import datetime, timezone

UA = {"User-Agent": "Mozilla/5.0 (FinanceOS personal dashboard; +github pages)"}
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
out = {}   # KEY -> {value, updated, note}


def put(key, value, updated=None, note=""):
    out[key] = {"value": value, "updated": updated or TODAY, "note": note}
    print(f"  ✓ {key:<14} = {value}  ({note or updated or TODAY})")


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()


# ── FRED: keyless CSV endpoint ──────────────────────────────────────
def fred_series(series_id, last_n=400):
    """คืน list[(date, float)] เรียงเก่า→ใหม่ ข้ามค่าว่าง '.'"""
    csv = fetch(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}")
    rows = []
    for line in csv.strip().splitlines()[1:]:
        d, v = line.split(",")[0], line.split(",")[1]
        if v not in (".", ""):
            rows.append((d, float(v)))
    return rows[-last_n:]


def yoy(rows):
    """YoY % จาก series รายเดือน: (ล่าสุด / 12 เดือนก่อน - 1) * 100"""
    if len(rows) < 13:
        raise ValueError("series too short")
    d, latest = rows[-1]
    _, year_ago = rows[-13]
    return round((latest / year_ago - 1) * 100, 1), d


# ── Yahoo: keyless chart API ────────────────────────────────────────
def yahoo_closes(symbol, range_="1y"):
    j = json.loads(fetch(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?range={range_}&interval=1d"))
    res = j["chart"]["result"][0]
    closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
    return closes


def rsi14(closes):
    """Wilder's RSI(14) มาตรฐานเดียวกับ TradingView"""
    if len(closes) < 15:
        raise ValueError("not enough data")
    gains, losses = [], []
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i - 1]
        gains.append(max(ch, 0)); losses.append(max(-ch, 0))
    ag = sum(gains[:14]) / 14; al = sum(losses[:14]) / 14
    for i in range(14, len(gains)):
        ag = (ag * 13 + gains[i]) / 14
        al = (al * 13 + losses[i]) / 14
    if al == 0:
        return 100.0
    return round(100 - 100 / (1 + ag / al), 0)


def run():
    print("── FRED ──")
    try:  # Fed Funds target (upper bound, daily)
        rows = fred_series("DFEDTARU", 10)
        put("FED_RATE", rows[-1][1], rows[-1][0], "FRED: target upper bound")
    except Exception as e: print(f"  ✗ FED_RATE: {e}")

    try:  # US CPI YoY
        v, d = yoy(fred_series("CPIAUCSL", 30))
        put("US_CPI", v, d, "FRED: CPIAUCSL YoY")
    except Exception as e: print(f"  ✗ US_CPI: {e}")

    try:  # US PCE YoY
        v, d = yoy(fred_series("PCEPI", 30))
        put("US_PCE", v, d, "FRED: PCEPI YoY")
    except Exception as e: print(f"  ✗ US_PCE: {e}")

    try:  # NFP = การจ้างงานเปลี่ยนแปลง MoM (พันตำแหน่ง)
        rows = fred_series("PAYEMS", 4)
        chg = round(rows[-1][1] - rows[-2][1])
        put("NFP", chg, rows[-1][0], "FRED: PAYEMS MoM change (K)")
    except Exception as e: print(f"  ✗ NFP: {e}")

    try:  # 10Y, 2Y, yield curve
        t10 = fred_series("DGS10", 10); t2 = fred_series("DGS2", 10)
        put("US10Y", t10[-1][1], t10[-1][0], "FRED: DGS10")
        put("YIELD_CURVE", round((t10[-1][1] - t2[-1][1]) * 100), t10[-1][0],
            "FRED: 2s10s spread (bps)")
    except Exception as e: print(f"  ✗ US10Y/CURVE: {e}")

    try:  # HY spread
        rows = fred_series("BAMLH0A0HYM2", 10)
        put("CREDIT_SPREAD", rows[-1][1], rows[-1][0], "FRED: HY OAS")
    except Exception as e: print(f"  ✗ CREDIT_SPREAD: {e}")

    try:  # VIX (FRED มีเหมือนกัน — สำรองจากชีต)
        rows = fred_series("VIXCLS", 10)
        put("VIX", rows[-1][1], rows[-1][0], "FRED: VIXCLS")
    except Exception as e: print(f"  ✗ VIX: {e}")

    print("── Yahoo Finance ──")
    try:  # S&P 500 technicals
        closes = yahoo_closes("^GSPC")
        put("SP500_RSI", rsi14(closes), TODAY, "Yahoo ^GSPC RSI(14)")
        if len(closes) >= 200:
            ma = sum(closes[-200:]) / 200
            put("SP500_MA200", "Above" if closes[-1] > ma else "Below",
                TODAY, f"close {closes[-1]:,.0f} vs MA200 {ma:,.0f}")
    except Exception as e: print(f"  ✗ SP500 technicals: {e}")

    try:  # SET index technicals (สัญลักษณ์ Yahoo อาจไม่เสถียร — ล้มได้ไม่เป็นไร)
        closes = yahoo_closes("%5ESET.BK")
        put("SET_RSI", rsi14(closes), TODAY, "Yahoo ^SET.BK RSI(14)")
        if len(closes) >= 200:
            ma = sum(closes[-200:]) / 200
            put("SET_MA200", "Above" if closes[-1] > ma else "Below",
                TODAY, f"close {closes[-1]:,.1f} vs MA200 {ma:,.1f}")
    except Exception as e: print(f"  ✗ SET technicals: {e} (ใส่มือในชีตแทนได้)")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "github-actions pipeline (FRED + Yahoo)",
        "data": out,
    }
    with open("market-data.json", "w") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f"\n→ market-data.json: {len(out)} keys")
    if len(out) == 0:
        sys.exit(1)   # ทุก series ล้ม = อย่า commit ไฟล์ว่างทับของดี


if __name__ == "__main__":
    run()
