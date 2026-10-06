"""매핑 검증 CLI — 무역 시리즈가 종목 분기 매출을 얼마나 따라가는지.

  python -m etl.check MU                          # 매핑된 시리즈 전부
  python -m etl.check DELL --probe census '{"dataset":"imports/hs","hs":"847150","filters":{"CTY_CODE":"2010"}}'
  python -m etl.check DELL --sec DELL --probe ...  # DB에 아직 없는 종목: SEC에서 매출을 바로 받아 검증

출력: 등급, 전년비 표본 수, 금액 상관, 전년비 상관(무역 0·+1·+2분기 선행), 최근 8분기 상관 — 정의는 etl/scores.py.
기준(경험치): A(≥0.7)·B(≥0.5) 회사출하·생산출하 후보, C(0.3~0.5) 업황 프록시, D는 매핑 근거를 다시 볼 것.
후보 품목·국가를 자동으로 훑으려면 etl.discover.
"""
import argparse
import json

import pandas as pd

from etl import sec, sources
from etl.db import connect
from etl.scores import evaluate, fin_frame, monthly, quarterly


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
        fin = fin_frame(con, a.ticker, a.since)
    fin = fin[fin.end >= a.since].reset_index(drop=True)
    if fin.empty:
        raise SystemExit("매출 데이터가 없습니다 (etl.build 먼저 또는 --sec 사용)")
    rev = pd.Series(fin.revenue.values, index=fin.end)
    print(f"{a.ticker} 매출 {len(fin)}분기 ({fin.end.min():%Y-%m} ~ {fin.end.max():%Y-%m})")

    rows = []
    for sid, label in con.execute("SELECT m.series_id, s.label FROM mappings m JOIN series s ON s.id=m.series_id WHERE m.ticker=?", (a.ticker,)):
        rows.append((sid, label, evaluate(quarterly(monthly(con, sid), fin), rev)))
    for src, spec in a.probe:
        df = sources.fetch(src, json.loads(spec))
        rows.append(("probe", f"{src} {spec[:70]}", evaluate(quarterly(df[["month", "value_usd"]], fin), rev)))
    f = lambda v: f"{v:5.2f}" if v is not None else "    -"  # noqa: E731
    print(f"  {'':28} {'등급':>2} {'n':>3} {'금액':>5} {'YoY':>5} {'+1Q':>5} {'+2Q':>5} {'최근8':>5}")
    for sid, label, s in sorted(rows, key=lambda r: -(r[2]["best"] or -9)):
        print(f"  {sid:28} {s['grade'] or '-':>3} {s['n_yoy']:3} {f(s['level'])} {f(s['yoy0'])} {f(s['yoy1'])} {f(s['yoy2'])} {f(s['recent'])}  {label}")


if __name__ == "__main__":
    main()
