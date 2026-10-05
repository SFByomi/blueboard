"""SEC EDGAR companyfacts에서 분기 매출 실측치 추출 (검증용)."""
import json
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "raw" / "sec"
UA = {"User-Agent": "Yomin research contact@example.com"}
REV_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"]


def _get(url, path, refresh):
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    r = requests.get(url, headers=UA, timeout=60)
    r.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(r.text)
    return r.json()


def cik(ticker: str) -> str:
    m = _get("https://www.sec.gov/files/company_tickers.json", CACHE / "tickers.json", False)
    for v in m.values():
        if v["ticker"] == ticker:
            return f"{v['cik_str']:010d}"
    raise KeyError(ticker)


def quarterly_revenue(ticker: str, refresh=False) -> pd.DataFrame:
    """[end, start, revenue] — 약 3개월 구간. 4분기는 연간 - 1~3분기로 계산."""
    facts = _get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik(ticker)}.json",
                 CACHE / f"{ticker}.json", refresh)["facts"]["us-gaap"]
    rows = []
    for tag in REV_TAGS:
        for u in facts.get(tag, {}).get("units", {}).get("USD", []):
            if "start" in u:
                rows.append({"start": u["start"], "end": u["end"], "val": u["val"], "filed": u["filed"]})
    df = pd.DataFrame(rows)
    df["start"], df["end"] = pd.to_datetime(df["start"]), pd.to_datetime(df["end"])
    df["days"] = (df["end"] - df["start"]).dt.days
    df = df.sort_values("filed").drop_duplicates(["start", "end"], keep="last")  # 최신 정정치 우선

    q = df[df["days"].between(80, 100)][["start", "end", "val"]]
    annual = df[df["days"].between(350, 380)]
    derived = []
    for _, a in annual.iterrows():  # 연간에만 있는 4분기 복원
        inside = q[(q["start"] >= a["start"]) & (q["end"] <= a["end"])]
        if len(inside) == 3 and not (q["end"] == a["end"]).any():
            derived.append({"start": inside["end"].max() + pd.Timedelta(days=1), "end": a["end"],
                            "val": a["val"] - inside["val"].sum()})
    q = pd.concat([q, pd.DataFrame(derived)]).drop_duplicates("end").sort_values("end")
    return q.rename(columns={"val": "revenue"}).reset_index(drop=True)
