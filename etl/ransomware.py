"""랜섬웨어 피해 공개 건수 (월별) — ransomware.live 공개 API (유출 사이트에 올라온 피해 기관 집계).

보안 업황 지표: 공격이 늘면 보안 예산·제품 수요가 뒤따르는지(PANW·CRWD·RBRK 매출과 선행 상관) 본다.
금액이 아니라 건수라 series.unit='건' (웹은 이 단위면 달러로 표시하지 않음).
2021년 이전·초기 달은 수집 범위가 좁아 2022년부터 쓴다. 지난 달은 영구 캐시, 최근 2개월은 매일 다시 받음(늦게 공개되는 피해 반영).
"""
import json
import time
from datetime import date
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "raw" / "ransomware"
API = "https://api.ransomware.live/v2/victims"
START = "2022-01"


def _month(p: pd.Period, fresh: bool) -> list:
    path = CACHE / f"{p}.json"
    if path.exists() and not fresh:
        return json.loads(path.read_text())
    for attempt in range(3):
        r = requests.get(f"{API}/{p.year}/{p.month:02d}", timeout=120)
        if r.status_code == 200:
            break
        time.sleep(3 * (attempt + 1))
    r.raise_for_status()
    rows = r.json()
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows))
    time.sleep(1)  # 공개 API — 천천히
    return rows


def monthly(country: str | None = None) -> pd.DataFrame:
    """월별 피해 건수 (진행 중인 이번 달은 제외). country: 'US' 등 피해 기관 국가 필터(초기 데이터는 국가가 비어 있는 경우가 많음)."""
    today = pd.Period(date.today(), freq="M")
    out = []
    for p in pd.period_range(START, today - 1, freq="M"):
        rows = _month(p, fresh=p >= today - 2)
        n = sum(1 for x in rows if country is None or x.get("country") == country)
        out.append({"month": p, "value_usd": float(n), "unit": "건"})
    return pd.DataFrame(out)
