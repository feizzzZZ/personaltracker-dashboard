#!/usr/bin/env python3
"""
ชุดทดสอบ scripts/fetch_fundamentals.py — รันโดยไม่ต่อเน็ต

    python3 scripts/test_fundamentals.py

fixture เลียนรูปแบบ response จริงของ Yahoo fundamentals-timeseries · v8/chart?events=div ·
v1/finance/search และ SEC companyfacts — ส่วน network จริงยืนยันด้วย probe_sources.py บน Actions
"""
import json
import os
import sys
import tempfile
import unittest.mock as mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_fundamentals as ff                                  # noqa: E402

FAIL = 0


def check(name, cond, detail=""):
    global FAIL
    if cond:
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}  {detail}")


def rv(d, v):
    return {"asOfDate": d, "periodType": "12M", "currencyCode": "USD",
            "reportedValue": {"raw": v, "fmt": str(v)}}


TS = {"timeseries": {"result": [
    {"meta": {"symbol": ["AAPL"], "type": ["annualTotalRevenue"]}, "timestamp": [1, 2, 3],
     "annualTotalRevenue": [rv("2022-09-30", 394e9), None, rv("2023-09-30", 383e9), rv("2024-09-30", 391e9)]},
    {"meta": {"symbol": ["AAPL"], "type": ["annualNetIncome"]},
     "annualNetIncome": [rv("2022-09-30", 99.8e9), rv("2023-09-30", 97e9), rv("2024-09-30", 93.7e9)]},
    {"meta": {"symbol": ["AAPL"], "type": ["annualTotalAssets"]},
     "annualTotalAssets": [rv("2023-09-30", 352.6e9), rv("2024-09-30", 365e9)]},
    {"meta": {"symbol": ["AAPL"], "type": ["annualCashDividendsPaid"]},
     "annualCashDividendsPaid": [rv("2023-09-30", -15e9), rv("2024-09-30", -15.2e9)]},
    {"meta": {"symbol": ["AAPL"], "type": ["trailingPeRatio"]},
     "trailingPeRatio": [rv("2026-06-30", 30.2), rv("2026-09-26", 31.1)]},
    {"meta": {"symbol": ["AAPL"], "type": ["trailingMarketCap"]}},          # ไม่มีข้อมูล → ข้าม
]}}

EDGAR = {"facts": {"us-gaap": {
    "Revenues": {"units": {"USD": []}},                                       # concept แรกว่าง → ไปตัวถัดไป
    "RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": [
        {"start": "2015-09-27", "end": "2016-09-24", "val": 215.6e9, "fy": 2016, "fp": "FY", "form": "10-K", "filed": "2016-10-26"},
        {"start": "2016-06-26", "end": "2016-09-24", "val": 46.9e9, "fy": 2016, "fp": "FY", "form": "10-K", "filed": "2016-10-26"},  # ไตรมาส → ข้าม
        {"start": "2015-09-27", "end": "2016-09-24", "val": 215.0e9, "fy": 2016, "fp": "FY", "form": "10-K", "filed": "2015-01-01"},  # ยื่นก่อน → แพ้
        {"start": "2021-09-26", "end": "2022-09-24", "val": 394.3e9, "fy": 2022, "fp": "FY", "form": "10-K", "filed": "2022-10-28"},
        {"start": "2021-09-26", "end": "2022-06-25", "val": 1e9, "fy": 2022, "fp": "Q3", "form": "10-Q", "filed": "2022-07-29"},
    ]}},
    "NetIncomeLoss": {"units": {"USD": [
        {"start": "2015-09-27", "end": "2016-09-24", "val": 45.7e9, "fp": "FY", "form": "10-K", "filed": "2016-10-26"}]}},
    "Assets": {"units": {"USD": [
        {"end": "2016-09-24", "val": 321.7e9, "fp": "FY", "form": "10-K", "filed": "2016-10-26"}]}},
    "PaymentsOfDividends": {"units": {"USD": [
        {"start": "2015-09-27", "end": "2016-09-24", "val": 12.15e9, "fp": "FY", "form": "10-K", "filed": "2016-10-26"}]}},
}}}

CHART = {"chart": {"result": [{
    "meta": {"currency": "USD", "exchangeName": "NMS", "fullExchangeName": "NasdaqGS", "instrumentType": "EQUITY",
             "regularMarketPrice": 250.0, "chartPreviousClose": 150.0, "longName": "Apple Inc."},
    "timestamp": [1, 2, 3],
    "indicators": {"quote": [{"close": [245.0, None, 248.0, 250.0]}]},
    "events": {"dividends": {
        "1731024000": {"amount": 0.25, "date": 1731024000},     # 2024-11-08
        "1707436800": {"amount": 0.24, "date": 1707436800},     # 2024-02-09
        "1755216000": {"amount": 0.26, "date": 1755216000},     # 2025-08-15
    }}}]}}

NEWS = {"news": [
    {"title": "Apple unveils", "publisher": "Reuters", "link": "https://x/1", "providerPublishTime": 1759000000},
    {"title": "", "link": "https://x/2"},                       # ไม่มีหัวข้อ → ข้าม
    {"title": "No link"},
]}

print("\n═══ parse_timeseries ═══")
ts = ff.parse_timeseries(TS)
check("อ่านครบทุก type ที่มีข้อมูล", set(ts) == {"annualTotalRevenue", "annualNetIncome", "annualTotalAssets",
                                             "annualCashDividendsPaid", "trailingPeRatio"}, sorted(ts))
check("ข้ามแถว null", len(ts["annualTotalRevenue"]) == 3)
check("P/E ใช้ค่าล่าสุด", ff._last(ts, "trailingPeRatio") == 31.1)
check("เอกสารพัง → {} ไม่ throw", ff.parse_timeseries({"x": 1}) == {} and ff.parse_timeseries(None) == {})

print("\n═══ annual + EDGAR + merge ═══")
ya = ff.annual_from_timeseries(ts)
check("ปันผลที่จ่ายเป็นค่าบวก", ya[2024]["divPaid"] == 15.2e9)
ed = ff.parse_edgar(EDGAR)
check("EDGAR: ใช้ concept ถัดไปเมื่อตัวแรกว่าง", ed.get(2016, {}).get("revenue") == 215.6e9, ed.get(2016))
check("EDGAR: ข้ามรายการไตรมาส/10-Q", ed.get(2022, {}).get("revenue") == 394.3e9)
check("EDGAR: ยื่นซ้ำ → เอาฉบับล่าสุด", ed[2016]["revenue"] == 215.6e9)
check("EDGAR: Assets (instant ไม่มี start) อ่านได้", ed[2016]["totalAssets"] == 321.7e9)
rows = ff.merge_annual(ya, ed)
years = [r["year"] for r in rows]
check("รวมปีเก่าจาก EDGAR + ปีใหม่จาก Yahoo", years == [2016, 2022, 2023, 2024], years)
r22 = next(r for r in rows if r["year"] == 2022)
check("ปีที่ Yahoo มี ใช้ค่า Yahoo", r22["revenue"] == 394e9 and r22["src"] == "yahoo")
r24 = rows[-1]
check("ROA = NI/TA", abs(r24["roa"] - 93.7 / 365 * 100) < 0.01, r24["roa"])
check("Payout = ปันผล/NI", abs(r24["payout"] - 15.2 / 93.7 * 100) < 0.01, r24["payout"])
check("ไม่มีสินทรัพย์ → ROA None", r22["roa"] is None)
check("เก็บไม่เกิน keep ปี", len(ff.merge_annual({y: {"year": y} for y in range(2000, 2026)}, {}, keep=10)) == 10)

print("\n═══ parse_chart / news / yield ═══")
meta, divs = ff.parse_chart(CHART)
check("ชื่อ/ตลาด/ประเภท", meta["name"] == "Apple Inc." and meta["exchange"] == "NasdaqGS" and meta["type"] == "EQUITY")
check("เปลี่ยนแปลงรายวันใช้แท่งก่อนหน้า ไม่ใช่ chartPreviousClose ต้นช่วง", meta["chg"] == 2.0 and abs(meta["chgPct"] - 0.806) < 0.01, meta)
check("ปันผลเรียงตามวัน", [d["date"] for d in divs] == ["2024-02-09", "2024-11-08", "2025-08-15"], divs)
check("yield 12 เดือน", ff.div_yield(divs, 250.0, "2025-09-01") == round((0.25 + 0.26) / 250 * 100, 2))
check("ไม่มีราคา → None", ff.div_yield(divs, None) is None)
n = ff.parse_news(NEWS)
check("ข่าว: ข้ามรายการไม่สมบูรณ์", len(n) == 1 and n[0]["publisher"] == "Reuters" and n[0]["time"] == "2025-09-27", n)
check("chart พัง → ({}, [])", ff.parse_chart({}) == ({}, []))

print("\n═══ universe ═══")
md = {"prices": {"AAPL": {"src": "Yahoo AAPL"}, "BTC": {"src": "Yahoo BTC-USD"}, "Gold": {"src": "Yahoo GC=F"},
                 "KBANK": {"src": "Yahoo KBANK.BK"}, "X": {"src": "Sheet"}},
      "watchlist": {"AAPL": {"sym": "AAPL", "name": "Apple"}, "SCHD": {"sym": "SCHD", "name": "US div"},
                    "BTC-USD": {"sym": "BTC-USD"}, "SPX": {"sym": "^GSPC"}}}
u = ff.universe(md)
check("ตัดคริปโต/ฟิวเจอร์ส/ดัชนี/ไม่มี symbol", set(u) == {"AAPL", "KBANK", "SCHD"}, sorted(u))
check("ของที่ถือชนะ watchlist แต่เก็บชื่อไว้", u["AAPL"]["kind"] == "holding" and u["AAPL"]["name"] == "Apple")

print("\n═══ fetch_one ล้มแบบนุ่ม (carry ของเดิม) ═══")
prev = {"sym": "AAPL", "stats": {"price": 1}, "annual": [{"year": 2020}], "finUpdated": ff.TODAY, "updated": "2026-01-01"}
with mock.patch.object(ff, "http_get", return_value=None):
    e = ff.fetch_one("AAPL", {"sym": "AAPL", "kind": "holding"}, prev)
check("เน็ตล่ม → คงงบ/ราคาเดิมพร้อมวันที่เดิม", e["annual"] == [{"year": 2020}] and e["updated"] == "2026-01-01", e)

print("\n═══ main เขียนไฟล์ ═══")
with tempfile.TemporaryDirectory() as d:
    mdp, outp = os.path.join(d, "md.json"), os.path.join(d, "f.json")
    json.dump(md, open(mdp, "w"))
    responses = {"chart": json.dumps(CHART).encode(), "timeseries": json.dumps(TS).encode(),
                 "search": json.dumps(NEWS).encode()}

    def fake(url, ua=None, tries=2, timeout=15):
        for k, v in responses.items():
            if k in url:
                return v
        return None
    with mock.patch.object(ff, "MD", mdp), mock.patch.object(ff, "OUT", outp), mock.patch.object(ff, "http_get", fake):
        rc = ff.main()
    j = json.load(open(outp))
    a = j["tickers"].get("AAPL") or {}
    check("main คืน 0 และเขียนทุกตัว", rc == 0 and set(j["tickers"]) == {"AAPL", "KBANK", "SCHD"}, sorted(j["tickers"]))
    check("มีงบ + สถิติ + ข่าว", len(a.get("annual") or []) == 3 and a["stats"]["pe"] == 31.1 and a.get("news"), a.get("stats"))

print("─────────────────────────────────────────────")
if FAIL:
    print(f"❌ ไม่ผ่าน {FAIL} ข้อ")
    sys.exit(1)
print("✅ ผ่านทั้งหมด")
