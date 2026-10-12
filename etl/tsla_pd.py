"""테슬라 분기 생산·인도·에너지저장 배치 (Production, Deliveries & Deployments) — 분기 끝나고 2일쯤 나오는 8-K 보도자료.

실적 발표(약 3주 뒤)보다 먼저 그 분기 인도 대수를 알 수 있어 진행 분기 매출 추정의 핵심 근거.
- 인도: "Total <생산> <인도>" 표 → 대
- 에너지저장 배치: "deployed 13.7 GWh of energy storage" → GWh (에너지 부문 매출 선행)
시계열 저장은 capex와 같이 분기 값을 그 분기 3개월에 ÷3씩 (scores.quarterly가 3개월 합 = 분기 값으로 읽음).
보도자료 본문은 guidance와 같은 캐시(data/raw/guidance) 사용.
"""
import json
import re
from pathlib import Path

import pandas as pd

from etl import guidance
from etl.sec import cik

ORD = {"first": 1, "second": 2, "third": 3, "fourth": 4}


def quarterly() -> pd.DataFrame:
    """[quarter(Period Q), deliveries, production, storage_gwh]"""
    c = cik("TSLA")
    sub = guidance._get(f"https://data.sec.gov/submissions/CIK{c}.json").json()["filings"]["recent"]
    rows = {}
    for form, filed, acc, items in zip(sub["form"], sub["filingDate"], sub["accessionNumber"], sub["items"]):
        if form != "8-K" or "2.02" not in items or filed < "2019-01-01":
            continue
        txt = guidance._text(int(c), acc)
        if not txt:
            continue
        t = re.search(r"(?i)Tesla (First|Second|Third|Fourth) Quarter (\d{4}) (?:Vehicle )?Production(?:,| and) Deliveries", txt[:600])
        tot = re.search(r"Total ([\d,]{5,}) ([\d,]{5,})", txt)
        if not t or not tot:
            continue  # 실적 발표(Update) 8-K 등
        q = pd.Period(f"{t.group(2)}Q{ORD[t.group(1).lower()]}", freq="Q")
        g = re.search(r"(?i)deployed ([\d.]+) GWh", txt)
        rows[q] = {"quarter": q, "production": int(tot.group(1).replace(",", "")), "deliveries": int(tot.group(2).replace(",", "")),
                   "storage_gwh": float(g.group(1)) if g else None}
    return pd.DataFrame(sorted(rows.values(), key=lambda r: r["quarter"]))


HIST = Path(__file__).resolve().parents[1] / "data" / "tsla_pd_hist.json"  # 8-K로 내기 전 분기(2019~2024Q2) — 회사 보도자료 값


def monthly(metric: str) -> pd.DataFrame:
    """metric: deliveries | storage_gwh → [month, value_usd(그 지표 값 ÷3), unit]. 8-K 값이 우선, 그 전은 data/tsla_pd_hist.json"""
    hist = json.loads(HIST.read_text(encoding="utf-8")).get(metric, {}) if HIST.exists() else {}
    q = quarterly().dropna(subset=[metric])
    have = set(q.quarter)
    old = pd.DataFrame([{"quarter": pd.Period(k, freq="Q"), metric: v} for k, v in hist.items() if pd.Period(k, freq="Q") not in have])
    q = pd.concat([old, q[["quarter", metric]]]).sort_values("quarter") if len(old) else q
    unit = "GWh" if metric == "storage_gwh" else "대"
    rows = [(p.asfreq("M", "start") + i, v / 3) for p, v in zip(q.quarter, q[metric]) for i in range(3)]
    df = pd.DataFrame(rows, columns=["month", "value_usd"])
    df["unit"] = unit
    return df


