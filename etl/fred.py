"""FRED(세인트루이스 연준) CSV — 키·호출 한도 없이 BLS 물가지수(PPI·수출입 가격지수) 등을 받는다."""
import io

import pandas as pd
import requests

URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"


def series(sid: str) -> pd.DataFrame:
    """[date(Timestamp), value] — 결측('.')은 제거"""
    r = requests.get(URL, params={"id": sid}, timeout=60)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    df.columns = ["date", "value"]
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df["date"] = pd.to_datetime(df["date"])
    return df.dropna()
