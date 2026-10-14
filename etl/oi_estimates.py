"""진행 분기 GAAP 영업이익 추정 — 매출 추정(revenue_estimates) × 영업이익률 모델, 백테스트로 채택.

영업이익률 모델 (매출 추정과 같은 원칙: 그 분기 이전 데이터만으로 예측해 더 정확한 쪽):
- naive: 직전 분기 영업이익률 유지
- drift: 직전 분기 영업이익률 + 최근 4분기 평균 변화 (흑자 전환·마진 확대처럼 추세가 있는 회사)
한국 종목은 DART 영업이익(매출과 같은 기준: 연결/별도 손익계산서, 또는 사업부문 영업이익) — 수익성 가이던스가 없어 naive·drift만.
- guide: 회사 수익성 가이던스(영업이익률 · 영업이익 금액 · 매출총이익률−영업비용, 대개 non-GAAP)로 만든 '가이던스 마진'
         − 과거 '가이던스 마진 − 실제 GAAP 마진' 차이의 중앙값 (주식보상·상각 등 GAAP 차이와 상습 초과분을 함께 보정)
백테스트의 매출은 매출 추정 백테스트의 예측값 → 매출 오차까지 포함한 영업이익 오차.
영업이익은 매출보다 훨씬 출렁여(영업 레버리지·일회성 비용) 오차가 큰 종목은 '추정불가'로 이유와 함께 남긴다.
"""
import json
import math

import pandas as pd

from etl import dart, dart_segment, guidance, sec, sec6k

GAP_N, GAP_MIN, MIN_BT = 4, 2, 4
DRIFT_CAP = 0.05                     # 추세 모델의 분기당 영업이익률 변화 상한 (적자 바이오처럼 마진이 수백 %p 움직이던 이력의 외삽 방지)  # GAAP 차이(주식보상 등)는 시간이 지나며 줄어 최근 4분기만
NEAR_ZERO = 0.05                     # |영업이익률| 5% 미만이면 % 오차가 무의미 → 영업이익률(%p) 오차로 판단
TIERS = ((0.07, "신뢰"), (0.15, "보통"), (0.30, "참고"))  # 영업이익 백테스트 평균 오차 기준
PTS_TIERS = ((0.015, "보통"), (0.03, "참고"))           # 0 근처 종목: 영업이익률 오차(%p) 기준 (신뢰는 주지 않음)


def _pick(v: float, unit: float | None, rev: float) -> float:
    """단위 없는 금액 → 매출의 20% 근처가 되는 단위 (영업이익·영업비용)"""
    if unit:
        return v * unit
    return min((v * k for k in (1, 1e3, 1e6, 1e9)), key=lambda x: abs(math.log(max(abs(x), 1) / (0.2 * rev))))


def guided_margin(m: dict, rev_mid: float) -> tuple[float, str] | None:
    """가이던스 dict → (가이던스 영업이익률, 근거 종류). 영업이익률 > 영업이익 금액 > 매출총이익률−영업비용"""
    if m.get("om"):
        v, kind = sum(m["om"]) / 2, "om"
    elif m.get("oi"):
        o = m["oi"]
        v, kind = (_pick(o["low"], o["unit_low"], rev_mid) + _pick(o["high"], o["unit_high"], rev_mid)) / 2 / rev_mid, "oi"
    elif m.get("gm") and m.get("opex"):
        o = m["opex"]
        v, kind = sum(m["gm"]) / 2 - (_pick(o["low"], o["unit_low"], rev_mid) + _pick(o["high"], o["unit_high"], rev_mid)) / 2 / rev_mid, "gm-opex"
    else:
        return None
    return (v, kind) if -1 < v < 1 else None


def _mape(rows, key):
    """가중 오차 = Σ|예측 − 실제| ÷ Σ|실제| — 영업이익이 0 근처였던 분기 하나가 평균을 수백 %로 만드는 것을 막음"""
    rs = [r for r in rows if r.get(key) is not None]
    den = sum(abs(r["actual"]) for r in rs)
    return round(sum(abs(r[key] - r["actual"]) for r in rs) / den, 4) if rs and den else None


def _pts(rows, key):
    e = [abs(r[key] - r["actual"]) / r["rev"] for r in rows if r.get(key) is not None and r["rev"]]
    return round(sum(e) / len(e), 4) if e else None


def _drift(m: pd.Series) -> float:
    return max(-DRIFT_CAP, min(DRIFT_CAP, float(m.diff().iloc[-4:].mean())))


def _row(con, today, ticker, q_end, cur, why, **kw):
    con.execute("INSERT OR REPLACE INTO oi_estimates (date, ticker, q_end, est, margin, rev_est, last_q, last_oi, last_margin, method, mape, mape_naive, err_pts, "
                "bt_n, backtest, tier, caution, guide, currency) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (today, ticker, q_end, kw.get("est"), kw.get("margin"), kw.get("rev_est"), kw.get("last_q"), kw.get("last_oi"), kw.get("last_margin"),
                 kw.get("method", "none"), kw.get("mape"), kw.get("mape_naive"), kw.get("err_pts"), kw.get("bt_n", 0),
                 json.dumps(kw.get("backtest", [])), kw.get("tier", "추정불가"), json.dumps(why, ensure_ascii=False),
                 json.dumps(kw["guide"], ensure_ascii=False) if kw.get("guide") else None, cur or "USD"))


def estimate_all(con, log=print, today: str | None = None) -> None:
    today = today or pd.Timestamp.now().strftime("%Y-%m-%d")
    store = json.loads(guidance.STORE.read_text()) if guidance.STORE.exists() else {}
    con.execute("DELETE FROM oi_estimates WHERE date=?", (today,))
    rows = con.execute("SELECT c.ticker, c.sec_ticker, c.dart_fs, c.dart_segment, e.q_end, e.est, e.backtest, e.currency, e.tier "
                       "FROM companies c LEFT JOIN revenue_estimates e ON e.ticker=c.ticker AND e.date=(SELECT max(date) FROM revenue_estimates WHERE ticker=c.ticker) "
                       "ORDER BY c.sort").fetchall()
    for ticker, sec_t, dart_fs, dart_seg, q_end, rev_est, bt_json, cur, rtier in rows:
        kr = bool(dart_fs or dart_seg)
        if not kr and (not sec_t or sec_t in sec6k.FILERS):
            _row(con, today, ticker, q_end, cur, ["해외 공시(6-K, IFRS) 종목 — 분기 영업이익 데이터 미수집"]); continue
        if rev_est is None:
            _row(con, today, ticker, q_end, cur, ["매출 추정이 없어(추정불가) 영업이익도 추정하지 않음"]); continue
        try:
            if dart_seg:  # 매출과 같은 사업부문의 부문 영업이익 (두산 전자BG·삼성전기 컴포넌트)
                kw, _, scope = dart_seg.partition(":")
                oi = dart_segment.quarterly_segment_oi(ticker.split(".")[0], kw, scope or "Consolidated")
            elif dart_fs:
                oi = dart.quarterly_operating_income(ticker.split(".")[0], dart_fs)
            else:
                oi = sec.quarterly_operating_income(sec_t)
        except Exception as e:  # noqa: BLE001
            _row(con, today, ticker, q_end, cur, [f"영업이익 수집 실패: {e}"]); continue
        fin = pd.read_sql("SELECT period_end AS end, revenue FROM financials WHERE ticker=? ORDER BY period_end", con, params=(ticker,))
        fin["end"] = pd.to_datetime(fin["end"])
        if oi.empty:
            _row(con, today, ticker, q_end, cur, ["DART 공시에 이 기준의 영업이익 없음" if kr else "SEC 재무제표에 영업이익(OperatingIncomeLoss) 항목 없음"]); continue
        fin = pd.merge_asof(fin.sort_values("end"), oi.sort_values("end"), on="end", tolerance=pd.Timedelta(days=7), direction="nearest").dropna()
        if len(fin) < 6:
            _row(con, today, ticker, q_end, cur, [f"영업이익 이력 {len(fin)}분기뿐"]); continue
        fin["m"] = fin.oi / fin.revenue
        ends = [e.strftime("%Y-%m-%d") for e in fin.end]
        allfin = pd.read_sql("SELECT period_end, revenue FROM financials WHERE ticker=? ORDER BY period_end", con, params=(ticker,))
        guides = guidance.resolve(store, sec_t, list(allfin.period_end), dict(zip(allfin.period_end, allfin.revenue))) if sec_t and not kr else []
        gm = {}  # 대상 분기 말 → (가이던스 마진, 종류, 가이던스 dict, 공시일)
        for g in guides:
            m = store.get(g.get("acc"), {}).get("margin")
            r = guided_margin(m, (g["low"] + g["high"]) / 2) if m and not g.get("prelim") else None
            if r:
                gm[pd.Timestamp(g["target_end"])] = (*r, m, g["filed"])
        near = lambda d: next((v for k, v in gm.items() if abs((k - d).days) <= 20), None)  # noqa: E731
        gaps = [(e, near(e)[0] - m) for e, m in zip(fin.end, fin.m) if near(e)]  # (분기 말, 가이던스 마진 − 실제 GAAP 마진)

        bt, rev_bt = [], json.loads(bt_json or "[]")
        for r in rev_bt:
            e = pd.Timestamp(r["q_end"])
            hit = fin[(fin.end - e).abs() <= pd.Timedelta(days=7)]
            prev = fin[fin.end < e - pd.Timedelta(days=20)]
            if hit.empty or prev.empty:
                continue
            act, rev_act, rev_p = float(hit.oi.iloc[0]), float(hit.revenue.iloc[0]), float(r["pred"])
            row = {"q_end": r["q_end"], "actual": act, "rev": rev_act, "naive": rev_p * float(prev.m.iloc[-1])}
            if len(prev) >= 5:
                row["drift"] = rev_p * (float(prev.m.iloc[-1]) + _drift(prev.m))
            g, prior = near(e), [x for d, x in gaps if d < e - pd.Timedelta(days=20)][-GAP_N:]
            if g and len(prior) >= GAP_MIN:
                row["guide"] = rev_p * (g[0] - float(pd.Series(prior).median()))
            bt.append(row)
        if len(bt) < MIN_BT:
            _row(con, today, ticker, q_end, cur, [f"백테스트 가능한 분기 {len(bt)}개뿐 (매출 추정 백테스트와 영업이익이 겹치는 분기)"]); continue

        t_end = pd.Timestamp(q_end)
        g_live = next((v for k, v in gm.items() if abs((k - t_end).days) <= 20), None)
        prior = [x for _, x in gaps][-GAP_N:]
        gbt = [r for r in bt if "guide" in r]
        m_naive, m_guide = _mape(bt, "naive"), (_mape(gbt, "guide") if len(gbt) >= 3 else None)
        # 가이던스 모델은 진행 분기 가이던스가 있고, 같은 분기들에서 단순 유지보다 정확할 때만
        use_guide = g_live and len(prior) >= GAP_MIN and m_guide is not None and m_guide < _mape(gbt, "naive")
        last_m = float(fin.m.iloc[-1])
        dbt = [r for r in bt if "drift" in r]
        use_drift = not use_guide and len(dbt) >= MIN_BT and _mape(dbt, "drift") < _mape(dbt, "naive")
        if use_guide:
            margin, key, used = g_live[0] - float(pd.Series(prior).median()), "guide", gbt
        elif use_drift:
            margin, key, used = last_m + _drift(fin.m), "drift", dbt
        else:
            margin, key, used = last_m, "naive", bt
        mape, pts = _mape(used, key), _pts(used, key)
        est = rev_est * margin
        why = []
        if abs(margin) < NEAR_ZERO or abs(last_m) < NEAR_ZERO:
            tier = next((t for lim, t in PTS_TIERS if pts <= lim), "추정불가")
            why.append(f"영업이익률이 0 근처(직전 {last_m:+.1%}) — 금액 % 오차 대신 영업이익률 오차 {pts * 100:.1f}%p로 판단")
        else:
            tier = next((t for lim, t in TIERS if mape <= lim), "추정불가")
        if tier == "추정불가":
            why.insert(0, f"백테스트 영업이익 오차 {mape:.0%}(영업이익률 {pts * 100:.1f}%p) — 영업이익 변동이 커서 숫자는 참고용으로도 내지 않음")
        if rtier in ("보류", "참고") and tier in ("신뢰", "보통"):
            tier = "참고"
            why.append(f"기준 매출 추정이 '{rtier}' 등급")
        guide_info = None
        if g_live:
            guide_info = {"margin": round(g_live[0], 4), "kind": g_live[1], "basis": g_live[2].get("basis"), "filed": g_live[3],
                          "gap": round(float(pd.Series(prior).median()), 4) if prior else None, "n": len(prior), "used": bool(use_guide),
                          "mape_guide": m_guide, "mape_naive_same": _mape(gbt, "naive") if gbt else None,
                          **{k: g_live[2][k] for k in ("om", "gm") if g_live[2].get(k)}}
        _row(con, today, ticker, q_end, cur, why, est=None if tier == "추정불가" else est, margin=None if tier == "추정불가" else margin,
             rev_est=rev_est, last_q=fin.end.iloc[-1].strftime("%Y-%m-%d"), last_oi=float(fin.oi.iloc[-1]), last_margin=last_m, method=key, mape=mape, mape_naive=m_naive, err_pts=pts,
             bt_n=len(used), backtest=[{k: (round(v, 1) if isinstance(v, float) else v) for k, v in r.items()} for r in used], tier=tier, guide=guide_info)
        log(f"  {'✓' if tier != '추정불가' else '-'} 영업이익 {ticker}: {key} 마진 {margin:+.1%} → {est / (1e8 if kr else 1e6):,.0f}{'억원' if kr else 'M'} · 오차 {mape:.0%}({pts * 100:.1f}%p, 단순 {m_naive:.0%}) [{tier}]")
    con.commit()
