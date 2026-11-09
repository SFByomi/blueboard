"""data/estimate_reviews.json(git 원본) → estimate_reviews 테이블 + 공시 전 실적 반영.

실적이 나올 때마다 '발표 전 추정 vs 실제 · 왜 틀렸나 · 무엇을 바꿨나'를 한 줄씩 남긴다(Claude가 관리, CLAUDE.md 참고).
actual이 있고 financials에 그 분기가 아직 없으면(부문 매출처럼 자동 수집이 안 되는 것) basis='발표'로 먼저 넣어
추정·백테스트·편향 보정이 바로 그 실적을 쓰게 한다. 분기보고서·10-Q가 들어오면 그 값이 우선(빌드마다 다시 채움).
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

PATH = Path(__file__).resolve().parents[1] / "data" / "estimate_reviews.json"
COLS = ("ticker", "q_end", "announced", "actual", "source", "url", "est", "low", "high", "est_asof", "method", "tier", "cause", "why", "fix")


def load(con, log=print) -> int:
    if not PATH.exists():
        return 0
    d = json.loads(PATH.read_text(encoding="utf-8"))
    rows = d.get("reviews", [])
    con.execute("DELETE FROM estimate_reviews")
    con.executemany(f"INSERT OR REPLACE INTO estimate_reviews ({', '.join(COLS)}) VALUES ({','.join('?' * len(COLS))})",
                    [tuple(r.get(c) for c in COLS) for r in rows])
    for r in rows:
        if not r.get("actual"):
            continue
        end = pd.Timestamp(r["q_end"])
        have = con.execute("SELECT 1 FROM financials WHERE ticker=? AND abs(julianday(period_end) - julianday(?)) <= 10", (r["ticker"], r["q_end"])).fetchone()
        last = con.execute("SELECT period_end, currency FROM financials WHERE ticker=? ORDER BY period_end DESC LIMIT 1", (r["ticker"],)).fetchone()
        if have or not last or pd.Timestamp(last[0]) >= end:
            continue
        if (end - pd.Timestamp(last[0])).days > 100:  # 바로 다음 분기만 (중간 분기가 비면 전년비 위치가 어긋남)
            log(f"  ✗ 복기 {r['ticker']} {r['q_end']}: 직전 실적이 {last[0]} — 중간 분기가 비어 건너뜀")
            continue
        con.execute("INSERT INTO financials (ticker, period_end, period_start, revenue, currency, basis) VALUES (?,?,?,?,?,?)",
                    (r["ticker"], r["q_end"], (pd.Timestamp(last[0]) + pd.Timedelta(days=1)).strftime("%Y-%m-%d"), float(r["actual"]), last[1], "발표"))
        log(f"  ✓ 매출 {r['ticker']}: {r['q_end'][:7]} 분기 — 회사 발표({r['announced']}) 먼저 반영, 공시 전")
    con.commit()
    return len(rows)
