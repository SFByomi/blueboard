"""상관 모델 — 매핑된 무역 흐름이 종목 분기 매출과 얼마나 직접 연결되는지 점수화.

매 빌드마다 모든 매핑(ticker × series)에 대해:
- 회계분기로 무역을 합산(3개월이 다 있는 분기만) → 매출과 비교
- level  : 금액 상관 (추세 공유 — 둘 다 성장하면 높게 나와 과대평가되기 쉬움)
- yoy0~2 : 전년비 상관, 무역이 0·1·2분기 앞설 때 (계절성·추세를 걷어낸 실제 연동)
- best/best_lag : yoy0~2 중 최고와 그 선행 분기
- recent : best_lag 기준 최근 8분기 전년비 상관 (관계가 아직 유효한지)
- grade  : A(≥0.7) B(≥0.5) C(≥0.3) D — best_lag 기준 전년비 표본이 8(+선행 분기당 2)분기 미만이면 최대 C, 4분기 미만이면 없음
결과는 flow_scores 테이블 → 종목 페이지 '매출 연관도'. 후보 탐색은 etl/discover.py.
"""
import pandas as pd

LAGS = (0, 1, 2)
MIN_YOY = 4      # 상관 계산 최소 표본
SOLID_YOY = 8    # A·B 등급 최소 표본 (선행 분기마다 +2 — 선행을 고른 만큼 우연 상관 위험이 커짐)
LAG_PENALTY = 0.05


def quarterly(monthly: pd.DataFrame, fin: pd.DataFrame) -> pd.Series:
    """회계분기 [start, end]에 월 중순이 들어가는 달을 합산. 3개월이 다 있어야 값."""
    m = monthly.copy()
    m["mid"] = m["month"].dt.to_timestamp() + pd.Timedelta(days=14)
    out = []
    for _, q in fin.iterrows():
        v = m[(m.mid >= q.start) & (m.mid <= q.end)]["value_usd"]
        out.append(v.sum() if len(v) == 3 else None)
    return pd.Series(out, index=fin.end, dtype=float)


def _corr(a: pd.Series, b: pd.Series) -> tuple[float | None, int]:
    d = pd.DataFrame({"a": a.values, "b": b.values}).replace([float("inf"), float("-inf")], None).dropna()
    if len(d) < MIN_YOY or d.a.std() == 0 or d.b.std() == 0:
        return None, len(d)
    return round(float(d.a.corr(d.b)), 3), len(d)


def grade(best: float | None, n: int, lag: int = 0) -> str | None:
    if best is None:
        return None
    g = "A" if best >= 0.7 else "B" if best >= 0.5 else "C" if best >= 0.3 else "D"
    return max(g, "C") if n < SOLID_YOY + 2 * lag else g  # 표본이 짧으면 A·B를 C로 낮춤 (문자 비교: 'C' > 'B' > 'A')


def evaluate(trade_q: pd.Series, rev: pd.Series) -> dict:
    t = trade_q.where(trade_q > 0)
    lvl, n = _corr(t, rev)
    ty, ry = t.pct_change(4, fill_method=None), rev.pct_change(4, fill_method=None)
    yoy = {k: _corr(ty.shift(k), ry) for k in LAGS}
    # 선행 분기를 고르는 것 자체가 과적합 → 한 분기 늦출 때마다 0.05 감점해 비슷하면 동행(0)을 택함
    cands = [(v - LAG_PENALTY * k, k) for k, (v, _) in yoy.items() if v is not None]
    lag = max(cands)[1] if cands else None
    best = yoy[lag][0] if lag is not None else None
    n_yoy = yoy[lag if lag is not None else 0][1]
    recent = _corr(ty.shift(lag).iloc[-8:], ry.iloc[-8:])[0] if lag is not None else None
    return {"n": n, "n_yoy": n_yoy, "level": lvl, **{f"yoy{k}": yoy[k][0] for k in LAGS},
            "best": best, "best_lag": lag, "recent": recent, "grade": grade(best, n_yoy, lag or 0)}


def fin_frame(con, ticker: str, since="2021-01-01") -> pd.DataFrame:
    fin = pd.read_sql("SELECT period_start start, period_end end, revenue FROM financials "
                      "WHERE ticker=? AND period_end>=? ORDER BY period_end", con, params=(ticker, since))
    fin["start"], fin["end"] = pd.to_datetime(fin.start), pd.to_datetime(fin.end)
    return fin


def monthly(con, series_id: str) -> pd.DataFrame:
    obs = pd.read_sql("SELECT month, value_usd FROM observations WHERE series_id=?", con, params=(series_id,))
    obs["month"] = pd.PeriodIndex(obs.month, freq="M")
    return obs


def score_all(con, log=print) -> int:
    con.execute("DELETE FROM flow_scores")
    rows = []
    for ticker, in con.execute("SELECT DISTINCT ticker FROM mappings ORDER BY ticker").fetchall():
        fin = fin_frame(con, ticker)
        if len(fin) < MIN_YOY + 4:
            continue
        rev = pd.Series(fin.revenue.values, index=fin.end)
        for sid, in con.execute("SELECT series_id FROM mappings WHERE ticker=?", (ticker,)).fetchall():
            s = evaluate(quarterly(monthly(con, sid), fin), rev)
            rows.append((ticker, sid, s["n"], s["n_yoy"], s["level"], s["yoy0"], s["yoy1"], s["yoy2"],
                         s["best"], s["best_lag"], s["recent"], s["grade"]))
    con.executemany("INSERT INTO flow_scores VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    by = pd.Series([r[-1] or "-" for r in rows]).value_counts().to_dict()
    log(f"  ✓ {len(rows)}개 흐름 점수화 · 등급 {dict(sorted(by.items()))}")
    return len(rows)
