"""주가 내재 신용위험 (Merton 모형, Bharath·Shumway 2008 단순판) → market_credit. 회사채 가격이 없을 때 '시장이 보는 부도 가능성'.

  E = 시가총액(종가 × 현재 발행주식수), σE = 최근 1년 일간 로그수익률 변동성(연율)
  F = 부도 기준 부채 = 1년 내 만기 + 0.5 × 나머지 차입 (KMV 관행, 그 날 기준 최근 분기 장부 — credit_metrics)
  σD = 0.05 + 0.25σE,  σV = E/(E+F)·σE + F/(E+F)·σD,  r = 미 국채 1년(한국 종목도 단순화)
  DD = [ln((E+F)/F) + (r − σV²/2)] / σV (1년, KMV 표준),  1년 부도확률 = N(−DD),  5년 = 1 − (1 − p₁)⁵ (누적 환산)
  ※ 5년 지평으로 바로 풀면 변동성 큰 무차입 회사(샌디스크 등)가 과대 — 1년으로 풀고 누적
주가는 야후(재게시 금지) → 원 가격·시가총액은 저장하지 않고 결과(변동성·DD·부도확률)만. 부채가 거의 없으면 계산하지 않음.
"""
import math

import numpy as np
import pandas as pd

from etl import consensus



def _ncdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _yahoo(s, crumb, sym: str, rng: str = "4y") -> tuple[pd.Series, float | None]:
    r = s.get(f"{consensus.BASE}/v8/finance/chart/{sym}", params={"range": rng, "interval": "1d", "crumb": crumb}, timeout=30)
    r.raise_for_status()
    j = r.json()["chart"]["result"][0]
    px = pd.Series(j["indicators"]["quote"][0]["close"], index=pd.to_datetime(j["timestamp"], unit="s").normalize()).dropna()
    k = s.get(f"{consensus.BASE}/v10/finance/quoteSummary/{sym}", params={"modules": "defaultKeyStatistics", "crumb": crumb}, timeout=30).json()
    sh = ((k["quoteSummary"]["result"] or [{}])[0].get("defaultKeyStatistics") or {}).get("sharesOutstanding", {}).get("raw")
    return px[~px.index.duplicated(keep="last")], sh


def collect(con, log=print) -> int:
    rows = con.execute("SELECT DISTINCT ticker FROM credit_metrics").fetchall()
    rf = pd.Series(dict(con.execute("SELECT date, value FROM macro_obs WHERE series='DGS1'").fetchall()), dtype=float)
    rf.index = pd.to_datetime(rf.index)
    try:
        s, crumb = consensus._session()
    except Exception as e:  # noqa: BLE001
        log(f"  ✗ 주가 내재 신용: 야후 세션 {e}")
        return 0
    out = []
    for (t,) in rows:
        try:
            px, sh = _yahoo(s, crumb, t)
        except Exception as e:  # noqa: BLE001
            log(f"  ✗ 주가 내재 신용 {t}: {e}")
            continue
        if not sh or len(px) < 260:
            continue
        bk = pd.read_sql("SELECT q_end, debt, due_1y FROM credit_metrics WHERE ticker=? ORDER BY q_end", con, params=(t,))
        bk["q_end"] = pd.to_datetime(bk.q_end) + pd.Timedelta(days=45)  # 분기 말 장부는 대략 45일 뒤 공시 → 그때부터 반영
        lr = np.log(px).diff()
        vol = lr.rolling(252, min_periods=200).std() * math.sqrt(252)
        df = pd.DataFrame({"px": px, "vol": vol}).dropna()
        df = pd.merge_asof(df.reset_index().rename(columns={"index": "date"}).sort_values("date"), bk.rename(columns={"q_end": "date"}).sort_values("date"), on="date")
        df["r"] = rf.reindex(df.date, method="ffill").to_numpy() / 100
        for x in df.dropna(subset=["debt"]).itertuples():
            due = x.due_1y if x.due_1y == x.due_1y and x.due_1y is not None else 0.0
            f = due + 0.5 * max(x.debt - due, 0.0)
            e = x.px * sh
            if f <= 0.01 * e:  # 부채가 시가총액의 1% 미만 — 부도 위험 계산 의미 없음
                continue
            sd = 0.05 + 0.25 * x.vol
            sv = e / (e + f) * x.vol + f / (e + f) * sd
            r = x.r if x.r == x.r else 0.04
            dd = (math.log((e + f) / f) + (r - sv * sv / 2)) / sv
            p1 = _ncdf(-dd)
            out.append((t, x.date.strftime("%Y-%m-%d"), round(float(x.vol), 4), round(dd, 3), round(p1, 6), round(1 - (1 - p1) ** 5, 5), round(f / (e + f), 4)))
    con.execute("DELETE FROM market_credit")
    con.executemany("INSERT INTO market_credit (ticker, date, vol, dd, pd1, pd5, lev_mkt) VALUES (?,?,?,?,?,?,?)", out)
    con.commit()
    last = {}
    for t, d, v, dd, p1, p, lv in out:
        last[t] = p
    top = sorted(last.items(), key=lambda kv: -kv[1])[:5]
    log(f"  ✓ 주가 내재 5년 부도확률 {len(last)}종목 · 높은 순 " + ", ".join(f"{t} {p:.1%}" for t, p in top))
    return len(out)
