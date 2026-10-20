"""밸류에이션 밴드·시나리오 — 우리 추정 매출·영업이익을 '시장이 과거에 쳐준 배수'로 환산.

배수 = 기업가치(EV = 시가총액 + 순부채) ÷ 분기 실적 × 4 (연환산)
  - 영업이익 배수(EV/영업이익, PER과 비슷한 이익 배수): 최근 4분기 영업이익이 모두 흑자이고 이익률 10% 이상, 메모리(경기순환) 아님
  - 매출 배수(EV/매출, PSR과 비슷): 그 밖 (적자·저마진·경기순환)
과거 밴드 = 최근 12분기(3년) 각 분기 말 EV ÷ 그 분기 실적 × 4 → 하위 10·25·50·75·90%
지금 배수 = 오늘 EV ÷ 진행 분기 추정 × 4 (추정이 없으면 직전 분기 실적)
시나리오 (배수가 안정적이고, 최근 1년 배수가 3년과 비슷하고, 지금 배수가 3년 범위 안일 때만 — 재평가·경기순환 국면엔 과거 배수 적용이 왜곡이라 이유만 남김)
  Worst = 하위 25% 배수 × 추정 하단 · Base = 중앙 배수 × 추정 · Best = 상위 25% 배수 × 추정 상단 → 예상 시가총액(− 순부채), ÷ 주식 수 = 주가
주가는 하루 한 번(데이터 갱신 때) 야후 값 — 그 시각·종가/장중을 함께 저장(px_time·px_date·px_kind)해 화면에 '○월 ○일 종가 기준'으로. 예상 시가총액은 주가와 무관

시가총액: 야후 현재 시가총액 × (분기 말 종가 ÷ 현재가) × (그 분기 희석 주식 수 ÷ 최근, SEC — 액면분할은 야후 분할 기록으로 보정).
야후 가격은 재게시 금지 → 원 가격·시가총액은 저장하지 않고 배수·시나리오 결과(우리 계산)와 비율만 (multiple_hist·multiple_now).
부문 매출을 쓰는 종목(삼성전자 DS·두산 전자BG·삼성전기 컴포넌트)은 회사 전체 가치와 비교할 수 없어 제외.
"""
import json
import time
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from etl import consensus, dart, sec, sec6k

WINDOW = 12          # 밴드: 최근 12분기(3년)
MIN_N = 8            # 밴드 최소 분기
MAX_SPREAD = 1.8     # 상위 25% ÷ 하위 25% 배수가 이보다 크면 시나리오 생략 (배수가 불안정)
REGIME = 0.3         # 최근 1년 중앙 배수가 3년 중앙과 30% 넘게 다르면 생략 (재평가 진행 중 — 3년 평균 회귀를 기준으로 삼기 어려움)
EBIT_MARGIN = 0.10   # 영업이익 배수를 쓰는 최소 이익률 (최근 4분기)
CYCLICAL = {"메모리"}
SHARE_TAGS = ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"]


def _yahoo(s, crumb, sym: str) -> dict:
    """일간 종가(액면분할 반영)·분할 기록·현재 시가총액·가격·통화 + 그 가격의 시각(종가/장중)"""
    r = s.get(f"{consensus.BASE}/v8/finance/chart/{sym}", params={"range": "5y", "interval": "1d", "events": "split", "crumb": crumb}, timeout=30)
    r.raise_for_status()
    j = r.json()["chart"]["result"][0]
    px = pd.Series(j["indicators"]["quote"][0]["close"], index=pd.to_datetime(j["timestamp"], unit="s").normalize()).dropna()
    splits = [(pd.Timestamp(v["date"], unit="s"), v["numerator"] / v["denominator"]) for v in (j.get("events") or {}).get("splits", {}).values()]
    q = s.get(f"{consensus.BASE}/v10/finance/quoteSummary/{sym}", params={"modules": "price", "crumb": crumb}, timeout=30).json()
    p = ((q["quoteSummary"]["result"] or [{}])[0].get("price") or {})
    # 이 계산에 쓴 주가가 언제 값인지 — 하루 한 번 갱신이라 화면에 '○월 ○일 종가 기준'으로 표시
    meta = j.get("meta") or {}
    t, tz = p.get("regularMarketTime") or meta.get("regularMarketTime"), meta.get("exchangeTimezoneName") or "UTC"
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    now = time.time()
    live = bool(t and reg and reg.get("start", 0) <= now <= reg.get("end", 0) and t >= reg.get("start", 0))
    px_at = datetime.fromtimestamp(t, ZoneInfo(tz)) if t else None
    return {"px": px[~px.index.duplicated(keep="last")], "splits": splits, "mcap": (p.get("marketCap") or {}).get("raw"),
            "price": (p.get("regularMarketPrice") or {}).get("raw"), "currency": p.get("currency"),
            "px_time": px_at.astimezone(timezone.utc).isoformat(timespec="minutes") if px_at else None,
            "px_date": px_at.date().isoformat() if px_at else None, "px_kind": "장중" if live else "종가"}


def _sec_shares(sec_t: str, splits: list[tuple[pd.Timestamp, float]]) -> pd.Series | None:
    """분기 희석 주식 수 (분기 말 → 주식 수, 이후 액면분할 반영). 분할 전에 제출된 공시값만 분할 비율을 곱함"""
    path = sec.CACHE / f"{sec_t}.json"
    if not path.exists():
        return None
    facts = json.loads(path.read_text())["facts"].get("us-gaap", {})
    for tag in SHARE_TAGS:
        rows = [u for u in facts.get(tag, {}).get("units", {}).get("shares", []) if "start" in u]
        if rows:
            break
    else:
        return None
    df = pd.DataFrame(rows)
    df["start"], df["end"], df["filed"] = pd.to_datetime(df.start), pd.to_datetime(df.end), pd.to_datetime(df.filed)
    df = df[(df.end - df.start).dt.days.between(80, 100)].sort_values("filed").drop_duplicates("end", keep="last")
    df["adj"] = [v * np.prod([k for d, k in splits if d > f] or [1.0]) for v, f in zip(df.val, df.filed)]
    return pd.Series(df.adj.values, index=df.end).sort_index()


def _oi(ticker: str, sec_t: str | None, dart_fs: str | None) -> pd.Series:
    try:
        if dart_fs:
            o = dart.quarterly_operating_income(ticker.split(".")[0], dart_fs)
        elif sec_t and sec_t not in sec6k.FILERS:
            o = sec.quarterly_operating_income(sec_t)
        else:
            return pd.Series(dtype=float)
    except Exception:  # noqa: BLE001
        return pd.Series(dtype=float)
    return pd.Series(o.oi.values, index=pd.to_datetime(o.end)) if len(o) else pd.Series(dtype=float)


def _near(s: pd.Series, d: pd.Timestamp, days=10):
    if s.empty:
        return None
    k = (abs(s.index - d)).argmin()
    return float(s.iloc[k]) if abs(s.index[k] - d).days <= days else None


def value_one(con, ticker: str, sec_t: str | None, dart_fs: str | None, grp: str | None, y: dict) -> tuple[list, dict]:
    """→ (밴드 이력 행, 현재·시나리오 dict)"""
    fin = pd.read_sql("SELECT period_end e, revenue r, currency c FROM financials WHERE ticker=? ORDER BY period_end", con, params=(ticker,))
    fin["e"] = pd.to_datetime(fin.e)
    cur = fin.c.iloc[-1] if len(fin) else None
    out = {"currency": cur, **{k: y.get(k) for k in ("px_time", "px_date", "px_kind")}}
    if y["currency"] and cur and y["currency"] != cur:
        return [], {**out, "reason": f"주가 통화({y['currency']})와 실적 통화({cur})가 달라 비교하지 않음"}
    if not y["mcap"] or not y["price"] or y["px"].empty:
        return [], {**out, "reason": "시가총액 정보 없음"}
    px, mcap_now, shares_now = y["px"], float(y["mcap"]), float(y["mcap"]) / float(y["price"])
    sh = _sec_shares(sec_t, y["splits"]) if sec_t and not dart_fs else None
    bk = pd.read_sql("SELECT q_end, net_debt FROM credit_metrics WHERE ticker=? ORDER BY q_end", con, params=(ticker,))
    nd = pd.Series(bk.net_debt.values, index=pd.to_datetime(bk.q_end)).dropna() if len(bk) else pd.Series(dtype=float)
    oi = _oi(ticker, sec_t, dart_fs)

    hist = []
    for x in fin.tail(WINDOW + 4).itertuples():
        p = px[:x.e]
        if p.empty or x.e - p.index[-1] > pd.Timedelta(days=7) or x.e < px.index[0] + pd.Timedelta(days=5):
            continue
        dil = 1.0
        if sh is not None and len(sh):
            # 회계연도 4분기는 10-K에 연간 가중평균만 있어 가까운 분기 값(±100일)으로 — 그마저 없으면 (희석이 큰 회사에서 왜곡) 건너뜀
            a, b = _near(sh, x.e, 20) or _near(sh, x.e, 100), float(sh.iloc[-1])
            if a is None:
                continue
            dil = a / b
        mc = mcap_now * float(p.iloc[-1]) / float(y["price"]) * dil
        n_d = _near(nd, x.e, 20) if len(nd) else None
        ev = mc + (n_d or 0.0)
        o = _near(oi, x.e, 7)
        hist.append({"e": x.e, "ev": ev, "rev": x.r, "oi": o, "nd": n_d is not None})
    h = pd.DataFrame(hist).tail(WINDOW)
    if len(h) < MIN_N:
        return [], {**out, "reason": f"상장·실적 이력이 짧아 배수 밴드를 만들 수 없음 ({len(h)}분기, 최소 {MIN_N})"}
    h["ev_s"] = h.ev / (h.rev * 4)
    h["ev_ebit"] = [ev / (o * 4) if o is not None and o > 0 else np.nan for ev, o in zip(h.ev, h.oi)]

    # 진행 분기 추정 (없거나 보류면 직전 분기 실적)
    est = con.execute("SELECT est, low, high, tier, q_end FROM revenue_estimates WHERE ticker=? ORDER BY date DESC LIMIT 1", (ticker,)).fetchone()
    oie = con.execute("SELECT est, tier FROM oi_estimates WHERE ticker=? ORDER BY date DESC LIMIT 1", (ticker,)).fetchone()
    last_rev = float(fin.r.iloc[-1])
    if est and est[0]:
        r_est, r_lo, r_hi, tier, basis = float(est[0]), float(est[1]), float(est[2]), est[3], "진행 분기 추정"
    else:
        r_est = r_lo = r_hi = last_rev
        tier, basis = None, "직전 분기 실적 (추정 없음)"
    oi_tail = [o for o in h.oi.tail(4)]
    margins = [o / r for o, r in zip(oi_tail, h.rev.tail(4)) if o is not None]
    use_ebit = (grp not in CYCLICAL and len(margins) == 4 and min(margins) > 0 and sum(oi_tail) / h.rev.tail(4).sum() >= EBIT_MARGIN
                and h.ev_ebit.notna().sum() >= MIN_N)
    metric = "ev_ebit" if use_ebit else "ev_s"
    if use_ebit:
        if oie and oie[0] and oie[0] > 0 and oie[1] in ("신뢰", "보통", "참고") and basis == "진행 분기 추정":
            m_est, mbasis = float(oie[0]), "진행 분기 영업이익 추정"
        else:
            mg = float(np.median(margins))
            m_est, mbasis = r_est * mg, f"{basis} × 최근 4분기 영업이익률 중앙값 {mg:.0%}"
        m_lo, m_hi = m_est * r_lo / r_est, m_est * r_hi / r_est
    else:
        m_est, m_lo, m_hi, mbasis = r_est, r_lo, r_hi, basis

    v = h[metric].dropna()
    if len(v) < MIN_N:
        return [], {**out, "reason": f"배수 계산 가능한 분기가 {len(v)}개뿐"}
    q = dict(zip(("p10", "p25", "p50", "p75", "p90"), np.percentile(v, [10, 25, 50, 75, 90])))
    nd_now = float(nd.iloc[-1]) if len(nd) else 0.0
    ev_now = mcap_now + nd_now
    now = ev_now / (m_est * 4) if m_est > 0 else None
    last_m = (h.oi.iloc[-1] if metric == "ev_ebit" else h.rev.iloc[-1])
    trail = ev_now / (last_m * 4) if last_m and last_m > 0 else None
    pct = float((v < now).mean()) if now is not None else None
    p50_1y = float(np.median(v.tail(4)))  # 최근 1년 중앙 — 3년 중앙과 크게 다르면 재평가 진행 중
    rows = [(ticker, e.strftime("%Y-%m-%d"), metric, round(float(m), 3)) for e, m in zip(h.e, h[metric]) if m == m]
    res = {**out, "metric": metric, "basis": mbasis, "tier": tier, "now": now, "now_trail": trail, "n": len(v), "pct": pct,
           "nd": nd_now if len(nd) else None, "p50_1y": p50_1y, **{k: float(val) for k, val in q.items()}}

    spread = q["p75"] / q["p25"]
    reason = None
    if now is None:
        reason = "추정 이익이 0 이하라 배수를 낼 수 없음"
    elif tier == "보류":
        reason = "매출 추정이 보류(컨센서스와 25% 넘게 차이)라 시나리오를 내지 않음"
    elif spread > MAX_SPREAD:
        reason = f"3년 배수 변동이 큼(하위 25% {q['p25']:.1f}배 ~ 상위 25% {q['p75']:.1f}배) — 과거 배수로 주가를 내면 왜곡"
    elif abs(p50_1y / q["p50"] - 1) > REGIME:
        reason = f"최근 1년 배수(중앙 {p50_1y:.1f}배)가 3년 중앙({q['p50']:.1f}배)과 크게 달라 재평가가 진행 중 — 과거 배수로 주가를 내면 왜곡"
    elif not q["p10"] <= now <= q["p90"]:
        side = "위" if now > q["p90"] else "아래"
        reason = f"지금 배수 {now:.1f}배가 3년 범위({q['p10']:.1f}~{q['p90']:.1f}배) {side} — 시장이 평가 기준을 바꾼 국면이라 과거 배수로 주가를 내지 않음"
    if reason:
        return rows, {**res, "reason": reason}
    scen = {}
    for k, mult, base in (("bear", q["p25"], m_lo), ("base", q["p50"], m_est), ("bull", q["p75"], m_hi)):
        eq = mult * base * 4 - nd_now
        scen[k] = {"mult": round(mult, 2), "metric": base * 4, "equity": eq, "price": eq / shares_now if eq > 0 else None, "upside": eq / mcap_now - 1}
    return rows, {**res, "scen": scen}


def collect(con, log=print) -> int:
    today = date.today().isoformat()
    con.execute("DELETE FROM multiple_hist")
    con.execute("DELETE FROM multiple_now WHERE date=?", (today,))
    try:
        s, crumb = consensus._session()
    except Exception as e:  # noqa: BLE001
        log(f"  ✗ 밸류에이션: 야후 세션 {e}")
        return 0
    n_ok = n_scen = 0
    for ticker, sec_t, dart_fs, dart_seg, grp in con.execute("SELECT ticker, sec_ticker, dart_fs, dart_segment, grp FROM companies ORDER BY sort").fetchall():
        if dart_seg:
            res = {"reason": "사업부문 매출 기준이라 회사 전체 시가총액과 비교할 수 없음"}
        else:
            sym = "ASML.AS" if sec_t == "ASML" else ticker  # 유로 실적 ↔ 유로 상장 주가
            try:
                y = _yahoo(s, crumb, sym)
                rows, res = value_one(con, ticker, sec_t, dart_fs, grp, y)
            except Exception as e:  # noqa: BLE001
                log(f"  ✗ 밸류에이션 {ticker}: {e}")
                continue
            con.executemany("INSERT OR REPLACE INTO multiple_hist (ticker, q_end, metric, value) VALUES (?,?,?,?)", rows)
            time.sleep(0.2)
        scen = res.get("scen")
        con.execute("INSERT OR REPLACE INTO multiple_now (date, ticker, metric, basis, tier, now, now_trail, p10, p25, p50, p75, p90, p50_1y, n, pct, scen, reason, currency, px_time, px_date, px_kind) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (today, ticker, res.get("metric"), res.get("basis"), res.get("tier"), _r(res.get("now")), _r(res.get("now_trail")),
                     *[_r(res.get(k)) for k in ("p10", "p25", "p50", "p75", "p90", "p50_1y")], res.get("n"), _r(res.get("pct"), 3),
                     json.dumps(scen, ensure_ascii=False) if scen else None, res.get("reason"), res.get("currency"),
                     res.get("px_time"), res.get("px_date"), res.get("px_kind")))
        n_ok += res.get("now") is not None
        n_scen += bool(scen)
        if scen:
            log(f"  · {ticker} {res['metric']} 지금 {res['now']:.1f}배 (3년 {res['p25']:.1f}/{res['p50']:.1f}/{res['p75']:.1f}) → "
                + " / ".join(f"{k} {v['upside']:+.0%}" for k, v in scen.items()) + f" · 주가 {res.get('px_date')} {res.get('px_kind')}")
        else:
            log(f"  · {ticker} 시나리오 없음 — {res.get('reason')}")
    con.commit()
    log(f"  ✓ 밸류에이션 {n_ok}종목 배수 · 시나리오 {n_scen}종목")
    return n_ok


def _r(v, d=4):
    return None if v is None else round(float(v), d)
