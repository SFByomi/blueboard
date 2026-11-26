"""중소형주·경기민감주 상대 강도 → rel_strength. 시장 점검 탭 '중소형주·경기민감주의 상대 강세'.

  SMALL = IWM(러셀 2000) ÷ SPY(S&P 500)          — 중소형주가 대형주보다 강한가
  EQUAL = RSP(S&P 500 동일가중) ÷ SPY            — 상승이 소수 대형주에 쏠렸나, 넓게 퍼졌나
  CYC   = (XLI 산업재·XLB 소재·XLF 금융·XLE 에너지 동일 비중) ÷ SPY — 경기민감 업종
종가는 야후(재게시 금지) → 가격은 저장하지 않고 두 수익률의 비율만, 첫날 = 100. 값이 오르면 분자가 더 강함.
"""
import pandas as pd

from etl import consensus

RANGE = "3y"
CYC = ["XLI", "XLB", "XLF", "XLE"]


def _close(s, crumb, sym: str) -> pd.Series:
    r = s.get(f"{consensus.BASE}/v8/finance/chart/{sym}", params={"range": RANGE, "interval": "1d", "crumb": crumb}, timeout=30)
    r.raise_for_status()
    j = r.json()["chart"]["result"][0]
    px = pd.Series(j["indicators"]["adjclose"][0]["adjclose"], index=pd.to_datetime(j["timestamp"], unit="s").normalize()).dropna()  # 배당 반영 종가
    return px[~px.index.duplicated(keep="last")]


def compute() -> pd.DataFrame:
    s, crumb = consensus._session()
    px = pd.DataFrame({t: _close(s, crumb, t) for t in ["SPY", "IWM", "RSP", *CYC]}).dropna()
    rel = px / px.iloc[0]  # 첫날 대비 수익률 지수
    out = {"SMALL": rel["IWM"] / rel["SPY"], "EQUAL": rel["RSP"] / rel["SPY"], "CYC": rel[CYC].mean(axis=1) / rel["SPY"]}
    rows = [(k, d.strftime("%Y-%m-%d"), round(float(v) * 100, 3)) for k, ser in out.items() for d, v in ser.items()]
    return pd.DataFrame(rows, columns=["series", "date", "value"])


def collect(con, log=print) -> int:
    try:
        df = compute()
    except Exception as e:  # noqa: BLE001 — 야후 실패 시 기존 값 유지
        log(f"  ✗ 상대 강도: {e} — 기존 값 유지")
        return 0
    if df.empty:
        log("  ✗ 상대 강도: 받은 값 없음 — 기존 값 유지")
        return 0
    con.execute("DELETE FROM rel_strength")
    con.executemany("INSERT INTO rel_strength (series, date, value) VALUES (?,?,?)", list(df.itertuples(index=False, name=None)))
    con.commit()
    last = df.groupby("series").tail(1).set_index("series").value
    log(f"  ✓ 상대 강도 {len(df)}행 · 중소형 {last['SMALL']:.1f} · 동일가중 {last['EQUAL']:.1f} · 경기민감 {last['CYC']:.1f} (3년 전 = 100)")
    return len(df)
