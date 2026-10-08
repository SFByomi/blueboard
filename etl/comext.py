"""EU 회원국 무역 통계 — Eurostat Comext (DS-045409, HS2·4·6·CN8 월별, 키 불필요).

예: 네덜란드(NL)의 리소그래피 장비(8486.20) 수출 = ASML 벨트호번 출하. 금액은 유로 → FRED 월평균 환율(EXUSEU)로 달러 환산.
보통 두 달 뒤 중순에 공개 (9월 15일 갱신분이 6월까지).
"""
import pandas as pd
import requests

from etl import fred

API = "https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/DS-045409"
FLOW = {"import": 1, "export": 2}
_fx: pd.Series | None = None


def _eurusd() -> pd.Series:
    global _fx
    if _fx is None:
        d = fred.series("EXUSEU")  # 1유로당 달러, 월평균
        _fx = pd.Series(d.value.values, index=pd.PeriodIndex(d.date, freq="M"))
    return _fx


def monthly(reporter: str, product: str, partner: str = "WORLD", flow: str = "export", start: str = "2020-01") -> pd.DataFrame:
    r = requests.get(API, timeout=120, params={"format": "JSON", "lang": "en", "freq": "M", "reporter": reporter, "partner": partner,
                                               "product": product, "flow": FLOW[flow], "indicators": "VALUE_IN_EUROS",
                                               "sinceTimePeriod": start})
    r.raise_for_status()
    d = r.json()
    times = list(d["dimension"]["time"]["category"]["index"])
    eur = pd.Series({pd.Period(times[int(k)], freq="M"): float(v) for k, v in d.get("value", {}).items()}).sort_index()
    if eur.empty:
        return pd.DataFrame(columns=["month", "value_usd"])
    fx = _eurusd().reindex(eur.index).ffill().fillna(_eurusd().iloc[-1])  # 최신 달 환율이 아직 없으면 마지막 값
    return pd.DataFrame({"month": eur.index, "value_usd": (eur * fx).values})
