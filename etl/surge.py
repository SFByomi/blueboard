"""급등 탐지: 미국 HS6 전 품목(1~97장) 세계 합계(수입·수출) + 관심 품목의 국가별 수입 + 미국 수입 중 한국산 비중.

전 품목은 '월 하나 = Census 호출 하나'(HS6 약 5,500개, 10초 안팎)로 받는다 — 장(章)별 호출은 수출 API가 너무 느림.
지난 달은 data/raw/surge/months에 영구 캐시, 최근 4개월은 수정치가 나오므로 날마다 다시 받음.

지표 (최신월 L 기준): MoM, YoY, 3개월 합 YoY, z-score(직전 12개월 대비)
"""
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from etl.census import BASE

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "raw" / "surge"
TECH_CHAPTERS = ["28", "29", "30", "38", "74", "84", "85", "90"]  # 화학·의약·구리·기계·전자·광학/의료기기 (웹 '관심 분야' 필터)
RECENT = 4         # 최근 몇 개월은 영구 캐시하지 않음 (Census 수정치)
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
    tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(rows))
    tmp.replace(path)
    return rows


def world_month(flow: str, month: str, cty: str = "-") -> pd.DataFrame:
    """한 달치 HS6 전 품목 합계(cty='-'면 세계, 아니면 그 상대국). 아직 공개 전인 달은 빈 표(캐시 안 함)."""
    f = FLOW[flow]
    perm = CACHE / "months" / f"{flow}_{month}{'' if cty == '-' else f'_c{cty}'}.json"
    if perm.exists():
        rows = json.loads(perm.read_text())
    else:
        for attempt in range(3):  # 전 품목 한 달치는 가끔 500 — 잠시 뒤 재시도하면 대개 됨
            r = requests.get(f"{BASE}/{flow}/hs", params={"get": f"{f['val']},{f['comm']},{f['desc']}", "COMM_LVL": "HS6",
                                                          "CTY_CODE": cty, "time": month, "key": os.environ["CENSUS_API_KEY"]}, timeout=300)
            if r.status_code < 500 or attempt == 2:
                break
            time.sleep(5 * (attempt + 1))
        rows = [] if r.status_code == 204 else (r.raise_for_status() or r.json())
        old = pd.Period(month, freq="M") < pd.Period(date.today(), freq="M") - RECENT
        if rows and old:
            perm.parent.mkdir(parents=True, exist_ok=True)
            tmp = perm.with_suffix(f".{threading.get_ident()}.tmp")
            tmp.write_text(json.dumps(rows))
            tmp.replace(perm)
    if len(rows) < 2:
        return pd.DataFrame(columns=["hs6", "desc", "partner", "partner_name", "month", "value"])
    df = pd.DataFrame(rows[1:], columns=rows[0])
    return pd.DataFrame({"hs6": df[f["comm"]], "desc": df[f["desc"]], "partner": cty, "partner_name": "World" if cty == "-" else cty,
                         "month": df["time"], "value": pd.to_numeric(df[f["val"]])})


KOREA = "5800"
MIN_KR = 5e6  # 한국산: 최근 3개월 월평균 5백만 달러 이상


def kr_share(world: pd.DataFrame, kr: pd.DataFrame) -> list[dict]:
    """미국 수입 중 한국산 비중(3개월 합 기준) — 지금 vs 1년 전. 한국 수출 경쟁력·대미 수출 전환을 품목별로."""
    p = lambda d: d.pivot_table(index="month", columns="hs6", values="value", aggfunc="sum").fillna(0.0)  # noqa: E731
    w, k = p(world), p(kr)
    k = k.reindex(index=w.index, columns=w.columns, fill_value=0.0)
    w3, k3 = w.rolling(3).sum(), k.rolling(3).sum()
    share = (k3 / w3.where(w3 > 0)).iloc[-27:]
    latest = w.index[-1]
    out = []
    for hs in w.columns:
        s = share[hs]
        now, ago = s.iloc[-1], s.iloc[-13] if len(s) >= 13 else None
        kr_avg = k3[hs].iloc[-1] / 3
        if kr_avg < MIN_KR or w3[hs].iloc[-1] / 3 < MIN_WORLD or pd.isna(now):
            continue
        out.append({"hs6": hs, "month": latest, "kr_usd": float(kr_avg), "world_usd": float(w3[hs].iloc[-1] / 3),
                    "share": float(now), "share_ago": None if ago is None or pd.isna(ago) else float(ago),
                    "change": None if ago is None or pd.isna(ago) else float(now - ago),
                    "spark": json.dumps([None if pd.isna(v) else round(float(v) * 100, 2) for v in s.iloc[-24:].values])})
    return out


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
            # 3개월 전년비도 같은 기준: 전년 같은 3개월 '각 달'이 기준값 이상일 때만 (→ 3M 값이 있으면 YoY도 항상 있음)
            "yoy3m": (s.iloc[-3:].sum() / s.iloc[-15:-12].sum() - 1) if s.iloc[-15:-12].min() >= floor else None,
            "z": float((L - prev12.mean()) / sd) if sd > 0 else None,
            "spark": json.dumps([round(v / 1e6, 2) for v in s.reindex(months).values]),
        })
    return out


def _parallel(fn, keys, label, log, workers=6) -> list:
    """Census 조회를 동시에 (수출 API는 건당 15~40초). 한 건 실패가 전체를 막지 않게 로그만 남김."""
    out = []
    with ThreadPoolExecutor(workers) as pool:
        futs = {pool.submit(fn, k): k for k in keys}
        for f in as_completed(futs):
            try:
                out.append(f.result())
                log(f"  surge {label}{futs[f]}")
            except Exception as e:  # noqa: BLE001
                log(f"  ✗ {label}{futs[f]}: {str(e).split('?')[0]}")  # URL 쿼리에 API 키가 있어 잘라냄
    return out


def scan(con, tagged_hs6: list[str], log=print):
    rows = []
    months = [str(m) for m in pd.period_range(START, pd.Period(date.today(), freq="M"), freq="M")]
    world = {}
    for flow, scope in [("imports", "us_imp_world"), ("exports", "us_exp_world")]:
        parts = _parallel(lambda m, flow=flow: world_month(flow, m), months, f"{flow} ", log)
        df = world[flow] = pd.concat([x for x in parts if len(x)])
        if len({*df["month"]}) < len(months) - 3:  # 공개 지연 2개월 안팎 — 그보다 많이 비면 일부 조회 실패
            log(f"  ⚠ {flow}: {len({*df['month']})}/{len(months)}개월만 받음")
        latest = pd.Period(df["month"].max(), freq="M")
        rows += [{**r, "scope": scope} for r in metrics(df, latest, MIN_WORLD)]
        con.executemany("INSERT INTO hs_names (hs, name_en) VALUES (?, ?) "  # 시드가 한국어 이름만 넣어둔 행도 영문 채움
                        "ON CONFLICT(hs) DO UPDATE SET name_en=coalesce(hs_names.name_en, excluded.name_en)",
                        df[["hs6", "desc"]].drop_duplicates("hs6").values.tolist())
    parts = [p for p in _parallel(by_country, tagged_hs6, "국가별 ", log) if len(p)]
    if parts:
        df = pd.concat(parts)
        rows += [{**r, "scope": "us_imp_cty"} for r in metrics(df, pd.Period(df["month"].max(), freq="M"), MIN_CTY)]

    parts = _parallel(lambda m: world_month("imports", m, KOREA), months, "한국산 ", log)
    kr = pd.concat([x for x in parts if len(x)])
    kr = kr[kr["month"] <= world["imports"]["month"].max()]
    shares = kr_share(world["imports"], kr)
    con.execute("DELETE FROM kr_share")
    con.executemany("INSERT INTO kr_share VALUES (:hs6, :month, :kr_usd, :world_usd, :share, :share_ago, :change, :spark)", shares)
    log(f"  한국 비중 {len(shares)}개 품목")

    con.execute("DELETE FROM surge")
    con.executemany("""INSERT INTO surge (scope, hs6, partner, partner_name, month, value_usd, mom, yoy, yoy3m, z, spark)
                       VALUES (:scope, :hs6, :partner, :partner_name, :month, :value_usd, :mom, :yoy, :yoy3m, :z, :spark)""",
                    [{k: (None if isinstance(v, float) and np.isnan(v) else v) for k, v in r.items()} for r in rows])
    return len(rows)
