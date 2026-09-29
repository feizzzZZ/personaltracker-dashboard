#!/usr/bin/env python3
"""
v66 — ข้อมูลพื้นฐานรายบริษัท สำหรับหน้า Deep Research และ Dividend tracker
เขียน fundamentals.json (ไฟล์แยกจาก market-data.json เพราะใหญ่กว่าและเปลี่ยนช้ากว่า)

  python3 scripts/fetch_fundamentals.py

แหล่งข้อมูล (stdlib ล้วน · ไม่มี API key · ทดสอบใน probe_sources.py ก่อนใช้จริง):
  1. Yahoo v8/chart?events=div      ราคา · ชื่อ · ตลาด · ประวัติปันผลรายครั้ง 5 ปี   (ทุกรอบ)
  2. Yahoo fundamentals-timeseries  งบรายปี ~4 ปี + TTM · P/E · Market cap · EPS   (สัปดาห์ละครั้ง)
  3. SEC EDGAR companyfacts         หุ้นสหรัฐ: งบย้อนหลัง 10+ ปี (เติมปีที่ Yahoo ไม่มี) (สัปดาห์ละครั้ง)
  4. Yahoo v1/finance/search        ข่าวล่าสุด 6 ข่าว                                  (ทุกรอบ)

หลักเดียวกับ fetch_signals.py:
  • รายชื่อสินทรัพย์มาจาก market-data.json (prices + watchlist) — ไม่ทำตารางซ้ำ
  • ดึงไม่ได้ → เก็บของรอบก่อนไว้ ("แก่ลง" ไม่ใช่ "หายไป") พร้อมวันที่เดิม
  • หน้าเว็บตรวจอายุเอง ไม่มีทางเข้าใจผิดว่าเป็นของสด
  • ฟังก์ชัน parse_* เป็นฟังก์ชันบริสุทธิ์ ทดสอบได้โดยไม่ต่อเน็ต (scripts/test_fundamentals.py)
"""
from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

MD = os.environ.get("MARKET_DATA_OUT", "market-data.json")
OUT = os.environ.get("FUNDAMENTALS_OUT", "fundamentals.json")
DEADLINE_SEC = int(os.environ.get("FUND_DEADLINE", "240"))
REFRESH_DAYS = int(os.environ.get("FUND_REFRESH_DAYS", "7"))   # งบรายปีไม่เปลี่ยนรายวัน
UA_BOT = "Mozilla/5.0 (compatible; FinanceOS-fundamentals/1)"
# SEC ขอให้ระบุตัวตน+ช่องทางติดต่อใน User-Agent — ตั้ง secret SEC_USER_AGENT ได้ถ้าโดน 403
UA_SEC = os.environ.get("SEC_USER_AGENT") or \
    "FinanceOS personal dashboard (github.com/feizzzZZ/personaltracker-dashboard)"
_CTX = ssl.create_default_context()
_T0 = time.monotonic()
NOW = datetime.now(timezone.utc)
TODAY = NOW.strftime("%Y-%m-%d")

TS_TYPES = ["annualTotalRevenue", "annualNetIncome", "annualTotalAssets",
            "annualCashDividendsPaid", "annualDilutedEPS",
            "trailingTotalRevenue", "trailingNetIncome", "trailingDilutedEPS",
            "trailingPeRatio", "trailingMarketCap"]
# concept ใน EDGAR ที่ใช้แทนกันได้ (บริษัทต่างกันใช้ชื่อต่างกัน) — เรียงตามลำดับที่ชอบ
EDGAR_CONCEPTS = {
    "revenue":     ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
                    "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
    "netIncome":   ["NetIncomeLoss", "ProfitLoss"],
    "totalAssets": ["Assets"],
    "divPaid":     ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
    "eps":         ["EarningsPerShareDiluted"],
}

warnings: list[str] = []


def warn(msg: str) -> None:
    warnings.append(msg)
    print(f"  ⚠️  {msg}", file=sys.stderr)


def budget_left() -> float:
    return DEADLINE_SEC - (time.monotonic() - _T0)


def http_get(url: str, ua: str = UA_BOT, tries: int = 2, timeout: int = 15) -> bytes | None:
    for attempt in range(tries):
        if budget_left() <= 0:
            return None
        try:
            eff = max(3, min(timeout, int(budget_left())))
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=eff, context=_CTX) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503) and attempt < tries - 1:
                time.sleep(min(2 * (attempt + 1), max(0, budget_left())))
                continue
            warn(f"HTTP {e.code} · {url[:80]}")
            return None
        except Exception as e:                                   # noqa: BLE001
            if attempt < tries - 1:
                time.sleep(1)
                continue
            warn(f"{type(e).__name__}: {e} · {url[:80]}")
            return None
    return None


def _json(raw: bytes | None):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


# ══════════════════════════════════════════════════════════════════════
# parse_* — ฟังก์ชันบริสุทธิ์ (ทดสอบใน scripts/test_fundamentals.py)
# ══════════════════════════════════════════════════════════════════════
def parse_timeseries(doc) -> dict[str, list[tuple[str, float]]]:
    """{"timeseries":{"result":[{"meta":{"type":["annualTotalRevenue"]},"annualTotalRevenue":[{asOfDate, reportedValue:{raw}}]}]}}
    → {type: [(asOfDate, value), …] เรียงเก่า→ใหม่} · ข้ามค่า null"""
    out: dict[str, list[tuple[str, float]]] = {}
    try:
        results = doc["timeseries"]["result"] or []
    except (KeyError, TypeError):
        return out
    for r in results:
        try:
            typ = (r.get("meta") or {}).get("type", [None])[0]
        except (AttributeError, IndexError, TypeError):
            continue
        rows = r.get(typ) if typ else None
        if not rows:
            continue
        pts = []
        for x in rows:
            if not x:
                continue
            v = (x.get("reportedValue") or {}).get("raw")
            d = x.get("asOfDate")
            if v is None or not d:
                continue
            try:
                pts.append((str(d), float(v)))
            except (TypeError, ValueError):
                continue
        if pts:
            out[typ] = sorted(pts)
    return out


def _last(ts, key):
    v = ts.get(key) or []
    return v[-1][1] if v else None


def annual_from_timeseries(ts) -> dict[int, dict]:
    """งบรายปีจาก Yahoo — คีย์ = ปีของ asOfDate (ปีงบที่จบ)"""
    m = {"annualTotalRevenue": "revenue", "annualNetIncome": "netIncome",
         "annualTotalAssets": "totalAssets", "annualCashDividendsPaid": "divPaid",
         "annualDilutedEPS": "eps"}
    years: dict[int, dict] = {}
    for typ, field in m.items():
        for d, v in ts.get(typ, []):
            y = int(d[:4])
            years.setdefault(y, {"year": y, "end": d})[field] = abs(v) if field == "divPaid" else v
    return years


def parse_edgar(doc) -> dict[int, dict]:
    """SEC companyfacts → งบรายปีจาก 10-K (fp=FY) · รายการสะสมทั้งปี (มี start) ต้องยาว ~1 ปี
    ปีเดียวกันยื่นซ้ำ (แก้งบ) → เก็บฉบับที่ยื่นล่าสุด"""
    years: dict[int, dict] = {}
    facts = ((doc or {}).get("facts") or {}).get("us-gaap") or {}
    for field, concepts in EDGAR_CONCEPTS.items():
        for c in concepts:
            units = (facts.get(c) or {}).get("units") or {}
            rows = units.get("USD") or units.get("USD/shares") or []
            best: dict[int, tuple[str, float, str]] = {}
            for r in rows:
                if r.get("form") != "10-K" or r.get("fp") != "FY" or r.get("val") is None:
                    continue
                end = str(r.get("end") or "")
                if len(end) < 10:
                    continue
                st = r.get("start")
                if st:
                    try:
                        days = (datetime.fromisoformat(end) - datetime.fromisoformat(st)).days
                    except ValueError:
                        continue
                    if not 330 <= days <= 400:
                        continue
                y = int(end[:4])
                filed = str(r.get("filed") or "")
                if y not in best or filed > best[y][2]:
                    best[y] = (end, float(r["val"]), filed)
            if best:
                for y, (end, v, _) in best.items():
                    e = years.setdefault(y, {"year": y, "end": end})
                    if field not in e:
                        e[field] = abs(v) if field == "divPaid" else v
                break          # concept แรกที่มีข้อมูลชนะ ไม่ปนนิยามต่างกัน
    return years


def merge_annual(yahoo: dict[int, dict], edgar: dict[int, dict], keep: int = 10) -> list[dict]:
    """ปีที่ Yahoo มี ใช้ Yahoo (ชุดเดียวกับ P/E/TTM) · ปีเก่ากว่าเติมจาก EDGAR · คำนวณ ROA/payout"""
    allY = {**edgar, **yahoo}
    rows = []
    for y in sorted(allY)[-keep:]:
        r = dict(allY[y])
        for k in ("revenue", "netIncome", "totalAssets", "divPaid", "eps"):
            if k not in r and y in edgar and k in edgar[y]:
                r[k] = edgar[y][k]
        ni, ta, dp = r.get("netIncome"), r.get("totalAssets"), r.get("divPaid")
        r["roa"] = round(ni / ta * 100, 2) if ni is not None and ta else None
        r["payout"] = round(dp / ni * 100, 2) if dp is not None and ni and ni > 0 else None
        r["src"] = "yahoo" if y in yahoo else "edgar"
        rows.append(r)
    return rows


def parse_chart(doc) -> tuple[dict, list[dict]]:
    """v8/chart?events=div → (meta, [{date, amount}] เรียงเก่า→ใหม่)"""
    try:
        res = doc["chart"]["result"][0]
    except (KeyError, IndexError, TypeError):
        return {}, []
    m = res.get("meta") or {}
    price = m.get("regularMarketPrice")
    prev = m.get("chartPreviousClose") or m.get("previousClose")
    meta = {
        "name": m.get("longName") or m.get("shortName"),
        "exchange": m.get("fullExchangeName") or m.get("exchangeName"),
        "currency": m.get("currency"),
        "type": m.get("instrumentType"),
        "price": price,
    }
    divs = []
    for _, d in sorted(((res.get("events") or {}).get("dividends") or {}).items(),
                       key=lambda kv: (kv[1] or {}).get("date", 0)):
        try:
            divs.append({"date": datetime.fromtimestamp(int(d["date"]), timezone.utc).strftime("%Y-%m-%d"),
                         "amount": round(float(d["amount"]), 6)})
        except (KeyError, TypeError, ValueError):
            continue
    # เปลี่ยนแปลงรายวัน: ใช้ 2 แท่งสุดท้าย (chartPreviousClose ของ range ยาวคือราคาต้นช่วง ไม่ใช่เมื่อวาน)
    try:
        closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
        if len(closes) >= 2:
            prev = closes[-2]
            price = price or closes[-1]
    except (KeyError, IndexError, TypeError):
        pass
    if price and prev:
        meta["chg"] = round(price - prev, 6)
        meta["chgPct"] = round((price - prev) / prev * 100, 3)
    return meta, divs


def parse_news(doc, n: int = 6) -> list[dict]:
    out = []
    for x in ((doc or {}).get("news") or [])[:n]:
        if not x.get("title") or not x.get("link"):
            continue
        t = x.get("providerPublishTime")
        out.append({"title": x["title"][:200], "publisher": x.get("publisher") or "",
                    "link": x["link"],
                    "time": datetime.fromtimestamp(int(t), timezone.utc).strftime("%Y-%m-%d") if t else None})
    return out


def div_yield(divs: list[dict], price: float | None, today: str = TODAY) -> float | None:
    """ปันผลรวม 12 เดือนล่าสุด ÷ ราคา (%)"""
    if not price:
        return None
    cut = (datetime.fromisoformat(today) - timedelta(days=365)).strftime("%Y-%m-%d")
    s = sum(d["amount"] for d in divs if d["date"] > cut)
    return round(s / price * 100, 2) if s else 0.0


def eligible(sym: str) -> bool:
    """ดัชนี · ฟิวเจอร์ส · คริปโต ไม่มีงบการเงิน"""
    return bool(sym) and not sym.startswith("^") and "=" not in sym and not sym.endswith("-USD")


def universe(md: dict) -> dict[str, dict]:
    """{key: {sym, name, kind}} จาก prices (ของที่ถือ) + watchlist · ของที่ถือชนะ"""
    u: dict[str, dict] = {}
    for key, w in (md.get("watchlist") or {}).items():
        sym = (w or {}).get("sym")
        if eligible(sym):
            u[key] = {"sym": sym, "name": w.get("name"), "kind": "watch"}
    for key, p in (md.get("prices") or {}).items():
        src = str((p or {}).get("src") or "")
        sym = src[6:].strip() if src.startswith("Yahoo ") else ""
        if eligible(sym):
            u[key] = {"sym": sym, "name": (u.get(key) or {}).get("name"), "kind": "holding"}
    return u


# ══════════════════════════════════════════════════════════════════════
# fetch
# ══════════════════════════════════════════════════════════════════════
_cik: dict[str, int] | None = None


def sec_cik(sym: str) -> int | None:
    global _cik
    if _cik is None:
        doc = _json(http_get("https://www.sec.gov/files/company_tickers.json", UA_SEC, tries=1))
        _cik = {}
        for v in (doc or {}).values():
            try:
                _cik[str(v["ticker"]).upper()] = int(v["cik_str"])
            except (KeyError, TypeError, ValueError):
                continue
    return _cik.get(sym.upper().replace("-", "."), _cik.get(sym.upper()))


def fetch_one(key: str, info: dict, prev: dict | None) -> dict:
    sym = info["sym"]
    q = urllib.parse.quote(sym, safe="")
    e = dict(prev or {})
    e.update({"sym": sym, "kind": info["kind"]})
    if info.get("name"):
        e["nameTh"] = info["name"]

    meta, divs = parse_chart(_json(http_get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{q}?range=5y&interval=1d&events=div")))
    if meta.get("price"):
        e["profile"] = {"name": meta.get("name") or (e.get("profile") or {}).get("name") or key,
                        "exchange": meta.get("exchange"), "currency": meta.get("currency"),
                        "type": meta.get("type")}
        st = dict(e.get("stats") or {})
        st.update({"price": meta["price"], "chg": meta.get("chg"), "chgPct": meta.get("chgPct"),
                   "divYield": div_yield(divs, meta["price"]),
                   "exDate": divs[-1]["date"] if divs else None, "asOf": TODAY})
        e["stats"] = st
        e["dividends"] = divs[-40:]
        e["updated"] = TODAY

    # งบ: สัปดาห์ละครั้ง (หรือเมื่อยังไม่มี)
    fin_age = None
    if e.get("finUpdated"):
        try:
            fin_age = (NOW.date() - datetime.fromisoformat(e["finUpdated"]).date()).days
        except ValueError:
            fin_age = None
    if fin_age is None or fin_age >= REFRESH_DAYS:
        p1 = int((NOW - timedelta(days=365 * 11)).timestamp())
        p2 = int(NOW.timestamp()) + 86400
        ts = parse_timeseries(_json(http_get(
            f"https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{q}"
            f"?symbol={q}&type={','.join(TS_TYPES)}&period1={p1}&period2={p2}")))
        yahoo = annual_from_timeseries(ts)
        edgar: dict[int, dict] = {}
        if (e.get("profile") or {}).get("type") == "EQUITY" and "." not in sym and budget_left() > 30:
            cik = sec_cik(sym)
            if cik:
                edgar = parse_edgar(_json(http_get(
                    f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", UA_SEC, tries=1)))
        if yahoo or edgar:
            e["annual"] = merge_annual(yahoo, edgar)
            e["ttm"] = {"revenue": _last(ts, "trailingTotalRevenue"), "netIncome": _last(ts, "trailingNetIncome"),
                        "eps": _last(ts, "trailingDilutedEPS")}
            st = dict(e.get("stats") or {})
            st.update({"pe": _last(ts, "trailingPeRatio"), "mcap": _last(ts, "trailingMarketCap"),
                       "eps": _last(ts, "trailingDilutedEPS")})
            e["stats"] = st
            e["finUpdated"] = TODAY
            e["finSrc"] = "yahoo+edgar" if edgar else "yahoo"

    news = parse_news(_json(http_get(
        f"https://query1.finance.yahoo.com/v1/finance/search?q={q}&quotesCount=0&newsCount=6")))
    if news:
        e["news"] = news
    return e


def main() -> int:
    print("── Fundamentals ─────────────────────────────")
    try:
        md = json.load(open(MD, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as ex:
        print(f"อ่าน {MD} ไม่ได้: {ex}", file=sys.stderr)
        return 1
    try:
        prev = json.load(open(OUT, encoding="utf-8")).get("tickers") or {}
    except (OSError, json.JSONDecodeError, AttributeError):
        prev = {}
    uni = universe(md)
    print(f"  {len(uni)} ตัว (ถือ {sum(1 for v in uni.values() if v['kind']=='holding')} · "
          f"watchlist {sum(1 for v in uni.values() if v['kind']=='watch')})")
    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(fetch_one, k, v, prev.get(k)): k for k, v in uni.items()}
        for f, k in futs.items():
            try:
                out[k] = f.result()
            except Exception as ex_:                              # noqa: BLE001
                warn(f"{k}: {type(ex_).__name__}: {ex_}")
                if k in prev:
                    out[k] = prev[k]
    # ตัวที่หลุดจาก universe (ขายหมดแล้ว / ออกจาก watchlist) ไม่ต้องเก็บ
    for k, e in sorted(out.items()):
        yrs = [r["year"] for r in e.get("annual") or []]
        print(f"  {'✓' if e.get('updated') == TODAY else '↻'} {k:<8} {e.get('sym', ''):<10} "
              f"งบ {yrs[0] if yrs else '—'}–{yrs[-1] if yrs else '—'} ({e.get('finSrc', '—')}) · "
              f"ปันผล {len(e.get('dividends') or [])} ครั้ง · ข่าว {len(e.get('news') or [])}")
    payload = {"generated_at": NOW.isoformat(), "tickers": out,
               "meta": {"count": len(out), "fresh": sum(1 for e in out.values() if e.get("updated") == TODAY),
                        "runtime_sec": round(time.monotonic() - _T0, 1), "warnings": warnings[:40]}}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"  เขียน {OUT} · {os.path.getsize(OUT) / 1024:.0f} KB · "
          f"สด {payload['meta']['fresh']}/{len(out)} · {payload['meta']['runtime_sec']}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
