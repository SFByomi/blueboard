"""무역 데이터로 진행 중인 분기 매출 추정 + 컨센서스 괴리 + 백테스트.

모델 (종목별):
- 입력 흐름: flow_scores 등급 A·B 매핑(매출과 직접 연동이 숫자로 확인된 흐름)을 단독 예측 오차로 순위 매겨 상위 1~3개 조합 중 최선. 각 흐름의 선행 분기(best_lag) 사용
- 두 모델을 흐름마다 적합하고, 백테스트 오차가 작은 쪽을 종목별로 채택
  - yoy  : 매출 전년비(q) = a + b × 무역 전년비(q − lag) → 매출(T−4) × (1 + 예측). 계절성에 강하지만 급성장기엔 평균으로 끌려감
  - level: 매출(q) = a + b × 무역 금액(q − lag), 최근 12분기 → 급성장·급감 국면을 따라감
  - +bias: 위 예측에 '직전 4분기 실적/예측 배율 평균'을 곱한 보정판 (계속 낮게/높게 잡는 편향 제거).
    백테스트에서도 각 분기는 그 이전 4분기 오차로만 보정 → 미래 정보 없이 비교, 이겨야 채택
  - ens  : 전년비 계열 최선과 금액 계열 최선의 평균 (두 모델이 엇갈리는 급변 국면 대비)
- 진행 분기 T 예측: lag ≥ 1이면 이미 끝난 분기의 무역으로, lag 0이면 T에 들어온 달(1~3개월, 금액은 3개월로 환산)로
- 결합: 흐름별 예측을 R²로 가중평균
- 백테스트: 최근 12개 분기를 하나씩 빼고 그 이전 분기로만 다시 적합해 예측 → 평균 절대 오차(MAPE)를
  '직전 분기 성장률 유지'(단순 추세)와 비교. 흐름 선택 자체는 전체 표본 등급을 써서 약간 낙관적일 수 있음
- 신뢰도(%) = 백테스트에서 실제 매출이 추정 ±5%(HIT_TOL) 안에 들어온 비율, 표본이 적으면 (적중+1)/(분기+2)로 깎음
  오차범위 = 백테스트 실제 오차(절대값)의 80% 분위 → 추정 ± 그 비율 (회귀 잔차보다 현실적)
  등급: 신뢰(신뢰도 70%↑·경고 없음) / 보통(50%↑) / 참고
- 컨센서스(consensus, 로컬 전용)와 분기 말일이 25일 이내로 맞으면 괴리율 = 추정/컨센 − 1

결과는 revenue_estimates (date, ticker) — Supabase에 누적(publish.ACCUMULATE) → 추정·괴리율의 날짜별 추이.
"""
import json
from datetime import date

import pandas as pd

from etl.scores import fin_frame, monthly

MIN_PAIRS = 8   # 회귀 최소 분기 수
BACKTEST = 12   # 백테스트 분기 수
MAX_FLOWS = 3
LEVEL_WIN = 12  # 금액 모델 적합 창(분기)
BIAS_N = 4       # 편향 보정에 쓰는 직전 분기 수
BIAS_CAP = 1.5   # 보정 배율 상한 (±50%)
MIN_BT = 6       # 백테스트 분기가 이보다 적으면 오차를 믿을 수 없어 후보 제외
EXTRAP = 0.25    # 예측에 쓴 무역 값이 학습 범위를 25% 넘게 벗어나면 외삽 표시
STALE_DAYS = 75  # 분기 말 + 75일이 지났는데 실적이 없으면 수집 누락으로 봄
METHODS = ("yoy", "level")
HIT_TOL = 0.05   # 신뢰도: 실제 매출이 추정 ±5% 안이면 적중
BAND_Q = 0.8     # 오차범위: 백테스트 절대 오차의 80% 분위
TIER_OK, TIER_MID = 0.7, 0.5  # 신뢰도 기준 (신뢰 / 보통)


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


def _extrap(x: float, m: dict) -> bool:
    span = m["xmax"] - m["xmin"]
    return x > m["xmax"] + EXTRAP * span or x < m["xmin"] - EXTRAP * span


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
            "se": float((res ** 2).sum() / max(len(d) - 2, 1)) ** 0.5, "n": len(d), "xmin": float(d.x.min()), "xmax": float(d.x.max())}


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
        return base * (1 + m["a"] + m["b"] * x), base * m["se"], {**m, "extrap": _extrap(x, m)}, months
    # level: 매출 ~ 무역 금액, 최근 LEVEL_WIN 분기 — 급성장기에 전년비 모델이 평균으로 끌려가는 걸 보완
    lo = max(k - LEVEL_WIN, lag)
    xsl = [trade_sum(ms, *(lambda q: (q.start, q.end))(fin.iloc[i - lag]))[0] for i in range(lo, k)]
    m = fit(xsl, list(fin.revenue.iloc[lo:k]), min_n=6)
    x, months = trade_sum(ms, xs, xe, full=not live)
    if not m or x is None:
        return None
    return m["a"] + m["b"] * x, m["se"], {**m, "extrap": _extrap(x, m)}, months


def predict(method, flows, fin: pd.DataFrame, k: int, t_start, t_end, live: bool):
    """분기 k(= len(fin)이면 진행 분기 T) 매출 예측. flows: [(sid, lag, monthly)] → 흐름별 예측을 R² 가중평균"""
    preds = []
    for sid, lag, ms in flows:
        r = _one(method, ms, fin, k, lag, t_start, t_end, live)
        if r:
            rev, se, m, months = r
            preds.append({"sid": sid, "lag": lag, "rev": float(rev), "se": float(se), "r2": m["r2"], "n": m["n"], "months": months,
                          "extrap": bool(m["extrap"])})
    if not preds:
        return None
    w = [max(p["r2"], 0.05) for p in preds]
    return {"rev": sum(p["rev"] * wi for p, wi in zip(preds, w)) / sum(w),
            "se": sum(p["se"] * wi for p, wi in zip(preds, w)) / sum(w), "flows": preds}


def backtest(method, flows, fin: pd.DataFrame, corrected=False) -> list[dict]:
    """최근 BACKTEST 분기 예측. corrected면 각 분기 예측을 '그 이전 BIAS_N 분기의 예측 대비 실적 배율'로 보정
    (그 시점에 알 수 있던 오차만 쓰므로 미래 정보 없음)."""
    first = max(len(fin) - BACKTEST, 4 + MIN_PAIRS)
    raw = {}
    for k in range(max(first - BIAS_N, 4 + MIN_PAIRS), len(fin)):
        q = fin.iloc[k]
        p = predict(method, flows, fin, k, q.start, q.end, live=False)
        if p:
            raw[k] = p["rev"]
    out = []
    for k in range(first, len(fin)):
        if k not in raw:
            continue
        pred = raw[k]
        if corrected:
            f = bias_factor({j: raw[j] for j in range(k - BIAS_N, k) if j in raw}, fin)
            if f is None:
                continue
            pred *= f
        q = fin.iloc[k]
        naive_g = fin.revenue.iloc[k - 1] / fin.revenue.iloc[k - 5] - 1 if k >= 5 else None
        out.append({"q_end": q.end.strftime("%Y-%m-%d"), "actual": float(q.revenue), "pred": float(pred),
                    "naive": float(fin.revenue.iloc[k - 4] * (1 + naive_g)) if naive_g is not None else None})
    return out


def bias_factor(preds: dict, fin: pd.DataFrame) -> float | None:
    """직전 분기들의 실적/예측 배율 평균 (2개 이상일 때). 과소추정이 이어지면 1보다 커져 위로 보정"""
    r = [fin.revenue.iloc[j] / v for j, v in preds.items() if v > 0]
    if len(r) < 2:
        return None
    return float(min(max(sum(r) / len(r), 1 / BIAS_CAP), BIAS_CAP))


def mape(bt: list[dict], key: str) -> float | None:
    e = [abs(r[key] / r["actual"] - 1) for r in bt if r.get(key) is not None and r["actual"]]
    return round(sum(e) / len(e), 4) if e else None


def confidence(bt: list[dict]) -> tuple[float | None, float | None, int]:
    """(신뢰도, 오차범위 비율, 적중 분기 수) — 신뢰도 = 실제가 추정 ±HIT_TOL 안에 든 비율(표본 보정), 오차범위 = |오차| 80% 분위"""
    e = sorted(abs(r["actual"] / r["pred"] - 1) for r in bt if r.get("pred"))
    if not e:
        return None, None, 0
    hits = sum(x <= HIT_TOL for x in e)
    band = e[min(len(e) - 1, int(BAND_Q * len(e)))]
    return (hits + 1) / (len(e) + 2), band, hits


def tier(conf: float | None, why: list[str]) -> str:
    if conf is None:
        return "참고"
    hard = [w for w in why if not w.startswith("신뢰도")]  # 외삽·단절·단순추세 미달 등은 신뢰도와 별개로 '신뢰'를 막음
    if conf >= TIER_OK and not hard:
        return "신뢰"
    # 외삽·통계 단절·'직전 성장률 유지'보다 못함은 보통도 아님 — 구독형 소프트웨어처럼 추세만으로 더 잘 맞는 종목에서 모델이 더 나빠 보이는 걸 막음
    return "보통" if conf >= TIER_MID and not any(k in w for w in hard for k in ("외삽", "단절", "단순 추세")) else "참고"


def reliability(con, conf, naive, err, bt_n, flows) -> list[str]:
    """'신뢰'가 아닌 이유 목록 (비면 신뢰). 웹은 이 결과를 그대로 표시"""
    why = []
    if bt_n < MIN_BT:
        why.append(f"백테스트 {bt_n}분기뿐")
    if conf is None or conf < TIER_OK:
        why.append(f"신뢰도 {0 if conf is None else conf:.0%} (70% 미만)")
    if naive is not None and err is not None and err >= naive:
        why.append("단순 추세보다 정확하지 않음")
    if max(f["r2"] for f in flows) < 0.4:
        why.append("근거 흐름 설명력(R²) 0.4 미만")
    if any(f.get("extrap") for f in flows):
        why.append("과거 범위 밖 외삽")
    cut = (pd.Timestamp.today() - pd.DateOffset(months=24)).strftime("%Y-%m")
    for f in flows:  # 금액이 끊기는 단절(재분류·수준 변화)이 최근 2년 안에 있으면 회귀 근거가 흔들림
        if con.execute("SELECT 1 FROM alerts WHERE series_id=? AND kind IN ('price_break','level_break') AND month>=?", (f["sid"], cut)).fetchone():
            why.append(f"근거 흐름 통계 단절({f['sid']})")
    return why


def best_model(flows, fin: pd.DataFrame, t_start=None, t_end=None):
    """yoy·level × (보정 없음·편향 보정) 중 백테스트 오차가 가장 작은 모델 → (mape, method, 진행분기 예측|None, backtest).
    t_start가 None이면 백테스트만 (후보 탐색용)."""
    cands = []
    for method in METHODS:
        p = predict(method, flows, fin, len(fin), t_start, t_end, live=True) if t_start is not None else {"rev": None, "se": 0, "flows": []}
        if not p:
            continue
        bt = backtest(method, flows, fin)
        if len(bt) >= MIN_BT:
            cands.append((mape(bt, "pred"), method, p, bt))
        # 편향 보정판: 최근 BIAS_N 분기 실적/예측 배율을 곱함 — 보정판도 백테스트로 이겨야 채택
        btc = backtest(method, flows, fin, corrected=True)
        recent = {}
        for k in range(len(fin) - BIAS_N, len(fin)):
            q = fin.iloc[k]
            r = predict(method, flows, fin, k, q.start, q.end, live=False)
            if r:
                recent[k] = r["rev"]
        f = bias_factor(recent, fin)
        if len(btc) >= MIN_BT and f is not None:
            pc = {**p, "rev": p["rev"] * f if p["rev"] is not None else None, "se": p["se"] * f, "bias": f}
            cands.append((mape(btc, "pred"), f"{method}+bias", pc, btc))
    # 앙상블: 전년비 계열 최선 + 금액 계열 최선의 평균 — 두 모델이 크게 엇갈리는 급변 국면에서 한쪽에 쏠리지 않게
    fam = {}
    for c in cands:
        b = c[1].split("+")[0]
        if b not in fam or c[0] < fam[b][0]:
            fam[b] = c
    if len(fam) == 2:
        (_, m1, p1, b1), (_, m2, p2, b2) = fam["yoy"], fam["level"]
        q2 = {r["q_end"]: r["pred"] for r in b2}
        bt = [{**r, "pred": (r["pred"] + q2[r["q_end"]]) / 2} for r in b1 if r["q_end"] in q2]
        if len(bt) >= MIN_BT:
            pe = {**p1, "rev": (p1["rev"] + p2["rev"]) / 2 if p1["rev"] is not None and p2["rev"] is not None else None,
                  "se": (p1["se"] + p2["se"]) / 2, "flows": p1["flows"] + [f for f in p2["flows"] if f["sid"] not in {g["sid"] for g in p1["flows"]}]}
            cands.append((mape(bt, "pred"), f"ens({m1},{m2})", pe, bt))
    return min(cands, key=lambda c: c[0]) if cands else None


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
    for t, sid, lag in sel:  # A·B 흐름 전부 후보 (상관으로 1차 거름) → 아래에서 예측 오차로 고름
        by.setdefault(t, []).append((sid, int(lag or 0)))
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
        # 흐름별 단독 예측 오차로 순위 → 상위 1·2·3개 묶음 중 백테스트 오차가 가장 작은 조합·모델 채택
        # (같은 백테스트로 고르므로 약간 낙관적 — 후보를 A·B 등급으로 먼저 거른 이유)
        solo = [(r[0], f) for f in flows if (r := best_model([f], fin))]
        ranked = [f for _, f in sorted(solo, key=lambda x: x[0])]
        best = None
        for k in range(1, min(MAX_FLOWS, len(ranked)) + 1):
            r = best_model(ranked[:k], fin, t_start, t_end)
            if r and (best is None or r[0] < best[0] - 0.002):  # 흐름을 늘려도 거의 안 나아지면 적은 쪽
                best = r
        if not best:
            continue
        err, method, p, bt = best
        est, last = p["rev"], float(fin.revenue.iloc[-1])
        sec, cur = con.execute("SELECT sec_ticker, (SELECT currency FROM financials WHERE ticker=? ORDER BY period_end DESC LIMIT 1) FROM companies WHERE ticker=?",
                               (ticker, ticker)).fetchone()
        cons = match_consensus(con, sec, t_end)
        naive = mape(bt, "naive")
        conf, band, hits = confidence(bt)
        caution = reliability(con, conf, naive, err, len(bt), p["flows"])
        grade = tier(conf, caution)
        band = band if band is not None else p["se"] / est
        cols = ("date, ticker, q_start, q_end, est, low, high, yoy, last_actual, months, flows, mape, mape_naive, bt_n, backtest, "
                "cons_gap, cons_end, currency, method, reliable, caution, conf, hits, tier")
        con.execute(f"INSERT INTO revenue_estimates ({cols}) VALUES ({','.join('?' * 24)})", (
            today, ticker, t_start.strftime("%Y-%m-%d"), t_end.strftime("%Y-%m-%d"), est, est * (1 - band), est * (1 + band),
            est / float(fin.revenue.iloc[-4]) - 1, last, min(f["months"] for f in p["flows"]),
            json.dumps([{k: (round(v, 4) if isinstance(v, float) and abs(v) < 1e6 else v) for k, v in f.items()} for f in p["flows"]]),
            err, naive, len(bt), json.dumps(bt), (est / cons[1] - 1) if cons else None, cons[0] if cons else None, cur or "USD", method,
            int(grade == "신뢰"), json.dumps(caution, ensure_ascii=False), conf, hits, grade))
        n += 1
        gap = f" · 컨센 대비 {est / cons[1] - 1:+.1%}" if cons else ""
        log(f"  ✓ {ticker}: {t_end:%Y-%m} 분기 직전 대비 {est / last - 1:+.1%} [{method}] · 신뢰도 {conf or 0:.0%}({hits}/{len(bt)}분기 ±5%) [{grade}] · 오차 {err:.1%} (단순추세 {mape(bt, 'naive') or 0:.1%}){gap}")
    return n
