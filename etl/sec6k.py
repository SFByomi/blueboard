"""외국 발행사(20-F 제출사)의 분기 매출 — SEC XBRL엔 연간만 있어 분기 실적 6-K 보도자료 본문 표에서 읽는다.

ASML: 분기마다 'ASML reports ... results' 6-K를 내고, 보도자료 표에 'Total net sales  <직전 분기>  <당분기>'(백만 유로)가 있다.
→ 당분기 값을 그 분기 매출로. 분기 말일은 공시 월로 정함(1월 공시 = 전년 12월 말 분기).
공시 본문은 data/raw/sec6k에 캐시(지난 공시는 바뀌지 않음).
"""
import html
import json
import re
from pathlib import Path

import pandas as pd
import requests

from etl.sec import UA

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "raw" / "sec6k"
FILERS = {
    "ASML": {"cik": 937966, "currency": "EUR", "label": r"(?:Total net sales|Net sales)", "unit": 1e6},  # 2023년까지 보도자료는 "Net sales"
    # Nebius: 'Nebius reports second quarter 2026 financial results' 첨부(ex99) 표 'Revenues <전년 동기> <당분기>'(백만 달러). 문서명에 분기 표시가 없어 제목으로 분기를 정함
    "NBIS": {"cik": 1513845, "currency": "USD", "label": r"Revenues", "unit": 1e6,
             "since": "2024-04-01",  # 그 전은 얀덱스 시절(루블) — Nebius 계속사업은 2024년 2분기부터
             "title": r"(first|second|third|fourth) quarter(?: and full[- ]year)?(?: (\d{4}))? (?:unaudited )?(?:financial )?results"},
}
ORD = {"first": (3, 31), "second": (6, 30), "third": (9, 30), "fourth": (12, 31)}
RESULTS = CACHE / "results.json"  # 공시번호 → [분기 말일, 값] | null — 지난 공시는 다시 읽지 않음
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


def _quarter_value(cik: int, acc: str, f: dict, filed: pd.Timestamp) -> tuple[str | None, float] | None:
    """(제목에서 읽은 분기 말일 | None, 당분기 값). 보도자료가 아니면 None"""
    base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}"
    items = requests.get(f"{base}/index.json", headers=UA, timeout=60).json()["directory"]["item"]
    docs = sorted((i["name"] for i in items if i["name"].endswith(".htm") and "index" not in i["name"]),
                  key=lambda n: ("pressrelease" not in n and "99" not in n, n))  # 보도자료(첨부 99) 먼저
    for name in docs:
        txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", _get(f"{base}/{name}"))))
        end = None
        if f.get("title"):
            t = re.search(f["title"], txt[:3000], re.I)
            if not t:
                continue
            m_, d_ = ORD[t.group(1).lower()]
            year = t.group(2) or (filed.year - (m_ == 12))  # 제목에 연도가 없으면 공시일로 (2월 공시의 4분기 = 전년)
            end = f"{year}-{m_:02d}-{d_:02d}"
        m = re.search(f["label"] + r" \(?([\d,]+(?:\.\d+)?)\)? \(?([\d,]+(?:\.\d+)?)\)?", txt)
        if m and len(m.group(2).replace(",", "").split(".")[0]) >= (1 if "." in m.group(2) else 3):
            return end, float(m.group(2).replace(",", ""))
    return None


def quarterly_revenue(ticker: str) -> pd.DataFrame:
    f = FILERS[ticker]
    sub = requests.get(f"https://data.sec.gov/submissions/CIK{f['cik']:010d}.json", headers=UA, timeout=60).json()["filings"]["recent"]
    done = json.loads(RESULTS.read_text()) if RESULTS.exists() else {}
    rows = []
    for form, date, doc, acc in zip(sub["form"], sub["filingDate"], sub["primaryDocument"], sub["accessionNumber"]):
        d = pd.Timestamp(date)
        if form != "6-K" or d.month not in QUARTER_END or d.year < 2019 or (not f.get("title") and "quarterly" not in doc):
            continue
        if acc not in done:
            r = _quarter_value(f["cik"], acc, f, d)
            done[acc] = list(r) if r else None
        if not done[acc]:
            continue
        end_s, v = done[acc]
        if end_s:
            end = pd.Timestamp(end_s)
        else:
            dy, m, day = QUARTER_END[d.month]
            end = pd.Timestamp(d.year + dy, m, day)
        if any(r["end"] == end for r in rows):  # 최신 공시 우선 (정정·재게시)
            continue
        rows.append({"start": end - pd.offsets.QuarterEnd(1) + pd.Timedelta(days=1), "end": end, "revenue": v * f["unit"]})
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    RESULTS.write_text(json.dumps(done))
    df = pd.DataFrame(rows).sort_values("end").reset_index(drop=True)
    return df[df.start >= f.get("since", "2000-01-01")].reset_index(drop=True)
