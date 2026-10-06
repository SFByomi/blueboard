"""매핑 검증 CLI — 무역 시리즈가 종목 분기 매출을 얼마나 따라가는지.

  python -m etl.check MU                          # 매핑된 시리즈 전부
  python -m etl.check DELL --probe census '{"dataset":"imports/hs","hs":"847150","filters":{"CTY_CODE":"2010"}}'
  python -m etl.check DELL --sec DELL --probe ...  # DB에 아직 없는 종목: SEC에서 매출을 바로 받아 검증

출력: 분기 수, 금액 상관(level), 전년비 상관(YoY), 한 분기 선행 YoY 상관(lead).
기준(경험치): YoY ≥ 0.6 이면 회사출하·생산출하 후보, 0.3~0.6 업황 프록시, 그 아래는 매핑 근거를 다시 볼 것.
"""
import argparse
import json

import pandas as pd

from etl import sec, sources
from etl.db import connect


def quarterly(monthly: pd.DataFrame, fin: pd.DataFrame) -> pd.Series:
    """회계분기 [start, end]에 월 중순이 들어가는 달을 합산. 3개월이 다 있어야 값."""
    m = monthly.copy()
    m["mid"] = m["month"].dt.to_timestamp() + pd.Timedelta(days=14)
    out = []
    for _, q in fin.iterrows():
        v = m[(m.mid >= q.start) & (m.mid <= q.end)]["value_usd"]
        out.append(v.sum() if len(v) == 3 else None)
    return pd.Series(out, index=fin.end, dtype=float)


def score(trade_q: pd.Series, rev: pd.Series) -> dict:
    df = pd.DataFrame({"t": trade_q.values, "r": rev.values}).dropna()
    df = df[df.t > 0]
    yo = pd.DataFrame({"t": trade_q.pct_change(4, fill_method=None).values, "r": rev.pct_change(4, fill_method=None).values})
    lead = pd.DataFrame({"t": trade_q.pct_change(4, fill_method=None).shift(1).values, "r": rev.pct_change(4, fill_method=None).values})
    c = lambda d: round(d.dropna().corr().iloc[0, 1], 2) if len(d.dropna()) >= 4 else None  # noqa: E731
    return {"n": len(df), "level": c(df), "yoy": c(yo), "lead": c(lead)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ticker")
    ap.add_argument("--sec", help="DB에 없는 종목: SEC 티커로 매출 직접 조회")
    ap.add_argument("--probe", nargs=2, metavar=("SOURCE", "SPEC_JSON"), action="append", default=[])
    ap.add_argument("--since", default="2021-01-01")
    a = ap.parse_args()
    con = connect()
    if a.sec:
        q = sec.quarterly_revenue(a.sec)
        fin = pd.DataFrame({"start": q.start, "end": q.end, "revenue": q.revenue})
    else:
        fin = pd.read_sql("SELECT period_start start, period_end end, revenue FROM financials WHERE ticker=? ORDER BY period_end", con, params=(a.ticker,))
        fin["start"], fin["end"] = pd.to_datetime(fin.start), pd.to_datetime(fin.end)
    fin = fin[fin.end >= a.since].reset_index(drop=True)
    if fin.empty:
        raise SystemExit("매출 데이터가 없습니다 (etl.build 먼저 또는 --sec 사용)")
    rev = pd.Series(fin.revenue.values, index=fin.end)
    print(f"{a.ticker} 매출 {len(fin)}분기 ({fin.end.min():%Y-%m} ~ {fin.end.max():%Y-%m})")

    rows = []
    for sid, label in con.execute("SELECT m.series_id, s.label FROM mappings m JOIN series s ON s.id=m.series_id WHERE m.ticker=?", (a.ticker,)):
        obs = pd.read_sql("SELECT month, value_usd FROM observations WHERE series_id=?", con, params=(sid,))
        obs["month"] = pd.PeriodIndex(obs.month, freq="M")
        rows.append((sid, label, score(quarterly(obs, fin), rev)))
    for src, spec in a.probe:
        df = sources.fetch(src, json.loads(spec))
        rows.append(("probe", f"{src} {spec[:70]}", score(quarterly(df[["month", "value_usd"]], fin), rev)))
    for sid, label, s in rows:
        print(f"  {sid:28} n={s['n']:2} level={s['level']!s:>5} yoy={s['yoy']!s:>5} lead={s['lead']!s:>5}  {label}")


if __name__ == "__main__":
    main()
