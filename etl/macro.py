"""거시 유동성 — 연준 대차대조표·TGA·역레포·지준·M2·연방부채 (FRED) → macro_obs (값은 모두 십억 달러, 비율은 배).

- WALCL 연준 총자산(주간, 수요일) · WTREGEN 재무부 일반계정 TGA(주간) · RRPONTSYD 역레포(일별 → 수요일 값) · WRESBAL 지급준비금(주간)
- 순유동성 NETLIQ = 연준 총자산 − TGA − 역레포 (시장에 풀린 달러의 흔한 근사, 주간)
- M2SL 통화량(월, 계절조정) · GFDEBTN 연방정부 부채(분기) · GDP(분기, 연율)
- DEBT_M2 = 연방부채 ÷ 그 분기 평균 M2, DEBT_GDP = 연방부채 ÷ 명목 GDP (분기)
"""
import pandas as pd

from etl import fred

START = "2008-01-01"
SRC = {"WALCL": 1e-3, "WTREGEN": 1e-3, "RRPONTSYD": 1, "WRESBAL": 1e-3, "M2SL": 1, "GFDEBTN": 1e-3, "GDP": 1}  # → 십억 달러


def compute() -> pd.DataFrame:
    s = {}
    for k, mul in SRC.items():
        d = fred.series(k)
        s[k] = d.set_index("date")["value"] * mul
    wk = s["WALCL"].index
    rrp = s["RRPONTSYD"].reindex(s["RRPONTSYD"].index.union(wk)).ffill().reindex(wk)  # 수요일(또는 직전 영업일) 역레포
    s["RRPONTSYD"] = rrp
    s["NETLIQ"] = s["WALCL"] - s["WTREGEN"].reindex(wk) - rrp.fillna(0)
    m2q = s["M2SL"].resample("QS").mean()
    s["DEBT_M2"] = (s["GFDEBTN"] / m2q.reindex(s["GFDEBTN"].index)).dropna()
    s["DEBT_GDP"] = (s["GFDEBTN"] / s["GDP"].reindex(s["GFDEBTN"].index)).dropna()
    rows = [(k, d.strftime("%Y-%m-%d"), float(v)) for k, ser in s.items() for d, v in ser.dropna().items() if d >= pd.Timestamp(START)]
    return pd.DataFrame(rows, columns=["series", "date", "value"])


def collect(con, log=print) -> int:
    try:
        df = compute()
    except Exception as e:  # noqa: BLE001
        log(f"  ✗ 거시 유동성: {e}")
        return 0
    # FRED CSV가 가끔 한 주 전 사본을 돌려줌(연준 총자산 날짜가 11/11 ↔ 11/05 오락가락) → 이미 가진 최신일보다 뒤로 가지 않게
    # 새로 받은 마지막 날 이후의 기존 행은 그대로 둔다
    old = pd.DataFrame(con.execute("SELECT series, date, value FROM macro_obs WHERE series NOT LIKE 'DGS%'").fetchall(), columns=["series", "date", "value"])
    if len(old):
        new_last = df.groupby("series")["date"].max()
        keep = old[old.apply(lambda r: r.series in new_last and r.date > new_last[r.series], axis=1)]
        if len(keep):
            log(f"  · 거시 유동성: 받은 값이 기존보다 오래됨 → 최근 {len(keep)}행 유지 ({', '.join(sorted(set(keep.series)))})")
            df = pd.concat([df, keep], ignore_index=True).sort_values(["series", "date"]).reset_index(drop=True)
    con.execute("DELETE FROM macro_obs WHERE series NOT LIKE 'DGS%'")
    con.executemany("INSERT INTO macro_obs (series, date, value) VALUES (?,?,?)", list(df.itertuples(index=False, name=None)))
    con.commit()
    last = df.groupby("series").tail(1).set_index("series")
    log(f"  ✓ 거시 유동성 {len(df)}행 · 연준 {last.at['WALCL', 'value'] / 1e3:.2f}T · TGA {last.at['WTREGEN', 'value']:.0f}B · 순유동성 {last.at['NETLIQ', 'value'] / 1e3:.2f}T · M2 {last.at['M2SL', 'value'] / 1e3:.2f}T · 부채/M2 {last.at['DEBT_M2', 'value']:.2f}배")
    return len(df)
