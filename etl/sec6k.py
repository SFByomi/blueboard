"""외국 발행사(20-F 제출사)의 분기 매출 — SEC XBRL엔 연간만 있어 분기 실적 6-K 보도자료 본문 표에서 읽는다.

ASML: 분기마다 'ASML reports ... results' 6-K를 내고, 보도자료 표에 'Total net sales  <직전 분기>  <당분기>'(백만 유로)가 있다.
→ 당분기 값을 그 분기 매출로. 분기 말일은 공시 월로 정함(1월 공시 = 전년 12월 말 분기).
공시 본문은 data/raw/sec6k에 캐시(지난 공시는 바뀌지 않음).
"""
import html
import re
from pathlib import Path

import pandas as pd
import requests

from etl.sec import UA

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "raw" / "sec6k"
FILERS = {"ASML": {"cik": 937966, "currency": "EUR", "label": r"(?:Total net sales|Net sales)", "unit": 1e6}}  # 2023년까지 보도자료는 "Net sales"
QUARTER_END = {1: (-1, 12, 31), 2: (-1, 12, 31), 4: (0, 3, 31), 5: (0, 3, 31), 7: (0, 6, 30), 8: (0, 6, 30), 10: (0, 9, 30), 11: (0, 9, 30)}


def _get(url: str) -> str:
    path = CACHE / re.sub(r"[^\w.]+", "_", url.split("/Archives/")[-1])
    if path.exists():
        return path.read_text()
    r = requests.get(url, headers=UA, timeout=60)
    r.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(r.text)
    return r.text


def _quarter_value(cik: int, acc: str, label: str) -> float | None:
    base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}"
    items = requests.get(f"{base}/index.json", headers=UA, timeout=60).json()["directory"]["item"]
    docs = sorted((i["name"] for i in items if i["name"].endswith(".htm") and "index" not in i["name"]),
                  key=lambda n: ("pressrelease" not in n, n))  # 보도자료 먼저
    for name in docs:
        txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", _get(f"{base}/{name}"))))
        m = re.search(label + r" ([\d,]{3,}) ([\d,]{3,})", txt)
        if m:
            return float(m.group(2).replace(",", ""))
    return None


def quarterly_revenue(ticker: str) -> pd.DataFrame:
    f = FILERS[ticker]
    sub = requests.get(f"https://data.sec.gov/submissions/CIK{f['cik']:010d}.json", headers=UA, timeout=60).json()["filings"]["recent"]
    rows = []
    for form, date, doc, acc in zip(sub["form"], sub["filingDate"], sub["primaryDocument"], sub["accessionNumber"]):
        d = pd.Timestamp(date)
        if form != "6-K" or "quarterly" not in doc or d.month not in QUARTER_END or d.year < 2019:
            continue
        dy, m, day = QUARTER_END[d.month]
        end = pd.Timestamp(d.year + dy, m, day)
        if any(r["end"] == end for r in rows):
            continue
        v = _quarter_value(f["cik"], acc, f["label"])
        if v is not None:
            rows.append({"start": end - pd.offsets.QuarterEnd(1) + pd.Timedelta(days=1), "end": end, "revenue": v * f["unit"]})
    return pd.DataFrame(rows).sort_values("end").reset_index(drop=True)
