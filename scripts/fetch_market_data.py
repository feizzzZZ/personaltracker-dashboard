#!/usr/bin/env python3
"""
Finance OS — market data pipeline  (v40)
────────────────────────────────────────────────────────────────────────
สร้าง market-data.json ให้ dashboard อ่าน

แก้จากรุ่นเดิม 3 เรื่อง:
  1. เดิมส่งมาแค่ 12 keys แต่ shared.js คาดหวัง ~35 → regime engine ใช้ได้แค่
     7/11 สัญญาณ  รุ่นนี้เติม US2Y, US_CORE_CPI, US_CORE_PCE, US_UNEMP,
     US_REAL10Y, OIL_WTI, DXY, NDX_RSI, NDX_MA200 + ราคาสินทรัพย์ครบ
  2. เดิมไม่มี history.sectors → หน้า Sectors ว่างถาวร  รุ่นนี้ดึง sector ETF
     10 ตัว พร้อม relative strength เทียบ SPY
  3. เดิมส่ง `updated` = observation date ของ FRED (CPI = ต้นเดือน) ซึ่ง shared.js
     เอาไปเทียบกับ timestamp ของชีต → ชีตชนะเสมอ  รุ่นนี้เพิ่ม `fetched_at`
     แยกจาก `updated` ให้ merge ตัดสินถูก

หลักการสำคัญ: ไฟล์เดิมถูกอ่านเข้ามา merge เสมอ — ถ้า API ตัวไหนล่ม
key นั้นจะคงค่าเดิมไว้ ไม่หายไปจากไฟล์ (ดีกว่าเขียนทับด้วยความว่าง)

รันเอง:  python3 scripts/fetch_market_data.py
ไม่ต้องใช้ API key และไม่ต้องติดตั้ง dependency ใดๆ (stdlib ล้วน)
"""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

OUT = os.environ.get("MARKET_DATA_OUT", "market-data.json")
UA = "Mozilla/5.0 (compatible; FinanceOS-pipeline/40)"
NOW = datetime.now(timezone.utc)
FETCHED_AT = NOW.isoformat()

_ctx = ssl.create_default_context()
warnings: list[str] = []


def warn(msg: str) -> None:
    warnings.append(msg)
    print(f"  ⚠️  {msg}", file=sys.stderr)


def http_get(url: str, tries: int = 3, timeout: int = 30) -> bytes | None:
    """GET แบบมี retry + backoff — API พวกนี้ rate-limit บ่อยตอน CI รันพร้อมกัน"""
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout, context=_ctx) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503) and attempt < tries - 1:
                time.sleep(2 ** attempt * 2)
                continue
            warn(f"HTTP {e.code} · {url[:80]}")
            return None
        except Exception as e:  # noqa: BLE001
            if attempt < tries - 1:
                time.sleep(2 ** attempt)
                continue
            warn(f"{type(e).__name__}: {e} · {url[:80]}")
            return None
    return None


# ══════════════════════════════════════════════════════════════════════
# FRED — ข้อมูลมหภาค (CSV endpoint สาธารณะ ไม่ต้องใช้ API key)
# ══════════════════════════════════════════════════════════════════════
def fred_series(series_id: str) -> list[tuple[str, float]]:
    """คืน [(date, value)] เรียงเก่า→ใหม่ ข้ามค่า '.' ที่ FRED ใช้แทน N/A"""
    raw = http_get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}")
    if not raw:
        return []
    out = []
    for line in raw.decode("utf-8", "replace").splitlines()[1:]:
        parts = line.split(",")
        if len(parts) < 2:
            continue
        d, v = parts[0].strip(), parts[1].strip()
        if not v or v == ".":
            continue
        try:
            out.append((d, float(v)))
        except ValueError:
            continue
    return out


def fred_latest(series_id: str):
    s = fred_series(series_id)
    return s[-1] if s else None


def fred_yoy(series_id: str):
    """YoY % สำหรับดัชนีระดับราคา (CPI/PCE) — ต้องมีอย่างน้อย 13 จุด"""
    s = fred_series(series_id)
    if len(s) < 13:
        return None
    (d, cur), (_, prev) = s[-1], s[-13]
    if prev == 0:
        return None
    return d, round((cur / prev - 1) * 100, 2)


def fred_mom_diff(series_id: str, scale: float = 1.0):
    """ผลต่างเดือนต่อเดือน — ใช้กับ PAYEMS เพื่อได้ NFP (พันตำแหน่ง)"""
    s = fred_series(series_id)
    if len(s) < 2:
        return None
    (d, cur), (_, prev) = s[-1], s[-2]
    return d, round((cur - prev) * scale, 1)


# ══════════════════════════════════════════════════════════════════════
# Yahoo Finance — ราคาสินทรัพย์
# ══════════════════════════════════════════════════════════════════════
def yahoo_chart(symbol: str, rng: str = "2y", interval: str = "1d"):
    """คืน (dates, closes) — กรอง null ที่ Yahoo ใส่มาในวันหยุดตลาดออก"""
    sym = urllib.parse.quote(symbol, safe="")
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
           f"?range={rng}&interval={interval}")
    raw = http_get(url)
    if not raw:
        return [], []
    try:
        j = json.loads(raw)
        res = j["chart"]["result"][0]
        ts = res["timestamp"]
        closes = res["indicators"]["quote"][0]["close"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError):
        warn(f"Yahoo: อ่านข้อมูล {symbol} ไม่ได้")
        return [], []
    dates, vals = [], []
    for t, c in zip(ts, closes):
        if c is None:
            continue
        dates.append(datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"))
        vals.append(float(c))
    return dates, vals


def rsi14(vals: list[float]) -> float | None:
    """Wilder RSI(14) — smoothing แบบ EMA ตามนิยามดั้งเดิม ไม่ใช่ SMA"""
    if len(vals) < 15:
        return None
    gains, losses = [], []
    for i in range(1, len(vals)):
        ch = vals[i] - vals[i - 1]
        gains.append(max(ch, 0.0))
        losses.append(max(-ch, 0.0))
    ag = sum(gains[:14]) / 14
    al = sum(losses[:14]) / 14
    for i in range(14, len(gains)):
        ag = (ag * 13 + gains[i]) / 14
        al = (al * 13 + losses[i]) / 14
    if al == 0:
        return 100.0
    return round(100 - 100 / (1 + ag / al), 1)


def pct_change(vals: list[float], days: int) -> float | None:
    if len(vals) <= days:
        return None
    return round((vals[-1] / vals[-1 - days] - 1) * 100, 2)


def weekly(dates: list[str], vals: list[float], years: int = 5):
    """ย่อเป็นรายสัปดาห์ — history 5 ปีรายวันใหญ่เกินจำเป็นสำหรับกราฟ benchmark"""
    cutoff = (NOW - timedelta(days=365 * years)).strftime("%Y-%m-%d")
    out, seen = [], set()
    for d, v in zip(dates, vals):
        if d < cutoff:
            continue
        y, w, _ = datetime.strptime(d, "%Y-%m-%d").isocalendar()
        if (y, w) in seen:
            continue
        seen.add((y, w))
        out.append([d, round(v, 4)])
    return out


# ══════════════════════════════════════════════════════════════════════
# เก็บผลลัพธ์
# ══════════════════════════════════════════════════════════════════════
data: dict = {}
history: dict = {}


def put(key: str, value, observed: str | None, note: str) -> None:
    if value is None:
        return
    data[key] = {
        "value": value,
        "updated": observed,        # วันที่ของ "ข้อมูล" (observation date)
        "fetched_at": FETCHED_AT,   # v40: เวลาที่ดึงจริง — shared.js ใช้ตัวนี้ตัดสิน merge
        "note": note,
    }


print("── FRED (macro) ─────────────────────────────")
FRED_LEVEL = [
    ("FED_RATE",      "DFEDTARU",     "FRED: target upper bound",   2),
    ("US10Y",         "DGS10",        "FRED: DGS10",                2),
    ("US2Y",          "DGS2",         "FRED: DGS2",                 2),
    ("US_REAL10Y",    "DFII10",       "FRED: 10Y TIPS real yield",  2),
    ("CREDIT_SPREAD", "BAMLH0A0HYM2", "FRED: HY OAS",               2),
    ("VIX",           "VIXCLS",       "FRED: VIXCLS",               2),
    ("US_UNEMP",      "UNRATE",       "FRED: UNRATE",               1),
    ("US_GDP",        "A191RL1Q225SBEA", "FRED: real GDP QoQ SAAR", 1),
]
for key, sid, note, nd in FRED_LEVEL:
    r = fred_latest(sid)
    if r:
        put(key, round(r[1], nd), r[0], note)
        print(f"  ✓ {key:<14} {r[1]}")

# yield curve เป็น percentage point ใน FRED แต่ dashboard แสดงเป็น bps
r = fred_latest("T10Y2Y")
if r:
    put("YIELD_CURVE", round(r[1] * 100), r[0], "FRED: 2s10s spread (bps)")
    print(f"  ✓ {'YIELD_CURVE':<14} {round(r[1]*100)}bps")

for key, sid, note in [
    ("US_CPI",       "CPIAUCSL", "FRED: CPIAUCSL YoY"),
    ("US_CORE_CPI",  "CPILFESL", "FRED: core CPI YoY"),
    ("US_PCE",       "PCEPI",    "FRED: PCEPI YoY"),
    ("US_CORE_PCE",  "PCEPILFE", "FRED: core PCE YoY"),
]:
    r = fred_yoy(sid)
    if r:
        put(key, r[1], r[0], note)
        print(f"  ✓ {key:<14} {r[1]}%")

r = fred_mom_diff("PAYEMS")
if r:
    put("NFP", r[1], r[0], "FRED: PAYEMS MoM change (K)")
    print(f"  ✓ {'NFP':<14} {r[1]}K")


print("── Yahoo (prices) ───────────────────────────")
PRICES = [
    ("SP500",     "^GSPC",     0, "Yahoo ^GSPC"),
    ("NASDAQ",    "^IXIC",     0, "Yahoo ^IXIC"),
    ("SET_INDEX", "^SET.BK",   2, "Yahoo ^SET.BK"),
    ("USDTHB",    "THB=X",     3, "Yahoo THB=X"),
    ("GOLD_XAU",  "GC=F",      1, "Yahoo GC=F"),
    ("GOLD_GLD",  "GLD",       2, "Yahoo GLD"),
    ("OIL_WTI",   "CL=F",      2, "Yahoo CL=F"),
    ("DXY",       "DX-Y.NYB",  2, "Yahoo DXY"),
    ("BTCUSD",    "BTC-USD",   0, "Yahoo BTC-USD"),
    ("ETHUSD",    "ETH-USD",   0, "Yahoo ETH-USD"),
]
closes_cache: dict[str, tuple[list, list]] = {}
for key, sym, nd, note in PRICES:
    d, v = yahoo_chart(sym, "2y", "1d")
    if not v:
        continue
    closes_cache[sym] = (d, v)
    put(key, round(v[-1], nd), d[-1], note)
    print(f"  ✓ {key:<14} {round(v[-1], nd)}")
    if key == "SP500" and len(v) > 1:
        chg = (v[-1] / v[-2] - 1) * 100
        put("SP500_CHG", round(chg, 2), d[-1], "Yahoo ^GSPC daily change")

# RSI + MA200 สำหรับ 3 ดัชนีหลัก
for key_rsi, key_ma, sym, label in [
    ("SP500_RSI", "SP500_MA200", "^GSPC",   "^GSPC"),
    ("SET_RSI",   "SET_MA200",   "^SET.BK", "^SET.BK"),
    ("NDX_RSI",   "NDX_MA200",   "^IXIC",   "^IXIC"),
]:
    d, v = closes_cache.get(sym, ([], []))
    if not v:
        continue
    r = rsi14(v)
    if r is not None:
        put(key_rsi, r, d[-1], f"Yahoo {label} RSI(14)")
    if len(v) >= 200:
        ma = sum(v[-200:]) / 200
        put(key_ma, "Above" if v[-1] > ma else "Below", d[-1],
            f"close {v[-1]:,.0f} vs MA200 {ma:,.0f}")
        print(f"  ✓ {key_ma:<14} {'Above' if v[-1] > ma else 'Below'}")


print("── History (benchmark) ──────────────────────")
for hkey, sym in [("SP500", "^GSPC"), ("USDTHB", "THB=X")]:
    d, v = yahoo_chart(sym, "5y", "1d")
    if v:
        history[hkey] = weekly(d, v, years=5)
        print(f"  ✓ {hkey:<14} {len(history[hkey])} จุด")


print("── Sectors (rotation) ───────────────────────")
# v40: เดิมไม่มีส่วนนี้เลย → loadSectors() คืน null → หน้า Sectors ว่างถาวร
SECTORS = [
    ("XLK",  "Technology"), ("XLV",  "Healthcare"),   ("XLF",  "Financials"),
    ("XLY",  "Cons. Disc."), ("XLP", "Cons. Staples"), ("XLI",  "Industrials"),
    ("XLE",  "Energy"),     ("XLU",  "Utilities"),    ("XLRE", "Real Estate"),
    ("XLB",  "Materials"),
]
spy_d, spy_v = yahoo_chart("SPY", "2y", "1d")
spy_1m = pct_change(spy_v, 21) if spy_v else None
spy_3m = pct_change(spy_v, 63) if spy_v else None

sectors: dict = {}
for sym, name in SECTORS:
    d, v = yahoo_chart(sym, "2y", "1d")
    if not v:
        continue
    c1m, c3m = pct_change(v, 21), pct_change(v, 63)
    entry = {"name": name, "chg1m": c1m, "chg3m": c3m, "rsi": rsi14(v)}
    if len(v) >= 200:
        ma = sum(v[-200:]) / 200
        entry["vsMA200"] = round((v[-1] / ma - 1) * 100, 2)
    # relative strength = ผลตอบแทนส่วนเกินเทียบ SPY (หน่วย percentage point)
    if c1m is not None and spy_1m is not None:
        entry["rs1m"] = round(c1m - spy_1m, 2)
    if c3m is not None and spy_3m is not None:
        entry["rs3m"] = round(c3m - spy_3m, 2)
    sectors[sym] = entry
    print(f"  ✓ {sym:<5} {name:<15} 3M {c3m}%  RS {entry.get('rs3m')}")
    time.sleep(0.3)   # กัน rate limit ของ Yahoo

if sectors:
    history["sectors"] = sectors


# ══════════════════════════════════════════════════════════════════════
# Merge กับไฟล์เดิม — key ที่ดึงไม่สำเร็จรอบนี้ต้องไม่หายไปจากไฟล์
# ══════════════════════════════════════════════════════════════════════
prev = {}
if os.path.exists(OUT):
    try:
        with open(OUT, encoding="utf-8") as f:
            prev = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        warn(f"อ่านไฟล์เดิมไม่ได้ ({e}) — เขียนใหม่ทั้งไฟล์")

merged_data = dict(prev.get("data", {}))
merged_data.update(data)
merged_hist = dict(prev.get("history", {}))
merged_hist.update(history)

payload = {
    "generated_at": FETCHED_AT,
    "source": "github-actions pipeline v40 (FRED + Yahoo)",
    "stats": {
        "keys_this_run": len(data),
        "keys_total": len(merged_data),
        "sectors": len(sectors),
        "warnings": warnings,
    },
    "data": merged_data,
    "history": merged_hist,
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=1)

print("─────────────────────────────────────────────")
print(f"เขียน {OUT}: {len(data)} keys รอบนี้ · {len(merged_data)} keys รวม · "
      f"{len(sectors)} sectors · {len(warnings)} warnings")

# ถ้าดึงได้น้อยกว่าครึ่งของที่ควรได้ = มีอะไรผิดปกติจริง ให้ workflow ฟ้อง
if len(data) < 15:
    print(f"::warning::ดึงได้แค่ {len(data)} keys (ปกติ ~30) — ตรวจสอบ warnings ด้านบน")
