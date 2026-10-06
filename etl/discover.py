"""매핑 후보 자동 탐색 — HS 품목 × 국가(또는 주)를 훑어 종목 매출과 전년비 상관이 높은 흐름을 찾는다.

  python -m etl.discover DELL                                  # hs_tags의 HS6 × 미국 수입 상대국 전부
  python -m etl.discover TXG --sec TXG --hs 902780+902789 --state CA   # 캘리포니아 수출 × 상대국 (+는 분할 세번 합산)
  python -m etl.discover BE --hs 850132 --by state             # 주별 수출 (전세계향)
  python -m etl.discover AAON --hs 841582 --by state --cty 1220  # 주별 캐나다향 수출
  python -m etl.discover BE --hs 282560 750400 --state DE --flow imports  # 델라웨어 공장으로 들어오는 원자재 (생산 투입)

품목 하나당 Census 호출 1번(상대국·주를 한꺼번에 받음) → data/raw/census/discover_* 캐시.
결과는 등급순 표 + curation.json series.spec에 그대로 붙일 수 있는 spec. 점수 정의는 etl/scores.py.
상위 후보도 반드시 생산거점·고객 구조로 근거를 확인한 뒤 등록할 것 — 수십 개를 훑으면 우연히 높은 상관이 나온다.
"""
import argparse
import json
import os

import pandas as pd
import requests

from etl import census, sec
from etl.db import connect
from etl.scores import evaluate, fin_frame, quarterly

TOTAL = "-"


def _get(dataset: str, params: dict) -> list[list[str]]:
    name = "_".join(f"{k}-{v}" for k, v in sorted(params.items()) if k != "get").replace(" ", "")
    path = census.CACHE / f"discover_{dataset.replace('/', '_')}_{name}.json"
    if path.exists():
        return json.loads(path.read_text())
    r = requests.get(f"{census.BASE}/{dataset}", params={**params, "key": os.environ["CENSUS_API_KEY"]}, timeout=180)
    rows = [] if r.status_code == 204 else (r.raise_for_status() or r.json())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows))
    return rows


STATE_DS = {"exports": ("exports/statehs", "E_COMMODITY", "ALL_VAL_MO"),   # 주(원산지) 수출
            "imports": ("imports/statehs", "I_COMMODITY", "GEN_VAL_MO")}   # 주(최종 목적지) 수입 — 공장이 들여오는 부품·원자재


def panel(hs: str, a, start: str) -> tuple[pd.DataFrame, dict]:
    """월 × 상대(국가 또는 주) 금액 표.
    by=state: 주별 (a.flow 수출/수입, a.cty로 상대국 필터) · a.state: 그 주의 a.flow를 상대국별 · 둘 다 없으면 미국 전체 수입 상대국별."""
    if a.by == "state" or a.state:
        ds, comm, val = STATE_DS[a.flow]
        key = "STATE" if a.by == "state" else "CTY_CODE"
        extra = ({"CTY_CODE": a.cty} if a.cty else {}) if a.by == "state" else {"STATE": a.state}
    else:
        ds, comm, val, key = "imports/hs", "I_COMMODITY", "GEN_VAL_MO", "CTY_CODE"
        extra = {}
    get = [key] + (["CTY_NAME"] if key == "CTY_CODE" else []) + [val]
    rows = _get(ds, {"get": ",".join(get), comm: hs, "COMM_LVL": f"HS{len(hs)}", "time": f"from {start}", **extra})
    if len(rows) < 2:
        return pd.DataFrame(), {}
    df = pd.DataFrame(rows[1:], columns=rows[0]).loc[:, lambda d: ~d.columns.duplicated()]
    if key == "CTY_CODE":  # 실제 국가만 (0xxx·1XXX 등 지역 묶음 제외) + 전체
        df = df[(df.CTY_CODE == TOTAL) | (df.CTY_CODE.str.fullmatch(r"[1-9]\d{3}"))]
    names = dict(zip(df[key], df["CTY_NAME"] if "CTY_NAME" in df else df[key]))
    df["value_usd"] = pd.to_numeric(df[val], errors="coerce")
    p = df.pivot_table(index="time", columns=key, values="value_usd", aggfunc="sum")
    p.index = pd.PeriodIndex(p.index, freq="M")
    return p.sort_index(), {**names, TOTAL: "전체"}


def combined(hs: str, a, start) -> tuple[pd.DataFrame, dict]:
    """'902780+902789'처럼 +로 묶으면 합산 — HS 개정으로 쪼개진 세번을 이어 봄."""
    p, names = pd.DataFrame(), {}
    for h in hs.split("+"):
        q, n = panel(h, a, start)
        p, names = (q if p.empty else p.add(q, fill_value=0)), {**names, **n}
    return p, names


def spec_for(hs: str, a, part: str) -> dict:
    hs = hs.split("+") if "+" in hs else hs
    if a.by == "state":
        return {"dataset": STATE_DS[a.flow][0], "hs": hs, "filters": {"STATE": part, "CTY_CODE": a.cty or TOTAL}}
    if a.state:
        return {"dataset": STATE_DS[a.flow][0], "hs": hs, "filters": {"STATE": a.state, "CTY_CODE": part}}
    return {"dataset": "imports/hs", "hs": hs, "filters": {"CTY_CODE": part}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ticker")
    ap.add_argument("--sec", help="DB에 매출이 없는 종목: SEC 티커로 직접 조회")
    ap.add_argument("--hs", nargs="+", help="HS6(또는 HS10) 목록, +로 묶으면 합산. 생략하면 hs_tags에서")
    ap.add_argument("--by", choices=["country", "state"], default="country", help="상대국별(기본) 또는 미국 주별 수출")
    ap.add_argument("--state", help="by=country일 때: 이 주의 수출을 상대국별로 (없으면 미국 수입)")
    ap.add_argument("--cty", help="by=state일 때: 상대국 코드 필터 (예: 5700 중국)")
    ap.add_argument("--flow", choices=["exports", "imports"], default="exports",
                    help="주 단위(--state·--by state)일 때 수출(기본) 또는 수입(그 주로 들어오는 부품·원자재 = 생산 투입)")
    ap.add_argument("--top", type=int, default=15, help="품목별 금액 상위 몇 개 상대만 볼지")
    ap.add_argument("--show", type=int, default=25)
    ap.add_argument("--since", default="2021-01-01")
    a = ap.parse_args()

    con = connect()
    if a.sec:
        q = sec.quarterly_revenue(a.sec)
        fin = pd.DataFrame({"start": q.start, "end": q.end, "revenue": q.revenue})
        fin = fin[fin.end >= a.since].reset_index(drop=True)
    else:
        fin = fin_frame(con, a.ticker, a.since)
    if len(fin) < 8:
        raise SystemExit("매출 분기가 부족합니다 (etl.build 먼저 또는 --sec 사용)")
    rev = pd.Series(fin.revenue.values, index=fin.end)
    hs_list = a.hs or sorted({h[:6] for (h,) in con.execute("SELECT hs_prefix FROM hs_tags WHERE ticker=? AND length(hs_prefix)>=6", (a.ticker,))})
    if not hs_list:
        raise SystemExit("--hs를 주거나 관리 페이지에서 hs_tags를 먼저 등록하세요")
    start = f"{fin.start.min().year - 1}-01"  # 첫 분기 전년비용 1년 앞부터
    fl = "수출" if a.flow == "exports" else "수입"
    where = f"{a.state} {fl}" if a.state else f"주별 {fl}" if a.by == "state" else "미국 수입"
    print(f"{a.ticker} 매출 {len(fin)}분기 · {where} · 품목 {', '.join(hs_list)}")

    out = []
    for hs in hs_list:
        p, names = combined(hs, a, start)
        if p.empty:
            print(f"  {hs}: 데이터 없음")
            continue
        recent = p.iloc[-24:].sum().sort_values(ascending=False)
        total = recent.get(TOTAL, recent.drop(TOTAL, errors="ignore").sum())
        parts = [TOTAL] * (TOTAL in p) + [c for c in recent.index if c != TOTAL][: a.top]
        for part in parts:
            m = p[part].dropna().rename("value_usd").rename_axis("month").reset_index()
            s = evaluate(quarterly(m, fin), rev)
            if s["best"] is None:
                continue
            out.append({"hs": hs, "part": part, "name": names.get(part, part), "share": recent.get(part, 0) / total if total else None,
                        "spec": spec_for(hs, a, part), **s})

    order = {"A": 0, "B": 1, "C": 2, "D": 3}
    out.sort(key=lambda r: (order.get(r["grade"], 9), -r["best"]))
    f = lambda v: f"{v:5.2f}" if v is not None else "    -"  # noqa: E731
    print(f"\n  {'품목':13} {'상대':22} {'비중':>5} {'등급':>2} {'n':>3} {'금액':>5} {'YoY':>5} {'+1Q':>5} {'+2Q':>5} {'최근8':>5}")
    for r in out[: a.show]:
        share = f"{r['share']:5.0%}" if r["share"] is not None else "    -"
        print(f"  {r['hs'][:13]:13} {r['name'][:22]:22} {share} {r['grade']:>3} {r['n_yoy']:3} {f(r['level'])} {f(r['yoy0'])} {f(r['yoy1'])} {f(r['yoy2'])} {f(r['recent'])}")
    print("\n상위 후보 spec (series.spec에 그대로 사용):")
    for r in [r for r in out if r["grade"] in ("A", "B")][:8]:
        print(f"  [{r['grade']}] {r['name']}: {json.dumps(r['spec'], ensure_ascii=False)}")
    print(f"\n※ {len(out)}개 조합을 훑었으므로 일부는 우연히 높을 수 있음 — 생산거점·고객 근거가 있는 흐름만 등록")


if __name__ == "__main__":
    main()
