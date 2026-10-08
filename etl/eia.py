"""미국 에너지정보청(EIA) — 발전소 건설 계획(860M 월간 엑셀) + 전력 판매(API v2).

- planned(metric): 매월 발표되는 '계획 중 발전기' 목록(Planned 시트)을 합산한 용량(MW). 가스(복합·단순), 상태별(착공 여부),
  태양광·배터리·풍력·원전. 지난 달 집계는 data/eia860m.json(git)에 저장 → 매 실행은 새로 나온 달만 받는다(파일 1개 ~14MB).
- retail(state, sector): 주별·부문별 월간 전력 판매량(GWh) — 예: 버지니아 상업용(데이터센터 밀집) 수요. EIA_API_KEY 필요.
"""
import json
import os
from datetime import date
from io import BytesIO
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
HIST = ROOT / "data" / "eia860m.json"
BASE = "https://www.eia.gov/electricity/data/eia860m"
START = "2021-01"
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
UNDER_CONSTRUCTION = ("(U)", "(V)", "(TS)")


def _aggregate(xlsx: bytes) -> dict:
    p = pd.read_excel(BytesIO(xlsx), sheet_name="Planned", header=None)
    hdr = next(i for i in range(10) if str(p.iat[i, 0]).strip() == "Entity ID")
    p.columns = [str(c).strip() for c in p.iloc[hdr]]
    p = p.iloc[hdr + 1:]
    mw = pd.to_numeric(p["Nameplate Capacity (MW)"], errors="coerce").fillna(0)
    tech, fuel, status = p["Technology"].astype(str), p["Energy Source Code"].astype(str), p["Status"].astype(str)
    gas = fuel.eq("NG")
    uc = status.str[:4].str.startswith(UNDER_CONSTRUCTION)
    s = lambda m: round(float(mw[m].sum()), 1)  # noqa: E731
    return {"gas": s(gas), "gas_cc": s(gas & tech.str.contains("Combined Cycle")), "gas_ct": s(gas & tech.str.contains("Combustion Turbine")),
            "gas_uc": s(gas & uc), "solar": s(tech.eq("Solar Photovoltaic")), "battery": s(tech.eq("Batteries")),
            "wind": s(tech.str.contains("Wind")), "nuclear": s(tech.eq("Nuclear"))}


def _download(p: pd.Period) -> bytes | None:
    name = f"{MONTHS[p.month - 1]}_generator{p.year}.xlsx"
    for path in (f"{BASE}/xls/{name}", f"{BASE}/archive/xls/{name}"):
        r = requests.get(path, timeout=180, headers={"User-Agent": "Mozilla/5.0"})
        if r.status_code == 200 and r.content[:2] == b"PK":  # 아직 안 나온 달은 404나 HTML
            return r.content
    return None


def history(log=print) -> dict:
    """{YYYY-MM: 집계} — 저장된 달은 그대로, 그 뒤 달만 새로 받는다(발표는 보통 다음 달 말)."""
    h = json.loads(HIST.read_text()) if HIST.exists() else {}
    last = pd.Period(max(h), freq="M") if h else pd.Period(START, freq="M") - 1
    for p in pd.period_range(last + 1, pd.Period(date.today(), freq="M") - 1, freq="M"):
        raw = _download(p)
        if raw is None:
            if h:  # 최신 달이 아직 없으면 거기서 멈춤
                break
            continue
        h[str(p)] = _aggregate(raw)
        log(f"  EIA 860M {p}: 계획 가스 {h[str(p)]['gas'] / 1000:.1f}GW")
        HIST.write_text(json.dumps(dict(sorted(h.items())), indent=0) + "\n")
    return h


def planned(metric: str) -> pd.DataFrame:
    h = history()
    df = pd.DataFrame([{"month": pd.Period(m, freq="M"), "value_usd": v[metric], "unit": "MW"} for m, v in h.items()])
    return df.sort_values("month").reset_index(drop=True)


def retail(state: str, sector: str) -> pd.DataFrame:
    """월간 전력 판매량(GWh) — state 'VA', sector 'COM'(상업)·'IND'(산업)·'ALL'"""
    r = requests.get("https://api.eia.gov/v2/electricity/retail-sales/data/", timeout=60, params={
        "api_key": os.environ["EIA_API_KEY"], "frequency": "monthly", "data[0]": "sales",
        "facets[stateid][]": state, "facets[sectorid][]": sector, "start": "2019-01",
        "sort[0][column]": "period", "sort[0][direction]": "asc", "length": 5000})
    r.raise_for_status()
    rows = r.json()["response"]["data"]
    df = pd.DataFrame({"month": pd.PeriodIndex([x["period"] for x in rows], freq="M"),
                       "value_usd": [float(x["sales"]) * 1000 for x in rows]})  # 백만 kWh = GWh → MWh
    df["unit"] = "MWh"
    return df
