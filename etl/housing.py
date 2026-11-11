"""미국 집값·주거비 — FHFA 주택가격지수와 CPI 주거비(OER·주거 전체), 30년 주담대 금리 (FRED) → housing_obs.

- HPIPONM226S FHFA 구매 기준 주택가격지수(월, 계절조정 — 미국 정부 자료, 재게시 가능)
- CUSR0000SEHC CPI 자가주거비 OER(월, 계절조정) · CUSR0000SAH1 CPI 주거 전체(월, 계절조정)
- MORTGAGE30US 30년 고정 주담대 금리(주간, %, Freddie Mac PMMS — 출처 표기)
케이스실러(S&P)는 재게시 제한이 있어 쓰지 않는다. 지수 원값만 저장하고 전년비·앞당김은 웹에서 계산.
"""
import pandas as pd

from etl import fred

START = "2000-01-01"
SRC = ("HPIPONM226S", "CUSR0000SEHC", "CUSR0000SAH1", "MORTGAGE30US")


def collect(con, log=print) -> int:
    rows = []
    try:
        for sid in SRC:
            d = fred.series(sid)
            rows += [(sid, t.strftime("%Y-%m-%d"), float(v)) for t, v in zip(d.date, d.value) if t >= pd.Timestamp(START)]
    except Exception as e:  # noqa: BLE001
        log(f"  ✗ 집값·주거비: {e}")
        return 0
    con.execute("DELETE FROM housing_obs")
    con.executemany("INSERT INTO housing_obs (series, date, value) VALUES (?,?,?)", rows)
    con.commit()
    last = {s: max((r for r in rows if r[0] == s), key=lambda r: r[1]) for s in SRC}
    log(f"  ✓ 집값·주거비 {len(rows)}행 · FHFA {last['HPIPONM226S'][1][:7]} · OER {last['CUSR0000SEHC'][1][:7]} · 주담대 {last['MORTGAGE30US'][2]:.2f}% ({last['MORTGAGE30US'][1]})")
    return len(rows)
