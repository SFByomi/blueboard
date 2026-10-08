"""미국 건설투자(Construction Spending, Census C30) — 민간 부문 세부 유형별, 계절조정 연율(SAAR).

API(eits/vip)에는 대분류만 있어 데이터센터·전력·반도체/전자 공장 같은 세부 유형은 공개 엑셀(privsatime.xlsx)에서 읽는다.
value_usd = 연율 달러(원표 백만 달러 × 1e6). 매월 1일께 발표, 최근 2개월은 잠정치(p·r)라 매일 새로 받는다.
"""
import re
from datetime import date
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "raw" / "c30"
URL = "https://www.census.gov/construction/c30/xlsx/privsatime.xlsx"


def _table() -> pd.DataFrame:
    path = CACHE / f"privsatime_{date.today():%Y%m%d}.xlsx"  # 하루 한 번만 받음 (시리즈 여러 개가 같은 파일 사용)
    if not path.exists():
        r = requests.get(URL, timeout=120, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        CACHE.mkdir(parents=True, exist_ok=True)
        for old in CACHE.glob("privsatime_*.xlsx"):
            old.unlink()
        path.write_bytes(r.content)
    x = pd.read_excel(path, header=None)
    hdr = next(i for i in range(10) if str(x.iat[i, 0]).strip() == "Date")
    cols = [re.sub(r"\s+", " ", re.sub(r"_x000D_|\d+$", "", str(c))).replace("/ ", "/").strip() for c in x.iloc[hdr]]
    body = x.iloc[hdr + 1:].copy()
    body.columns = cols
    body["month"] = pd.to_datetime(body["Date"].astype(str).str.rstrip("pr"), format="%b-%y", errors="coerce")
    return body[body["month"].notna()]


def monthly(column: str, start: str = "2020-01") -> pd.DataFrame:
    """column: 엑셀 머리글(예: 'Data center', 'Electric', 'Computer/electronic/electrical')"""
    t = _table()
    if column not in t.columns:
        raise KeyError(f"C30 열 없음: {column} (있는 열: {', '.join(c for c in t.columns if c)})")
    v = pd.to_numeric(t[column], errors="coerce")
    df = pd.DataFrame({"month": t["month"].dt.to_period("M"), "value_usd": v * 1e6}).dropna()
    df = df[df["month"] >= pd.Period(start, freq="M")]  # 다른 시계열과 같은 구간 (종목 차트 x축이 1993년부터 늘어나지 않게)
    return df.sort_values("month").reset_index(drop=True)
