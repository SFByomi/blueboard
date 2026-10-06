"""미국 Census International Trade API 수집기.

- imports/hs   : 수입, HS10까지, 국가·세관구역(DISTRICT) 필터, 수량(QY1)
- exports/statehs : 주(State)별 수출, HS6
결과는 data/raw/census/ 에 JSON 캐시 (같은 쿼리는 재호출 안 함, refresh=True로 갱신).
"""
import hashlib
import json
import os
import threading
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
BASE = "https://api.census.gov/data/timeseries/intltrade"
CACHE = ROOT / "data" / "raw" / "census"

# 데이터셋별 필드 이름 차이 흡수
DATASETS = {
    "imports/hs": {"comm": "I_COMMODITY", "val": "GEN_VAL_MO", "qty": "GEN_QY1_MO", "unit": "UNIT_QY1"},
    "exports/hs": {"comm": "E_COMMODITY", "val": "ALL_VAL_MO", "qty": "QTY_1_MO", "unit": "UNIT_QY1"},
    "exports/statehs": {"comm": "E_COMMODITY", "val": "ALL_VAL_MO", "qty": None, "unit": None},
    "imports/statehs": {"comm": "I_COMMODITY", "val": "GEN_VAL_MO", "qty": None, "unit": None},
}


def fetch(dataset: str, hs, filters: dict, start="2020-01", refresh=False) -> pd.DataFrame:
    """월별 [month, value_usd, qty, unit] 반환. hs 길이로 COMM_LVL 자동 결정.
    hs에 리스트를 주면 합산 — HS10 세번 분할/변경으로 끊긴 시계열을 이을 때 사용."""
    if isinstance(hs, (list, tuple)):
        parts = [fetch(dataset, h, filters, start, refresh) for h in hs]
        df = pd.concat(parts)
        agg = {c: ("first" if c == "unit" else "sum") for c in df.columns if c != "month"}
        return df.groupby("month", as_index=False).agg(agg)
    d = DATASETS[dataset]
    fields = [d["val"]] + ([d["qty"], d["unit"]] if d["qty"] else [])
    params = {"get": ",".join(fields), d["comm"]: hs, "COMM_LVL": f"HS{len(hs)}",
              "time": f"from {start}", **filters}
    key = hashlib.md5(json.dumps([dataset, params], sort_keys=True).encode()).hexdigest()[:12]
    path = CACHE / f"{dataset.replace('/', '_')}_{hs}_{key}.json"

    if path.exists() and not refresh:
        rows = json.loads(path.read_text())
    else:
        r = requests.get(f"{BASE}/{dataset}", params={**params, "key": os.environ["CENSUS_API_KEY"]}, timeout=60)
        if r.status_code == 204:  # 데이터 없음
            rows = [fields + ["time"]]
        else:
            r.raise_for_status()
            rows = r.json()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{threading.get_ident()}.tmp")  # 병렬 수집 중 같은 파일 동시 쓰기·반쯤 쓴 파일 읽기 방지
        tmp.write_text(json.dumps(rows))
        tmp.replace(path)

    df = pd.DataFrame(rows[1:], columns=rows[0])
    out = pd.DataFrame({"month": pd.PeriodIndex(df["time"], freq="M") if len(df) else pd.PeriodIndex([], freq="M"),
                        "value_usd": pd.to_numeric(df[d["val"]]) if len(df) else []})
    if d["qty"] and len(df):
        out["qty"] = pd.to_numeric(df[d["qty"]])
        out["unit"] = df[d["unit"]]
    return out.groupby("month", as_index=False).agg({c: ("first" if c == "unit" else "sum") for c in out.columns if c != "month"})
