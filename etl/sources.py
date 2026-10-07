"""시계열 소스 레지스트리 — series.source 값 → 수집 함수.

새 나라·기관 데이터(예: 대만 재정부 'tw', 홍콩 'hk', 중국 해관 'cn')를 붙일 때:
1. etl/<소스>.py 에 월별 DataFrame[month(Period M), value_usd, (qty, unit)]을 돌려주는 함수를 만든다
2. 아래 FETCHERS에 `"<소스>": lambda spec: ...` 한 줄을 추가한다
3. data/curation.json 의 series에 {"source": "<소스>", "spec": {...}} 로 시리즈를 정의한다
build·웹·검증(etl.check)은 소스를 몰라도 그대로 동작한다.
"""
from collections.abc import Callable

import pandas as pd

from etl import census, estat, kcs, ransomware

FETCHERS: dict[str, Callable[[dict], pd.DataFrame]] = {
    "census": lambda s: census.fetch(s["dataset"], s["hs"], s["filters"]),
    "estat": lambda s: estat.monthly_usd(s["flow"], s["hs9"], s["offices"], s.get("country")),
    "ransomware": lambda s: ransomware.monthly(s.get("country")),  # 건수 시계열 (value_usd 칸에 건수, unit='건')
    "kcs": lambda s: kcs.fetch(s["api"], s["hs"], s.get("flow", "export"), s.get("cnty"), sido=s.get("sido"), sgg=s.get("sgg")),
}


def fetch(source: str, spec: dict) -> pd.DataFrame:
    if source not in FETCHERS:
        raise ValueError(f"지원하지 않는 source: {source} (etl/sources.py FETCHERS에 등록 필요)")
    return FETCHERS[source](spec)
