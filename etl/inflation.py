"""미국 물가 구성요소 기여도 — CPI·PCE 헤드라인/코어 전년비·전월비를 서비스·공산품·식품·에너지로 나눈다 (FRED).

CPI: 지출액이 없어 가중치를 지수에서 역산. CPI는 한 해 안에서 '전년 12월 기준 고정 가중' 평균이므로
     해마다 (I_all,t / I_all,12월) = Σ w_i (I_i,t / I_i,12월) 를 최소제곱(합 1, 음수는 0)으로 풀어 상대 중요도 w를 구하고,
     기여도_i = w_i(t−k 시점 실효 가중) × 구성요소 변화율.  전월비는 계절조정 지수.
PCE: 명목 지출 비중(t−k) × 가격지수 변화율 — 상품+서비스 합이 헤드라인과 정확히 일치(검증).
     식품·에너지는 각자 비중, 근원 상품 = 상품 − 식품 − 에너지 상품, 근원 서비스 = 서비스 − 에너지 서비스.
     에너지 상품/서비스 나눔은 분기 휘발유 등 에너지 상품 지출 비중(월 보간) — 근원 상품·서비스 사이 배분에만 영향.
두 지수 모두 구성요소 합을 발표 헤드라인(코어)에 맞춰 비례 조정(잔차는 수 bp)하고, 막대 합 = 선.
"""
import numpy as np
import pandas as pd

from etl import fred

COMPS = ("services", "goods", "food", "energy")  # 서비스(에너지 제외)·공산품(식품·에너지 제외)·식품·에너지
CPI_NSA = {"all": "CPIAUCNS", "core": "CPILFENS", "services": "CUUR0000SASLE", "goods": "CUUR0000SACL1E", "food": "CPIUFDNS", "energy": "CPIENGNS"}
CPI_SA = {"all": "CPIAUCSL", "core": "CPILFESL", "services": "CUSR0000SASLE", "goods": "CUSR0000SACL1E", "food": "CPIUFDSL", "energy": "CPIENGSL"}
PCE_P = {"all": "PCEPI", "core": "PCEPILFE", "g": "DGDSRG3M086SBEA", "s": "DSERRG3M086SBEA", "food": "DFXARG3M086SBEA", "energy": "DNRGRG3M086SBEA"}
PCE_N = {"all": "PCE", "g": "DGDSRC1", "s": "PCES", "food": "DFXARC1M027SBEA", "energy": "DNRGRC1M027SBEA",
         "eg_q": "DGOERC1Q027SBEA", "e_q": "DNRGRC1Q027SBEA"}  # 에너지 상품(휘발유 등)·에너지 전체 분기 지출
START = "2015-01-01"


def _s(sid: str) -> pd.Series:
    d = fred.series(sid)
    return d.set_index("date")["value"]


def cpi_weights(nsa: dict[str, pd.Series]) -> pd.DataFrame:
    """연도 → 구성요소 상대 중요도(전년 12월 기준). 그 해 1~12월(있는 만큼) 지수로 역산"""
    out = {}
    df = pd.DataFrame(nsa)
    for y in sorted({d.year for d in df.index if d.year >= 2000}):
        base = pd.Timestamp(f"{y - 1}-12-01")
        if base not in df.index:
            continue
        rows = df[(df.index.year == y)].dropna()
        if len(rows) < 2:
            continue
        a = np.array([[rows[c].iloc[i] / df.at[base, c] for c in COMPS] for i in range(len(rows))])
        b = (rows["all"] / df.at[base, "all"]).to_numpy()
        a = np.vstack([a, 1e3 * np.ones(len(COMPS))])  # 합 = 1 제약을 큰 가중으로
        w = np.clip(np.linalg.lstsq(a, np.append(b, 1e3), rcond=None)[0], 0, None)
        out[y] = w / w.sum()
    return pd.DataFrame(out, index=COMPS).T


def _cpi(lag: int, sa: bool, core: bool, nsa: dict, sad: dict, w: pd.DataFrame) -> pd.DataFrame:
    idx = pd.DataFrame(sad if sa else nsa)
    lv = pd.DataFrame(nsa)
    comps = ("services", "goods") if core else COMPS
    rows = []
    for t in idx.index:
        p = t - pd.DateOffset(months=lag)
        if p not in idx.index or p.year not in w.index or pd.Timestamp(f"{p.year - 1}-12-01") not in lv.index:
            continue
        base = pd.Timestamp(f"{p.year - 1}-12-01")
        eff = {c: w.at[p.year, c] * lv.at[p, c] / lv.at[base, c] for c in comps}  # t−k 시점 실효 가중
        tot = sum(eff.values())
        contrib = {c: eff[c] / tot * (idx.at[t, c] / idx.at[p, c] - 1) for c in comps}
        head = idx.at[t, "core" if core else "all"] / idx.at[p, "core" if core else "all"] - 1
        rows.append({"month": t, "total": head, **contrib})
    return pd.DataFrame(rows)


def _pce(lag: int, core: bool, P: dict, N: dict) -> pd.DataFrame:
    th = (N["eg_q"] / N["e_q"]).resample("MS").ffill()  # 에너지 지출 중 에너지 상품 비중
    th = th.reindex(N["energy"].index).ffill()
    tot = N["all"]
    ch = lambda x: x / x.shift(lag) - 1  # noqa: E731
    sh = lambda x: (x / tot).shift(lag)  # noqa: E731
    c_g, c_s = sh(N["g"]) * ch(P["g"]), sh(N["s"]) * ch(P["s"])
    c_f, c_e = sh(N["food"]) * ch(P["food"]), sh(N["energy"]) * ch(P["energy"])
    c_eg = c_e * th.shift(lag)
    df = pd.DataFrame({"services": c_s - (c_e - c_eg), "goods": c_g - c_f - c_eg, "food": c_f, "energy": c_e})
    if core:
        share = 1 - sh(N["food"]) - sh(N["energy"])
        df = pd.DataFrame({"services": df.services / share, "goods": df.goods / share})
    df["total"] = ch(P["core" if core else "all"])
    return df.dropna().rename_axis("month").reset_index()


def compute() -> pd.DataFrame:
    """[measure, basis, kind, month, total, services, goods, food, energy, resid] — 막대 합 = total(발표치)로 비례 조정, resid는 조정 전 차이"""
    nsa = {k: _s(v) for k, v in CPI_NSA.items()}
    sad = {k: _s(v) for k, v in CPI_SA.items()}
    w = cpi_weights(nsa)
    P, N = {k: _s(v) for k, v in PCE_P.items()}, {k: _s(v) for k, v in PCE_N.items()}
    out = []
    for kind, lag in (("yoy", 12), ("mom", 1)):
        for basis in ("headline", "core"):
            core = basis == "core"
            for measure, df in (("CPI", _cpi(lag, kind == "mom", core, nsa, sad, w)), ("PCE", _pce(lag, core, P, N))):
                df = df[df.month >= START].copy()
                comps = [c for c in COMPS if c in df]
                s = df[comps].sum(axis=1)
                df["resid"] = df.total - s
                k = (df.total / s).where(s.abs() > 1e-4, 1.0)
                for c in comps:
                    df[c] = df[c] * k
                df["measure"], df["basis"], df["kind"] = measure, basis, kind
                out.append(df)
    res = pd.concat(out, ignore_index=True)
    for c in COMPS:
        if c not in res:
            res[c] = np.nan
    res["month"] = res.month.dt.strftime("%Y-%m")
    return res[["measure", "basis", "kind", "month", "total", *COMPS, "resid"]]


def collect(con, log=print) -> int:
    try:
        df = compute()
    except Exception as e:  # noqa: BLE001
        log(f"  ✗ 물가 기여도: {e}")
        return 0
    con.execute("DELETE FROM inflation_contrib")
    con.executemany("INSERT INTO inflation_contrib (measure, basis, kind, month, total, services, goods, food, energy, resid) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    [tuple(None if (isinstance(v, float) and np.isnan(v)) else v for v in r) for r in df.itertuples(index=False)])
    con.commit()
    last = df[(df.kind == "yoy") & (df.basis == "headline")].groupby("measure").tail(1)
    log("  ✓ 물가 기여도 " + " · ".join(f"{r.measure} {r.month} {r.total:+.2%}" for r in last.itertuples()) + f" ({len(df)}행)")
    return len(df)
