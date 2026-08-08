#!/usr/bin/env python3
"""
Finance OS — market data pipeline  (v42)
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
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

OUT = os.environ.get("MARKET_DATA_OUT", "market-data.json")
# v42: UA เดิม "Mozilla/5.0 (compatible; FinanceOS-pipeline/42)" มี token ที่ไม่ใช่
# เบราว์เซอร์จริง ซึ่งเป็นผู้ต้องสงสัยอันดับแรกของการโดนบล็อกแบบ tarpit
# (fredgraph.csv รับ connection แล้วไม่ส่งข้อมูลกลับ -> read timeout ทั้ง 14 ตัว)
# ส่ง header ชุดเดียวกับเบราว์เซอร์จริงเพื่อตัดตัวแปรนี้ออก
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
REQ_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/csv,text/plain,application/json,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",     # เลี่ยง gzip — เราไม่ได้ decode
    "Connection": "close",
}
FRED_API_KEY = os.environ.get("FRED_API_KEY", "").strip()
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
            req = urllib.request.Request(url, headers=REQ_HEADERS)
            with urllib.request.urlopen(req, timeout=eff, context=_ctx) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            # 401/403 จาก Yahoo มักเป็น anti-bot/rate-limit ชั่วคราว ไม่ใช่ auth error จริง
            # (endpoint พวกนี้เป็น public ไม่ต้องใช้ credential) → ต้อง retry ด้วย
            # ไม่งั้นรอบเดียวที่โดนจะทำหลาย key fail พร้อมกันแบบกู้ไม่ได้
            if e.code in (401, 403, 429, 502, 503) and attempt < tries - 1:
                time.sleep(min(2 ** attempt * 2, max(0, budget_left())))
                continue
            warn(f"HTTP {e.code} · {url[:80]}")
            return None
        except Exception as e:  # noqa: BLE001
            if attempt < tries - 1:
                time.sleep(min(2 ** attempt, max(0, budget_left())))
                continue
            warn(f"{type(e).__name__}: {e} · {url[:80]}")
            return None
    return None


# ══════════════════════════════════════════════════════════════════════
# FRED — ข้อมูลมหภาค (CSV endpoint สาธารณะ ไม่ต้องใช้ API key)
# ══════════════════════════════════════════════════════════════════════
# ══════════════════════════════════════════════════════════════════════
# v42 — FRED endpoint fallback chain
# ══════════════════════════════════════════════════════════════════════
# ปัญหาที่เกิดขึ้นจริง (run วันที่ 8 ส.ค. 11:55 UTC):
#   FRED 14/14 ล้มด้วย "TimeoutError: The read operation timed out"
#   Yahoo 17/17 สำเร็จในรอบเดียวกัน -> ไม่ใช่ปัญหาเน็ตของ runner
#   ค่าล่าสุดที่ FRED ให้มาสำเร็จคือ 2026-07-28 = วันที่ข้อมูลเริ่มค้างเป๊ะ
#   => fredgraph.csv เริ่มบล็อก IP/UA ของ GitHub Actions ราว 28-29 ก.ค.
#      และนั่นคือ "ต้นตอจริง" ของทั้งเหตุการณ์: 14 x 3 tries x 30s = 21 นาที
#      > เพดาน job 15 นาที -> job ถูกฆ่า -> commit ไม่รัน -> ข้อมูลค้าง 11 วัน
#
# read timeout (ไม่ใช่ connect timeout) = TCP ต่อติด แต่ server ไม่ส่งอะไรกลับ
# = อาการ tarpit / silent block ไม่ใช่ server ช้า การเพิ่ม timeout จึงไม่ช่วย
#
# แก้แบบไม่เดา: ลองหลาย endpoint ต่อกันจนได้ตัวที่ทำงาน แล้วรายงานว่าตัวไหนชนะ
# ลำดับความน่าเชื่อถือ:
#   1. official API  — ต้องมี FRED_API_KEY (ฟรี) เป็น endpoint ที่ FRED support จริง
#   2. fredgraph.csv  — ตัวเดิม (ตอนนี้ถูกบล็อก)
#   3. /data/{id}.txt — endpoint เก่า คนละ path คนละ handler
#   4. downloaddata   — path ที่ UI ใช้ตอนกดปุ่ม download
_fred_endpoint_used: dict[str, str] = {}
_fred_cache: dict[str, list[tuple[str, float]]] = {}


def _parse_fred_csv(raw: bytes) -> list[tuple[str, float]]:
    out = []
    for line in raw.decode("utf-8", "replace").splitlines()[1:]:
        parts = line.replace("\t", ",").split(",")
        if len(parts) < 2:
            continue
        d, v = parts[0].strip().strip('"'), parts[1].strip().strip('"')
        if not v or v == "." or not d[:4].isdigit():
            continue
        try:
            out.append((d, float(v)))
        except ValueError:
            continue
    return out


def _parse_fred_txt(raw: bytes) -> list[tuple[str, float]]:
    """/data/{id}.txt เป็น fixed-width มี header แล้วคั่นด้วยช่องว่าง"""
    out = []
    for line in raw.decode("utf-8", "replace").splitlines():
        parts = line.split()
        if len(parts) < 2 or not parts[0][:4].isdigit():
            continue
        if parts[1] == ".":
            continue
        try:
            out.append((parts[0], float(parts[1])))
        except ValueError:
            continue
    return out


def _parse_fred_api(raw: bytes) -> list[tuple[str, float]]:
    try:
        obs = json.loads(raw.decode("utf-8", "replace")).get("observations", [])
    except (json.JSONDecodeError, AttributeError):
        return []
    out = []
    for o in obs:
        v = (o.get("value") or "").strip()
        if not v or v == ".":
            continue
        try:
            out.append((o.get("date", ""), float(v)))
        except ValueError:
            continue
    return out


def fred_series(series_id: str) -> list[tuple[str, float]]:
    """คืน [(date, value)] เรียงเก่า→ใหม่ ข้ามค่า '.' ที่ FRED ใช้แทน N/A

    ลองหลาย endpoint จนได้ตัวที่ทำงาน (ดูคำอธิบายด้านบน)
    timeout ต่อ endpoint ตั้งสั้น (8s) เพราะตอนนี้ยิงขนานกันแล้ว
    ต้นทุนของ endpoint ที่ตายจึงถูกลงมาก
    """
    if series_id in _fred_cache:
        return _fred_cache[series_id]
    chain: list[tuple[str, str, object]] = []
    if FRED_API_KEY:
        chain.append((
            "api",
            f"https://api.stlouisfed.org/fred/series/observations"
            f"?series_id={series_id}&api_key={FRED_API_KEY}&file_type=json",
            _parse_fred_api))
    chain += [
        ("fredgraph", f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}", _parse_fred_csv),
        ("data-txt",  f"https://fred.stlouisfed.org/data/{series_id}.txt",              _parse_fred_txt),
        ("download",  f"https://fred.stlouisfed.org/series/{series_id}/downloaddata/{series_id}.csv", _parse_fred_csv),
    ]
    for name, url, parse in chain:
        if out_of_budget():
            return []
        raw = http_get(url, tries=1, timeout=8)
        if not raw:
            continue
        out = parse(raw)
        if out:
            _fred_endpoint_used[series_id] = name
            return out
    warn(f"FRED {series_id}: ทุก endpoint ใช้ไม่ได้ ({len(chain)} ตัว)")
    return []


def _fred_series_legacy_unused(series_id: str) -> list[tuple[str, float]]:
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


def prefetch_fred(series_ids: list[str], workers: int = 5) -> None:
    """ดึง FRED ทุก series ขนานกันใส่ cache

    เหตุผล: run ล่าสุด FRED 14 ตัวยิงแบบ sequential แล้ว timeout ทุกตัว
    = 14 x 2 tries x 12s = 336s จาก runtime รวม 352s "เสียเวลาไปเกือบทั้งหมด
    เพื่อให้ได้ 0 key" ขณะที่ Yahoo (ขนานอยู่แล้ว) ใช้แค่ ~16s ได้ครบ 17 key

    ยิงขนาน 5 ตัว + endpoint chain 3-4 ตัว timeout 8s
    worst case ~ 14/5 x 4 x 8s ≈ 90s แทน 336s
    ถ้า FRED กลับมาทำงาน จะเหลือ ~3s
    """
    if not series_ids:
        return
    uniq = list(dict.fromkeys(series_ids))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fred_series, sid): sid for sid in uniq}
        for f, sid in futs.items():
            try:
                _fred_cache[sid] = f.result()
            except Exception as e:  # noqa: BLE001
                warn(f"{type(e).__name__}: {e} · FRED {sid}")
                _fred_cache[sid] = []


print("── FRED (macro) ─────────────────────────────")
# ทุก series ที่จะใช้ด้านล่าง — ดึงขนานกันทีเดียวก่อน
prefetch_fred([
    "DFEDTARU", "DGS10", "DGS2", "DFII10", "BAMLH0A0HYM2", "VIXCLS",
    "UNRATE", "A191RL1Q225SBEA", "T10Y2Y",
    "CPIAUCSL", "CPILFESL", "PCEPI", "PCEPILFE", "PAYEMS",
])
_fred_ok = sum(1 for v in _fred_cache.values() if v)
print(f"  prefetch: {_fred_ok}/{len(_fred_cache)} series · {elapsed():.0f}s")
if _fred_endpoint_used:
    from collections import Counter
    print(f"  endpoint ที่ใช้ได้: {dict(Counter(_fred_endpoint_used.values()))}")
elif not _fred_ok:
    print("::warning::FRED ใช้ไม่ได้ทุก endpoint — ตั้ง secret FRED_API_KEY "
          "แล้วส่งเป็น env FRED_API_KEY จะได้ endpoint ที่ FRED support จริง")

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

payload = {
    "generated_at": FETCHED_AT,
    "source": "github-actions pipeline v40 (FRED + Yahoo)",
    "stats": {
        "keys_this_run": len(data),
        "keys_total": len(merged_data),
        "sectors": len(sectors),
        # runtime/budget telemetry — ให้ debug ได้ว่ารอบไหนหมดเวลา ไม่ใช่ API ล่ม
        "runtime_sec": round(elapsed(), 1),
        "budget_sec": DEADLINE_SEC,
        "budget_exhausted": _budget_skips > 0,
        "fred_ok": sum(1 for v in _fred_cache.values() if v),
        "fred_total": len(_fred_cache),
        "fred_endpoint": (sorted(set(_fred_endpoint_used.values())) or None),
        "skipped_for_budget": _budget_skips,
        "warnings": warnings,
    },
    "data": merged_data,
    "history": merged_hist,
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=1)

print("─────────────────────────────────────────────")
print(f"เขียน {OUT}: {len(data)} keys รอบนี้ · {len(merged_data)} keys รวม · "
      f"{len(sectors)} sectors · {len(warnings)} warnings · {elapsed():.0f}s")

if _budget_skips:
    # ไฟล์ถูกเขียนแล้ว (ข้อมูลเดิม merge ไว้ครบ) แต่ต้องเห็นใน log ว่ารอบนี้ไม่สมบูรณ์
    print(f"::warning::หมดงบเวลา {DEADLINE_SEC}s — ข้าม {_budget_skips} request "
          f"ไฟล์ถูกเขียนด้วยข้อมูลเท่าที่ดึงทัน + ค่าเดิมที่ merge ไว้")

# ถ้าดึงได้น้อยกว่าครึ่งของที่ควรได้ = มีอะไรผิดปกติจริง ให้ job fail จริง (ไฟล์เขียนไปแล้ว
# ด้วยข้อมูล merge เก็บค่าเดิม แต่ workflow ต้องไม่รายงานว่าสำเร็จ)
if len(data) < 15:
    print(f"::error::ดึงได้แค่ {len(data)} keys (ปกติ ~30) — ตรวจสอบ warnings ด้านบน")
    sys.exit(1)
