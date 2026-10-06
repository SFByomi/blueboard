"""무역 데이터로 진행 중인 분기 매출 추정 + 컨센서스 괴리 + 백테스트.

모델 (종목별):
- 입력 흐름: flow_scores 등급 A·B인 매핑 최대 3개 (매출과 직접 연동이 숫자로 확인된 흐름만). 각 흐름의 선행 분기(best_lag) 사용
- 두 모델을 흐름마다 적합하고, 백테스트 오차가 작은 쪽을 종목별로 채택
  - yoy  : 매출 전년비(q) = a + b × 무역 전년비(q − lag) → 매출(T−4) × (1 + 예측). 계절성에 강하지만 급성장기엔 평균으로 끌려감
  - level: 매출(q) = a + b × 무역 금액(q − lag), 최근 12분기 → 급성장·급감 국면을 따라감
- 진행 분기 T 예측: lag ≥ 1이면 이미 끝난 분기의 무역으로, lag 0이면 T에 들어온 달(1~3개월, 금액은 3개월로 환산)로
- 결합: 흐름별 예측을 R²로 가중평균, 범위는 회귀 잔차 ±1 표준편차
- 백테스트: 최근 8개 분기를 하나씩 빼고 그 이전 분기로만 다시 적합해 예측 → 평균 절대 오차(MAPE)를
  '직전 분기 성장률 유지'(단순 추세)와 비교. 흐름 선택 자체는 전체 표본 등급을 써서 약간 낙관적일 수 있음
- 컨센서스(consensus, 로컬 전용)와 분기 말일이 25일 이내로 맞으면 괴리율 = 추정/컨센 − 1

결과는 revenue_estimates (date, ticker) — Supabase에 누적(publish.ACCUMULATE) → 추정·괴리율의 날짜별 추이.
"""
import json
from datetime import date

import pandas as pd

from etl.scores import fin_frame, monthly

MIN_PAIRS = 8   # 회귀 최소 분기 수
BACKTEST = 8    # 백테스트 분기 수
MAX_FLOWS = 3
LEVEL_WIN = 12  # 금액 모델 적합 창(분기)
STALE_DAYS = 75  # 분기 말 + 75일이 지났는데 실적이 없으면 수집 누락으로 봄
METHODS = ("yoy", "level")


def target_quarter(last_end: pd.Timestamp) -> tuple[pd.Timestamp, pd.Timestamp]:
    start = last_end + pd.Timedelta(days=1)
    return start, start + pd.DateOffset(months=3) - pd.Timedelta(days=1)


def trade_yoy(ms: pd.Series, start, end, full=True) -> tuple[float | None, int]:
    """분기 [start, end]에 월 중순이 들어가는 달의 합 / 전년 같은 달 합 − 1. full이면 3개월 다 있어야."""
    mid = ms.index.to_timestamp() + pd.Timedelta(days=14)
    cur = ms[(mid >= start) & (mid <= end)].dropna()
    if not len(cur) or (full and len(cur) < 3):
        return None, len(cur)
    prev = ms.reindex(cur.index - 12)
    if prev.isna().any() or prev.sum() <= 0:
        return None, len(cur)
    return float(cur.sum() / prev.sum() - 1), len(cur)


def fit(xs: list, ys: list, min_n=MIN_PAIRS):
    d = pd.DataFrame({"x": xs, "y": ys}).dropna()
    if len(d) < min_n or d.x.std() == 0:
        return None
    b = ((d.x - d.x.mean()) * (d.y - d.y.mean())).sum() / ((d.x - d.x.mean()) ** 2).sum()
    if b <= 0:
        return None
    a = d.y.mean() - b * d.x.mean()
    res = d.y - (a + b * d.x)
    sst = ((d.y - d.y.mean()) ** 2).sum()
    return {"a": a, "b": b, "r2": float(1 - (res ** 2).sum() / sst) if sst else 0.0,
            "se": float((res ** 2).sum() / max(len(d) - 2, 1)) ** 0.5, "n": len(d)}


def flow_pairs(ms: pd.Series, fin: pd.DataFrame, lag: int, upto: int):
    """i < upto 인 분기에 대해 (무역 전년비(i−lag), 매출 전년비(i))"""
    xs, ys = [], []
    for i in range(4, upto):
        if i - lag < 0:
            continue
        q = fin.iloc[i - lag]
        xs.append(trade_yoy(ms, q.start, q.end)[0])
        ys.append(fin.revenue.iloc[i] / fin.revenue.iloc[i - 4] - 1)
    return xs, ys


def trade_sum(ms: pd.Series, start, end, full=True) -> tuple[float | None, int]:
    """분기 무역 합. 일부 달만 있으면(full=False) 3개월로 환산."""
    mid = ms.index.to_timestamp() + pd.Timedelta(days=14)
    cur = ms[(mid >= start) & (mid <= end)].dropna()
    if not len(cur) or (full and len(cur) < 3):
        return None, len(cur)
    return float(cur.sum() * 3 / len(cur)), len(cur)


def _x_quarter(fin, k, lag, t_start, t_end):
    """설명변수를 볼 분기: lag 0이면 대상 분기 자신, lag ≥ 1이면 이미 지난 분기"""
    if lag == 0:
        return t_start, t_end
    q = fin.iloc[k - lag]
    return q.start, q.end


def _one(method, ms, fin, k, lag, t_start, t_end, live):
    """흐름 하나로 분기 k 매출 예측 → (예측 매출, 표준오차(매출 단위), 적합 정보, 반영 개월)"""
    xs, xe = _x_quarter(fin, k, lag, t_start, t_end)
    if method == "yoy":  # 매출 전년비 ~ 무역 전년비
        m = fit(*flow_pairs(ms, fin, lag, k))
        x, months = trade_yoy(ms, xs, xe, full=not live)
        if not m or x is None:
            return None
        base = fin.revenue.iloc[k - 4]
        return base * (1 + m["a"] + m["b"] * x), base * m["se"], m, months
    # level: 매출 ~ 무역 금액, 최근 LEVEL_WIN 분기 — 급성장기에 전년비 모델이 평균으로 끌려가는 걸 보완
    lo = max(k - LEVEL_WIN, lag)
    xsl = [trade_sum(ms, *(lambda q: (q.start, q.end))(fin.iloc[i - lag]))[0] for i in range(lo, k)]
    m = fit(xsl, list(fin.revenue.iloc[lo:k]), min_n=6)
    x, months = trade_sum(ms, xs, xe, full=not live)
    if not m or x is None:
        return None
    return m["a"] + m["b"] * x, m["se"], m, months


def predict(method, flows, fin: pd.DataFrame, k: int, t_start, t_end, live: bool):
    """분기 k(= len(fin)이면 진행 분기 T) 매출 예측. flows: [(sid, lag, monthly)] → 흐름별 예측을 R² 가중평균"""
    preds = []
    for sid, lag, ms in flows:
        r = _one(method, ms, fin, k, lag, t_start, t_end, live)
        if r:
            rev, se, m, months = r
            preds.append({"sid": sid, "lag": lag, "rev": float(rev), "se": float(se), "r2": m["r2"], "n": m["n"], "months": months})
    if not preds:
        return None
    w = [max(p["r2"], 0.05) for p in preds]
    return {"rev": sum(p["rev"] * wi for p, wi in zip(preds, w)) / sum(w),
            "se": sum(p["se"] * wi for p, wi in zip(preds, w)) / sum(w), "flows": preds}


def backtest(method, flows, fin: pd.DataFrame) -> list[dict]:
    out = []
    for k in range(max(len(fin) - BACKTEST, 4 + MIN_PAIRS), len(fin)):
        q = fin.iloc[k]
        p = predict(method, flows, fin, k, q.start, q.end, live=False)
        if not p:
            continue
        naive_g = fin.revenue.iloc[k - 1] / fin.revenue.iloc[k - 5] - 1 if k >= 5 else None
        out.append({"q_end": q.end.strftime("%Y-%m-%d"), "actual": float(q.revenue), "pred": float(p["rev"]),
                    "naive": float(fin.revenue.iloc[k - 4] * (1 + naive_g)) if naive_g is not None else None})
    return out


def mape(bt: list[dict], key: str) -> float | None:
    e = [abs(r[key] / r["actual"] - 1) for r in bt if r.get(key) is not None and r["actual"]]
    return round(sum(e) / len(e), 4) if e else None


def match_consensus(con, sec_ticker: str | None, t_end: pd.Timestamp):
    if not sec_ticker:
        return None
    rows = con.execute("SELECT end_date, avg FROM consensus WHERE ticker=? AND date=(SELECT max(date) FROM consensus WHERE ticker=?)",
                       (sec_ticker, sec_ticker)).fetchall()
    best = min(((abs((pd.Timestamp(e) - t_end).days), e, v) for e, v in rows if e), default=None)
    return best[1:] if best and best[0] <= 25 else None


def estimate_all(con, log=print) -> int:
    today = date.today().isoformat()
    con.execute("DELETE FROM revenue_estimates WHERE date=?", (today,))
    sel = con.execute("""SELECT f.ticker, f.series_id, f.best_lag FROM flow_scores f
                         WHERE f.grade IN ('A','B') ORDER BY f.ticker, f.best DESC""").fetchall()
    by: dict[str, list] = {}
    for t, sid, lag in sel:
        if len(by.setdefault(t, [])) < MAX_FLOWS:
            by[t].append((sid, int(lag or 0)))
    n = 0
    for ticker, picks in by.items():
        fin = fin_frame(con, ticker)
        if len(fin) < 4 + MIN_PAIRS:
            continue
        flows = []
        for sid, lag in picks:
            m = monthly(con, sid)
            flows.append((sid, lag, m.set_index("month")["value_usd"].sort_index()))
        t_start, t_end = target_quarter(fin.end.iloc[-1])
        if t_end + pd.Timedelta(days=STALE_DAYS) < pd.Timestamp(today):  # 이미 발표됐을 분기 — 매출 수집이 밀린 것
            log(f"  - {ticker}: {t_end:%Y-%m} 분기 실적이 아직 수집 안 됨 → 추정 건너뜀")
            continue
        # 두 모델을 백테스트해 오차가 작은 쪽 채택 (같은 백테스트로 고르므로 약간 낙관적)
        cands = []
        for method in METHODS:
            p = predict(method, flows, fin, len(fin), t_start, t_end, live=True)
            bt = backtest(method, flows, fin)
            if p and bt:
                cands.append((mape(bt, "pred"), method, p, bt))
        if not cands:
            continue
        err, method, p, bt = min(cands, key=lambda c: c[0])
        est, last = p["rev"], float(fin.revenue.iloc[-1])
        sec, cur = con.execute("SELECT sec_ticker, (SELECT currency FROM financials WHERE ticker=? ORDER BY period_end DESC LIMIT 1) FROM companies WHERE ticker=?",
                               (ticker, ticker)).fetchone()
        cons = match_consensus(con, sec, t_end)
        con.execute("INSERT INTO revenue_estimates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
            today, ticker, t_start.strftime("%Y-%m-%d"), t_end.strftime("%Y-%m-%d"), est, est - p["se"], est + p["se"],
            est / float(fin.revenue.iloc[-4]) - 1, last, min(f["months"] for f in p["flows"]),
            json.dumps([{k: (round(v, 4) if isinstance(v, float) and abs(v) < 1e6 else v) for k, v in f.items()} for f in p["flows"]]),
            err, mape(bt, "naive"), len(bt), json.dumps(bt), (est / cons[1] - 1) if cons else None, cons[0] if cons else None, cur or "USD", method))
        n += 1
        gap = f" · 컨센 대비 {est / cons[1] - 1:+.1%}" if cons else ""
        log(f"  ✓ {ticker}: {t_end:%Y-%m} 분기 직전 대비 {est / last - 1:+.1%} [{method}] · 백테스트 오차 {err:.1%} (단순추세 {mape(bt, 'naive') or 0:.1%}){gap}")
    return n
