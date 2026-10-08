"""메모리 3사 설비투자(현금 CAPEX = 유형자산 취득) 분기 — 장비 수요(ASML·국내 장비사)의 선행 지표.

- 삼성전자·SK하이닉스: DART 연결 현금흐름표 '유형자산의 취득' — 반기·3분기 보고서는 누적(YTD)이라 차감해 분기값
- 마이크론: SEC XBRL PaymentsToAcquirePropertyPlantAndEquipment — 10-Q는 회계연도 누적이라 차감
- 원화는 분기 평균 환율(FRED DEXKOUS)로 달러 환산. 삼성은 회사 전체(반도체 외 포함).
시계열 저장은 분기 금액을 그 분기 3개월에 ÷3씩 (scores.quarterly가 3개월 합 = 분기 금액으로 읽음).
"""
import json
import os
from datetime import date

import pandas as pd
import requests

from etl import dart, fred, sec

KR = {"005930": "삼성전자", "000660": "SK하이닉스"}
CAPEX_IDS = {"ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"}
CAPEX_NAMES = {"유형자산의취득", "유형자산취득"}
REPORTS = [("11013", 1), ("11012", 2), ("11014", 3), ("11011", 4)]  # 1분기·반기·3분기·사업보고서


def _dart_cf(corp: str, year: int, reprt: str) -> float | None:
    path = dart.CACHE / f"{corp}_{year}_{reprt}_CFS_capex.json"
    if path.exists():
        return json.loads(path.read_text())["amount"]
    d = requests.get(f"{dart.BASE}/fnlttSinglAcntAll.json", timeout=60, params={
        "crtfc_key": os.environ["DART_API_KEY"], "corp_code": corp, "bsns_year": year, "reprt_code": reprt, "fs_div": "CFS"}).json()
    if d["status"] == "013":
        return None
    if d["status"] != "000":
        raise RuntimeError(d.get("message"))
    cf = [x for x in d["list"] if x["sj_div"] == "CF"]
    row = (next((x for x in cf if x["account_id"] in CAPEX_IDS), None)
           or next((x for x in cf if x["account_nm"].replace(" ", "") in CAPEX_NAMES), None))
    amt = abs(float(row["thstrm_amount"].replace(",", ""))) if row and row["thstrm_amount"] else None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"amount": amt}))
    return amt


def _krw_quarterly(stock_code: str, start_year=2019) -> pd.Series:
    corp = dart.corp_code(stock_code)
    out = {}
    for y in range(start_year, date.today().year + 1):
        ytd = {q: _dart_cf(corp, y, r) for r, q in REPORTS}
        prev = 0.0
        for q in (1, 2, 3, 4):
            if ytd[q] is None:
                break
            out[pd.Period(f"{y}Q{q}", freq="Q")] = ytd[q] - prev
            prev = ytd[q]
    return pd.Series(out)


def _mu_quarterly() -> pd.Series:
    facts = sec._get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{sec.cik('MU')}.json", sec.CACHE / "MU.json", False)["facts"]["us-gaap"]
    rows = [u for u in facts["PaymentsToAcquirePropertyPlantAndEquipment"]["units"]["USD"] if "start" in u]
    df = pd.DataFrame(rows)[["start", "end", "val", "filed"]]
    df["start"], df["end"] = pd.to_datetime(df.start), pd.to_datetime(df.end)
    df = df.sort_values("filed").drop_duplicates(["start", "end"], keep="last")
    out = {}
    for fy_start, g in df.groupby("start"):  # 같은 회계연도 시작일의 누적값들 → 차감
        g = g.sort_values("end")
        prev = 0.0
        for _, r in g.iterrows():
            if (r.end - fy_start).days > 380:
                break
            out[pd.Timestamp(r.end)] = r.val - prev
            prev = r.val
    s = pd.Series(out).sort_index()
    # 마이크론 분기 말(8월 말 등)을 가장 가까운 달력 분기로 — 메모리 3사 합산·ASML 분기와 맞춤
    return s.groupby(pd.PeriodIndex(s.index - pd.Timedelta(days=15), freq="Q")).sum()


def _fx_quarterly() -> pd.Series:
    d = fred.series("DEXKOUS")
    return d.set_index(pd.PeriodIndex(d.date, freq="Q")).value.groupby(level=0).mean()


def quarterly_usd(company: str) -> pd.Series:
    if company == "MU":
        return _mu_quarterly()
    krw = _krw_quarterly(company)
    fx = _fx_quarterly().reindex(krw.index).ffill()
    return krw / fx


def monthly(company: str) -> pd.DataFrame:
    """company: 'MU' · '005930' · '000660' · 'memory3'(3사 합). 분기 금액을 3개월에 고르게 나눠 기록."""
    if company == "memory3":
        parts = [quarterly_usd(c) for c in ("005930", "000660", "MU")]
        common = parts[0].index.intersection(parts[1].index).intersection(parts[2].index)
        q = sum(p.reindex(common) for p in parts)
    else:
        q = quarterly_usd(company)
    q = q[q.index >= pd.Period("2019Q1", freq="Q")]
    rows = [(p.asfreq("M", "start") + i, v / 3) for p, v in q.items() for i in range(3)]
    return pd.DataFrame(rows, columns=["month", "value_usd"])
