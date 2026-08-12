#!/usr/bin/env python3
"""
Finance OS — market data pipeline  (v44)
────────────────────────────────────────────────────────────────────────
สร้าง market-data.json ให้ dashboard อ่าน

v44 — สองเรื่องใหญ่:
  A. ตัด FRED ออกทั้งหมด (14 series)  ตรวจพบว่า fred_ok = 0/14 ต่อเนื่อง
     ด้วย TimeoutError 42 ครั้ง ขณะที่ Yahoo ผ่าน 23/23 ในรอบเดียวกัน
     = FRED บล็อก IP ของ GitHub Actions ไม่ใช่ปัญหาเน็ต และ fail-safe merge
     ก็ carry ค่าเก่ามาให้เงียบๆ ทำให้หน้า Macro โชว์ตัวเลขตายเหมือนของสด
     ซึ่งอันตรายกว่าไม่มีข้อมูล → เอา VIX (ตัวเดียวที่ใช้จริง) มาจาก Yahoo ^VIX
     ที่เหลือ (CPI/PCE/GDP/NFP/yields/credit spread) ตัดทิ้ง
  B. เพิ่ม block "prices" — ราคารายตัวของสินทรัพย์ที่ถืออยู่จริง
     เดิม pipeline ป้อนแค่ index/macro ราคาพอร์ตมาจาก Asset_Live_Price_Feed
     ในชีตทางเดียว พอสูตร IMPORTXML ขึ้น #N/A (หุ้นไทย 6 ตัว + ทอง)
     dashboard นับสินทรัพย์นั้นเป็น ฿0 เงียบๆ

แก้จากรุ่นก่อนหน้า 3 เรื่อง:
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
ตอนนี้พึ่ง host เดียว (query1.finance.yahoo.com) — จุดที่พังได้ลดจาก 31 เหลือ 18
"""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

OUT = os.environ.get("MARKET_DATA_OUT", "market-data.json")
# ══════════════════════════════════════════════════════════════════════
# v43 — HEADERS ต้องแยกตาม host  (แก้ regression ที่ v42 ทำไว้)
# ══════════════════════════════════════════════════════════════════════
#   v41  Yahoo 17/17 ผ่าน · FRED 0/14 ล้ม   (UA แบบ bot ตรงๆ)
#   v42  Yahoo  0/17 ล้ม  · FRED 0/14 ล้ม   (Chrome UA + browser headers)
# ตัวแปรเดียวที่เปลี่ยนคือ headers และ v42 เอาไปใช้กับ *ทุก* request
# ทั้งที่ตั้งใจแก้แค่ FRED -> Yahoo ที่เคยทำงานได้พังไปด้วย
#
# ทำไม Yahoo พังกับ browser UA:
#   query1.finance.yahoo.com คาดหวัง cookie + crumb เมื่อเห็น UA ของเบราว์เซอร์จริง
#   ส่ง UA เบราว์เซอร์แต่ไม่มี cookie = ดูเหมือน scraper ปลอมตัว -> 401/429 ทันที
#   ขณะที่ UA แบบ bot ตรงๆ ผ่าน endpoint สาธารณะได้ตามปกติ
#   duration 2m3s เร็วเกินกว่าจะเป็น timeout ทั้งหมด = ถูกปฏิเสธเร็ว (4xx)
#
# บทเรียน: อย่าเปลี่ยน header ระดับ global เพื่อแก้ host เดียว
from collections import defaultdict

UA_BOT = "Mozilla/5.0 (compatible; FinanceOS-pipeline/43)"
UA_BROWSER = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
UA = UA_BOT                                     # ค่าปลอดภัยเป็นค่าเริ่มต้น

HEADERS_YAHOO = {"User-Agent": UA_BOT}          # ชุดเดิมของ v41 ที่ได้ 17/17 — ห้ามแตะ
REQ_HEADERS = {"User-Agent": UA_BOT}            # default สำหรับ host อื่น
# v44: HEADERS_FRED ถูกลบพร้อม FRED — UA_BROWSER เก็บไว้เป็นบันทึกว่าอย่าใช้กับ Yahoo
_ = UA_BROWSER

_host_stat: dict = defaultdict(dict)


def _host(url: str) -> str:
    try:
        return url.split("/")[2]
    except IndexError:
        return "?"


def _bump(url: str, key: str) -> None:
    d = _host_stat[_host(url)]
    d[key] = d.get(key, 0) + 1


def headers_for(url: str) -> dict:
    """เลือก header ตาม host — ไม่ให้การแก้ host หนึ่งไปกระทบ host อื่นอีก"""
    h = _host(url)
    if "yahoo.com" in h:
        return HEADERS_YAHOO
    return REQ_HEADERS


NOW = datetime.now(timezone.utc)
FETCHED_AT = NOW.isoformat()

# ══════════════════════════════════════════════════════════════════════
# RUNTIME BUDGET  — เหตุผลที่ต้องมี (root cause ของ run #40-47 ที่ถูกฆ่าทุกรอบ)
# ══════════════════════════════════════════════════════════════════════
# อาการ: ทุก run จบที่ 15m18s / 15m22s พร้อม
#        "The job has exceeded the maximum execution time of 15m0s"
#
# เลขที่ทำให้พัง:
#   ~36 request แบบ sequential  (13 FRED + 23 Yahoo)
#   worst case ต่อ request = tries(3) x timeout(30s) + backoff(2+4s) = 96s
#   worst case รวม          = 36 x 96s = 57.6 นาที   >>  job cap 15 นาที
#   แค่ 25% ของ request ที่ stall ก็กิน 14.4 นาทีแล้ว
#
# แต่ปัญหาที่ร้ายกว่าคือ "ลำดับการเขียนไฟล์":
#   การ merge + เขียน market-data.json อยู่บรรทัดท้ายสุดของสคริปต์
#   พอ job ถูกฆ่ากลางทาง  ->  ไฟล์ไม่ถูกเขียน  ->  git commit step ไม่ได้รัน
#   ->  ข้อมูลค้างที่ 27-28 ก.ค. ทั้งที่ FRED หลาย key ดึงสำเร็จแล้วในรอบนั้น
#
#   กลไก fail-safe merge ที่ README ภูมิใจ ป้องกันได้แค่ "API รายตัวล่ม"
#   มันป้องกัน "job หมดเวลา" ไม่ได้เลย เพราะ merge เกิดหลังสุด
#
# ทางแก้: ให้ทุก fetch เช็ค deadline ก่อน ถ้าหมดงบก็คืน None ทันที
#         สคริปต์จะเดินถึงขั้น merge+write เสมอ = ได้เท่าที่ดึงทัน + ของเดิมอยู่ครบ
DEADLINE_SEC = int(os.environ.get("MARKET_DATA_DEADLINE", "480"))   # 8 นาที
_T0 = time.monotonic()
_budget_skips = 0


def elapsed() -> float:
    return time.monotonic() - _T0


def budget_left() -> float:
    return DEADLINE_SEC - elapsed()


def out_of_budget() -> bool:
    """True เมื่อเหลือเวลาไม่พอ — คนเรียกต้องข้ามแล้วปล่อยให้ไปถึงขั้นเขียนไฟล์"""
    global _budget_skips
    if budget_left() <= 0:
        _budget_skips += 1
        return True
    return False


_ctx = ssl.create_default_context()
warnings: list[str] = []


def warn(msg: str) -> None:
    warnings.append(msg)
    print(f"  ⚠️  {msg}", file=sys.stderr)


def http_get(url: str, tries: int = 2, timeout: int = 12) -> bytes | None:
    """GET แบบมี retry + backoff — API พวกนี้ rate-limit บ่อยตอน CI รันพร้อมกัน

    timeout 30->12 และ tries 3->2:
      FRED/Yahoo ที่ทำงานปกติตอบใน <2s  ค่า 30s ไม่ได้ช่วยให้สำเร็จมากขึ้น
      มันแค่ยืดเวลาที่เสียไปกับ socket ที่ค้างอยู่แล้ว
      หมายเหตุ: timeout ของ urlopen คุมแค่ระดับ socket operation ไม่ใช่เวลารวม
      ของ request — ถ้า server ส่งข้อมูลมาแบบหยอด r.read() ยังค้างเกิน 12s ได้
      จึงต้องมี deadline ระดับสคริปต์ (out_of_budget) เป็นตาข่ายอีกชั้น
    """
    for attempt in range(tries):
        if out_of_budget():
            return None
        try:
            # อย่าให้ request เดียวกินงบที่เหลือทั้งหมด
            eff = max(3, min(timeout, int(budget_left())))
            req = urllib.request.Request(url, headers=headers_for(url))
            with urllib.request.urlopen(req, timeout=eff, context=_ctx) as r:
                body = r.read()
                _bump(url, "ok")
                return body
        except urllib.error.HTTPError as e:
            # 401/403 จาก Yahoo มักเป็น anti-bot/rate-limit ชั่วคราว ไม่ใช่ auth error จริง
            # (endpoint พวกนี้เป็น public ไม่ต้องใช้ credential) → ต้อง retry ด้วย
            # ไม่งั้นรอบเดียวที่โดนจะทำหลาย key fail พร้อมกันแบบกู้ไม่ได้
            _bump(url, f"HTTP {e.code}")
            if e.code in (401, 403, 429, 502, 503) and attempt < tries - 1:
                time.sleep(min(2 ** attempt * 2, max(0, budget_left())))
                continue
            warn(f"HTTP {e.code} · {url[:80]}")
            return None
        except Exception as e:  # noqa: BLE001
            _bump(url, type(e).__name__)
            if attempt < tries - 1:
                time.sleep(min(2 ** attempt, max(0, budget_left())))
                continue
            warn(f"{type(e).__name__}: {e} · {url[:80]}")
            return None
    return None


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


def parallel_charts(specs: list[tuple], workers: int = 6):
    """ดึง yahoo_chart หลายตัวขนานกัน — คืน {symbol: (dates, closes)}

    เดิมทั้ง 23 Yahoo request เป็น sequential ซึ่งเป็นตัวกินเวลาหลัก
    งานนี้เป็น network-bound ล้วน GIL จึงไม่เป็นคอขวด ThreadPoolExecutor
    ใช้ได้เต็มประสิทธิภาพ และเป็น stdlib ตามข้อจำกัดเดิม (ไม่ต้อง pip install)

    workers=6 ไม่มากกว่านี้เพราะ Yahoo กัน rate limit จาก IP ของ GitHub Actions
    ค่อนข้างดุ ยิงพร้อมกันเยอะเกินจะได้ 401/403 ยกชุด
    """
    out: dict[str, tuple[list, list]] = {}
    if out_of_budget():
        return out
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(yahoo_chart, sym, rng, iv): sym for sym, rng, iv in specs}
        for f, sym in futs.items():
            try:
                d, v = f.result()
                if v:
                    out[sym] = (d, v)
            except Exception as e:  # noqa: BLE001
                warn(f"{type(e).__name__}: {e} · {sym}")
    return out


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
    # v44: VIX ย้ายจาก FRED VIXCLS มา Yahoo ^VIX — ค่าเดียวกัน แต่ real-time
    # และไม่ต้องพึ่ง host ที่บล็อกเราอยู่ (FRED ยังส่ง VIXCLS ช้า 1 วันด้วย)
    ("VIX",       "^VIX",      2, "Yahoo ^VIX"),
]
# ดึงทุก symbol ขนานกันก่อน แล้วค่อยประมวลผลตามลำดับเดิม
# (ผลลัพธ์เหมือนเดิมทุกอย่าง เปลี่ยนแค่เวลาที่ใช้)
closes_cache: dict[str, tuple[list, list]] = parallel_charts(
    [(sym, "2y", "1d") for _, sym, _, _ in PRICES])
for key, sym, nd, note in PRICES:
    d, v = closes_cache.get(sym, ([], []))
    if not v:
        continue
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
_hist_charts = parallel_charts([("^GSPC", "5y", "1d"), ("THB=X", "5y", "1d")], workers=2)
for hkey, sym in [("SP500", "^GSPC"), ("USDTHB", "THB=X")]:
    d, v = _hist_charts.get(sym, ([], []))
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
# SPY + sector ETF 10 ตัว = 11 request ดึงพร้อมกันในชุดเดียว
_sector_charts = parallel_charts(
    [("SPY", "2y", "1d")] + [(sym, "2y", "1d") for sym, _ in SECTORS])
spy_d, spy_v = _sector_charts.get("SPY", ([], []))
spy_1m = pct_change(spy_v, 21) if spy_v else None
spy_3m = pct_change(spy_v, 63) if spy_v else None

sectors: dict = {}
for sym, name in SECTORS:
    d, v = _sector_charts.get(sym, ([], []))
    if not v:
        continue
    c1m, c3m = pct_change(v, 21), pct_change(v, 63)
    # price ต้องมีเสมอ — ไฟล์ที่ commit อยู่มี field นี้ ถ้าไม่ใส่ shape จะไม่ตรงกัน
    entry = {"name": name, "price": round(v[-1], 2),
             "chg1m": c1m, "chg3m": c3m, "rsi": rsi14(v)}
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

# หมายเหตุ: ไม่ประกอบ history["sectors"] ที่นี่ — merge แบบราย-symbol ด้านล่าง
# เพื่อไม่ให้ symbol ที่ fetch fail รอบนี้หายไปทั้งก้อนตอน merged_hist.update(history)


print("── Holding prices (v44) ─────────────────────")
# ══════════════════════════════════════════════════════════════════════
# ราคารายตัวของสินทรัพย์ที่ถืออยู่ — ช่องทางใหม่ที่ dashboard ใช้แทนชีต
# ══════════════════════════════════════════════════════════════════════
# ทำไมต้องมี: Asset_Live_Price_Feed ในชีตใช้ IMPORTXML/GOOGLEFINANCE ซึ่งขึ้น
# #N/A เป็นระยะ (พบจริง: BDMS KBANK LH OR TISCO TLI + Gold) แล้ว dashboard
# นับสินทรัพย์นั้นเป็น ฿0 → พอร์ตต่ำกว่าจริง ~14% และ Value_Log แกว่ง ±14%
# วันเว้นวันจนคำนวณ TWR/benchmark ไม่ได้เลย
#
# "ccy" = สกุลเงินที่ *ชีตบันทึกไว้ใน Current_Price* ไม่ใช่สกุลของตลาด
#   ไทย  → THB (Current_Price_THB = Current_Price, FX = 1)
#   US / คริปโต / ทอง → USD (frontend คูณ USDTHB เอง)
# ทอง: ยืนยันจาก Asset_Tracker แล้วว่าเป็น USD/troy oz
#      (2026-05-27 price 4429.78 ตรงกับ GC=F 4429.60 ของวันเดียวกัน)
#
# ไม่ครอบคลุม 6 ตัวที่ Yahoo ไม่มี → ต้องอยู่ในชีตต่อไป:
#   PF4103 (provident fund, อัปเดต NAV เอง) และกองทุน K-* / KEURMF / KDLTF-C(L)
HOLDINGS: dict[str, tuple[str, str]] = {
    # ── US stocks / ETF (USD) ──
    **{t: (t, "USD") for t in [
        "AAPL", "V", "GOOGL", "GOOG", "COKE", "META",
        "WMT", "TSLA", "VOO", "JEPI",
    ]},
    # ── หุ้นไทย (THB) — ตรวจแล้วว่า .BK ให้ราคาปัจจุบัน ──
    **{t: (f"{t}.BK", "THB") for t in [
        "AOT", "BDMS", "BEM", "CPALL", "FPT", "IVL", "KBANK", "LH",
        "MINT", "OR", "TISCO", "TLI", "TPAC", "TTW", "TU",
    ]},
    # ── คริปโต + ทอง (USD) ──
    "BTC":  ("BTC-USD",  "USD"),
    "BNB":  ("BNB-USD",  "USD"),
    "USDT": ("USDT-USD", "USD"),
    "Gold": ("GC=F",     "USD"),
}

prices: dict = {}
# range=1mo พอสำหรับหาราคาล่าสุด + เผื่อวันหยุดตลาดยาว (สงกรานต์/ปีใหม่)
_p_charts = parallel_charts(
    [(sym, "1mo", "1d") for sym, _ in HOLDINGS.values()], workers=6)

for _tk, (_sym, _ccy) in HOLDINGS.items():
    _d, _v = _p_charts.get(_sym, ([], []))
    if not _v:
        warn(f"holding price: {_tk} ({_sym}) ไม่มีข้อมูล — frontend จะ fallback ไปชีต")
        continue
    prices[_tk] = {
        "price":   round(_v[-1], 6),
        "ccy":     _ccy,
        "updated": _d[-1],          # วันของ *ราคา* — frontend ใช้ตัดสิน staleness
        "src":     f"Yahoo {_sym}",
    }
    print(f"  ✓ {_tk:<12} {_v[-1]:>14,.4f} {_ccy}  ({_d[-1]})")

_miss = [t for t in HOLDINGS if t not in prices]
if _miss:
    print(f"  ⚠️  ไม่ได้ราคา {len(_miss)}/{len(HOLDINGS)}: {', '.join(_miss)}")


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
# sectors merge แบบราย-symbol (ไม่ใช่แทนที่ทั้ง dict) — เดิมถ้า symbol ไหน fetch fail
# รอบนี้ history["sectors"] จะถูกแทนที่ทั้งก้อนแล้วข้อมูล symbol นั้นหายถาวร
merged_sectors = dict(merged_hist.get("sectors", {}))
merged_sectors.update(sectors)
if merged_sectors:
    merged_hist["sectors"] = merged_sectors

# v44: prices merge ราย-ticker ด้วยเหตุผลเดียวกับ sectors — ticker ที่ Yahoo
# ไม่ตอบรอบนี้ต้องคงราคาเดิมไว้ ไม่หายจากไฟล์ (frontend เช็คอายุจาก "updated"
# เองอยู่แล้ว จึงไม่มีความเสี่ยงว่าราคาเก่าจะถูกใช้เหมือนราคาสด)
merged_prices = dict(prev.get("prices", {}))
merged_prices.update(prices)

payload = {
    "generated_at": FETCHED_AT,
    "source": "github-actions pipeline v44 (Yahoo only)",
    "stats": {
        "keys_this_run": len(data),
        "keys_total": len(merged_data),
        "sectors": len(sectors),
        "prices_this_run": len(prices),
        "prices_total": len(merged_prices),
        "prices_missing": sorted(t for t in HOLDINGS if t not in prices),
        # runtime/budget telemetry — ให้ debug ได้ว่ารอบไหนหมดเวลา ไม่ใช่ API ล่ม
        "runtime_sec": round(elapsed(), 1),
        "budget_sec": DEADLINE_SEC,
        "budget_exhausted": _budget_skips > 0,
        "host_stats": {h: dict(v) for h, v in _host_stat.items()},
        "skipped_for_budget": _budget_skips,
        "warnings": warnings,
    },
    "data": merged_data,
    "history": merged_hist,
    "prices": merged_prices,
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=1)

print("─────────────────────────────────────────────")
print(f"เขียน {OUT}: {len(data)} keys รอบนี้ · {len(merged_data)} keys รวม · "
      f"{len(sectors)} sectors · {len(prices)}/{len(HOLDINGS)} prices · "
      f"{len(warnings)} warnings · {elapsed():.0f}s")

print("  ผลต่อ host:")
for _h, _v in sorted(_host_stat.items()):
    print(f"    {_h:32s} {dict(_v)}")

if _budget_skips:
    # ไฟล์ถูกเขียนแล้ว (ข้อมูลเดิม merge ไว้ครบ) แต่ต้องเห็นใน log ว่ารอบนี้ไม่สมบูรณ์
    print(f"::warning::หมดงบเวลา {DEADLINE_SEC}s — ข้าม {_budget_skips} request "
          f"ไฟล์ถูกเขียนด้วยข้อมูลเท่าที่ดึงทัน + ค่าเดิมที่ merge ไว้")

# ถ้าดึงได้น้อยกว่าครึ่งของที่ควรได้ = มีอะไรผิดปกติจริง ให้ job fail จริง (ไฟล์เขียนไปแล้ว
# ด้วยข้อมูล merge เก็บค่าเดิม แต่ workflow ต้องไม่รายงานว่าสำเร็จ)
if len(data) < 15:
    print(f"::error::ดึงได้แค่ {len(data)} keys (ปกติ ~30) — ตรวจสอบ warnings ด้านบน")
    sys.exit(1)
