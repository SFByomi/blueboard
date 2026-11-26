"""메모리 가격·주가 탭용 주가 지수 → stock_index. 주 단위 수정 종가를 첫 주 = 100 지수로.

야후 주가는 재게시 금지라 가격(달러)은 저장·표시하지 않고 지수(수익률 경로)만 — 화면에서는 다시 '기간 고점 = 100'으로 바꿔
출하 단가와 겹쳐 본다. 종목은 메모리 종류별 대표: DRAM 마이크론(MU) · NAND 샌디스크(SNDK, 2025년 2월 상장) · HDD 시게이트(STX).
"""
import pandas as pd

from etl import consensus

TICKERS = ["MU", "SNDK", "STX"]
RANGE = "5y"


def _weekly(s, crumb, sym: str) -> pd.Series:
    r = s.get(f"{consensus.BASE}/v8/finance/chart/{sym}", params={"range": RANGE, "interval": "1d", "crumb": crumb}, timeout=30)
    r.raise_for_status()
    j = r.json()["chart"]["result"][0]
    px = pd.Series(j["indicators"]["adjclose"][0]["adjclose"], index=pd.to_datetime(j["timestamp"], unit="s").normalize()).dropna()
    px = px[~px.index.duplicated(keep="last")]
    return px.resample("W-FRI").last().dropna()  # 주 마지막 거래일 종가 (진행 중인 주는 가장 최근 종가)


def collect(con, log=print) -> int:
    try:
        s, crumb = consensus._session()
    except Exception as e:  # noqa: BLE001
        log(f"  ✗ 주가 지수: 야후 세션 {e} — 기존 값 유지")
        return 0
    rows, got = [], []
    for t in TICKERS:
        try:
            w = _weekly(s, crumb, t)
        except Exception as e:  # noqa: BLE001 — 한 종목 실패가 나머지를 막지 않게
            log(f"  ✗ 주가 지수 {t}: {e}")
            continue
        if len(w) < 8:
            continue
        idx = w / w.iloc[0] * 100
        rows += [(t, d.strftime("%Y-%m-%d"), round(float(v), 3)) for d, v in idx.items()]
        got.append(f"{t} {len(idx)}주")
    if not rows:
        log("  ✗ 주가 지수: 받은 종목 없음 — 기존 값 유지")
        return 0
    done = sorted({r[0] for r in rows})
    con.execute(f"DELETE FROM stock_index WHERE ticker IN ({','.join('?' * len(done))})", done)
    con.executemany("INSERT INTO stock_index (ticker, date, value) VALUES (?,?,?)", rows)
    con.commit()
    log(f"  ✓ 주가 지수 {' · '.join(got)} (첫 주 = 100, 가격은 저장 안 함)")
    return len(rows)
