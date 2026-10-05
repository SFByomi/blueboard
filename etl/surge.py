"""급등 탐지: 미국 HS6 품목별 세계 합계(수입·수출) + 관심 품목의 국가별 수입.

지표 (최신월 L 기준): MoM, YoY, 3개월 합 YoY, z-score(직전 12개월 대비)
"""
import json
import os
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from etl.census import BASE

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "raw" / "surge"
CHAPTERS = ["28", "29", "30", "38", "74", "84", "85", "90"]  # 화학·의약·구리·기계·전자·광학/의료기기
START = "2023-07"
MIN_WORLD = 20e6   # 세계 합계: 월 2천만 달러 이상만
MIN_CTY = 5e6      # 국가별: 월 5백만 달러 이상만

FLOW = {
    "imports": {"comm": "I_COMMODITY", "val": "GEN_VAL_MO", "desc": "I_COMMODITY_SDESC"},
    "exports": {"comm": "E_COMMODITY", "val": "ALL_VAL_MO", "desc": "E_COMMODITY_SDESC"},
}


def _census(dataset, params, name):
    # 캐시는 달마다 갱신 (새 월 데이터 반영)
    path = CACHE / date.today().strftime("%Y-%m") / f"{name}.json"
    if path.exists():
        return json.loads(path.read_text())
    r = requests.get(f"{BASE}/{dataset}", params={**params, "key": os.environ["CENSUS_API_KEY"]}, timeout=300)
    rows = [] if r.status_code == 204 else (r.raise_for_status() or r.json())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows))
    return rows


def world_hs6(flow: str, prefix: str) -> pd.DataFrame:
    """HS 앞자리 prefix(예: '85') 아래 HS6 세계 합계. 응답이 너무 크면(500) 한 자리 더 쪼개서 재시도."""
    f = FLOW[flow]
    try:
        rows = _census(f"{flow}/hs", {"get": f"{f['val']},{f['desc']}", f["comm"]: f"{prefix}*", "COMM_LVL": "HS6",
                                      "CTY_CODE": "-", "time": f"from {START}"}, f"{flow}_world_{prefix}")
    except requests.HTTPError:
        if len(prefix) >= 4:
            raise
        return pd.concat([world_hs6(flow, f"{prefix}{d}") for d in "0123456789"])
    if not rows:
        return pd.DataFrame(columns=["hs6", "desc", "partner", "partner_name", "month", "value"])
    df = pd.DataFrame(rows[1:], columns=rows[0])
    return pd.DataFrame({"hs6": df[f["comm"]], "desc": df[f["desc"]], "partner": "-", "partner_name": "World",
                         "month": df["time"], "value": pd.to_numeric(df[f["val"]])})


def by_country(hs6: str) -> pd.DataFrame:
    rows = _census("imports/hs", {"get": "GEN_VAL_MO,CTY_CODE,CTY_NAME", "I_COMMODITY": hs6, "COMM_LVL": "HS6",
                                  "time": f"from {START}"}, f"imports_cty_{hs6}")
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows[1:], columns=rows[0])
    df = df[~df["CTY_CODE"].str.startswith("0") & ~df["CTY_CODE"].str.contains("X") & (df["CTY_CODE"] != "-")]  # 지역 합계 제외
    return pd.DataFrame({"hs6": hs6, "desc": "", "partner": df["CTY_CODE"], "partner_name": df["CTY_NAME"],
                         "month": df["time"], "value": pd.to_numeric(df["GEN_VAL_MO"])})


def metrics(df: pd.DataFrame, latest: pd.Period, min_value: float) -> list[dict]:
    out = []
    months = pd.period_range(latest - 23, latest, freq="M")
    for (hs6, partner), g in df.groupby(["hs6", "partner"]):
        s = g.groupby(pd.PeriodIndex(g["month"], freq="M"))["value"].sum()
        s = s.reindex(pd.period_range(latest - 26, latest, freq="M"), fill_value=0.0)
        L = s.iloc[-1]
        if L < min_value:
            continue
        floor = min_value * 0.25  # 비교 기준(분모)이 너무 작으면 증가율이 폭주 → 계산 안 함
        ratio = lambda a, b, n=1: (a / b - 1) if b >= floor * n else None  # noqa: E731
        prev12 = s.iloc[-13:-1]
        sd = prev12.std()
        out.append({
            "hs6": hs6, "partner": partner, "partner_name": g["partner_name"].iloc[0], "desc": g["desc"].iloc[0],
            "month": str(latest), "value_usd": float(L),
            "mom": ratio(L, s.iloc[-2]), "yoy": ratio(L, s.iloc[-13]),
            "yoy3m": ratio(s.iloc[-3:].sum(), s.iloc[-15:-12].sum(), 3),
            "z": float((L - prev12.mean()) / sd) if sd > 0 else None,
            "spark": json.dumps([round(v / 1e6, 2) for v in s.reindex(months).values]),
        })
    return out


def scan(con, tagged_hs6: list[str], log=print):
    rows = []
    # 수입: 장(章) 전체 스캔 / 수출: Census 수출 API가 대량 조회에 매우 느려 관심 HS6만 품목 단위로 조회
    for flow, scope, prefixes in [("imports", "us_imp_world", CHAPTERS), ("exports", "us_exp_world", tagged_hs6)]:
        parts = []
        for ch in prefixes:
            log(f"  surge {flow} ch{ch}")
            try:
                parts.append(world_hs6(flow, ch))
            except Exception as e:  # noqa: BLE001 — 한 장(章) 실패가 전체를 막지 않게
                log(f"  ✗ {flow} ch{ch}: {e}")
        df = pd.concat([x for x in parts if len(x)])
        latest = pd.Period(df["month"].max(), freq="M")
        rows += [{**r, "scope": scope} for r in metrics(df, latest, MIN_WORLD)]
        con.executemany("INSERT OR IGNORE INTO hs_names (hs, name_en) VALUES (?, ?)",
                        df[["hs6", "desc"]].drop_duplicates("hs6").values.tolist())
    parts = []
    for hs6 in tagged_hs6:
        log(f"  surge 국가별 {hs6}")
        try:
            parts.append(by_country(hs6))
        except Exception as e:  # noqa: BLE001
            log(f"  ✗ 국가별 {hs6}: {e}")
    parts = [p for p in parts if len(p)]
    if parts:
        df = pd.concat(parts)
        rows += [{**r, "scope": "us_imp_cty"} for r in metrics(df, pd.Period(df["month"].max(), freq="M"), MIN_CTY)]

    con.execute("DELETE FROM surge")
    con.executemany("""INSERT INTO surge (scope, hs6, partner, partner_name, month, value_usd, mom, yoy, yoy3m, z, spark)
                       VALUES (:scope, :hs6, :partner, :partner_name, :month, :value_usd, :mom, :yoy, :yoy3m, :z, :spark)""",
                    [{k: (None if isinstance(v, float) and np.isnan(v) else v) for k, v in r.items()} for r in rows])
    return len(rows)
