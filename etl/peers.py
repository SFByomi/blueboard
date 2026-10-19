"""두산(000150.KS) 피어 비교 · 밸류에이션 → peer_revenue · valuation.

대만 CCL 경쟁사 3곳(EMC 台光電·TUC 台燿·ITEQ 聯茂) — 대만 상장사는 매월 10일까지 전월 매출, 분기마다 재무제표를 공시(MOPS).
FinMind 공개 API로 받는다(토큰 없이 시간당 수백 회). 월매출은 공시 사실이라 그대로 게시.
  · EV/EBITDA(최근 4분기) = (종가 × 주식수 + 차입금 − 현금) ÷ (영업이익 + 감가상각·상각) 4분기 합.
    분기 재무는 공시 기한(1~3분기 45일, 4분기 90일) 뒤부터 반영. 감가상각은 현금흐름표 누계 → 분기 차이.
두산 — 지주사라 회사 전체 배수는 자회사 이익이 섞여 피어와 비교가 안 된다 → 지분가치와 자체사업으로 나눠 본다.
  · 지분가치 할인율 = 1 − 시가총액 ÷ (상장 자회사 지분 시가 + 비상장 지분 장부가 − 별도 순차입금)
    자체사업(전자BG 등) 가치를 넣지 않은 보수적 NAV — 가정(목표 배수)이 없어 추세 비교가 깨끗하다. 증권사 NAV는 자체사업 가치를 더해 더 크게 나옴.
    지분 수·장부가는 DART 타법인출자현황(반기·사업보고서, 분기보고서는 내역이 비어 제외).
  · 자체사업 암묵 EV/EBITDA = (시가총액 − 지분가치 + 별도 순차입금) ÷ 별도 EBITDA(최근 4분기) = 시장이 자체사업에 매기는 배수(음수면 공짜 취급).
두산·자회사 주가는 야후(재게시 금지) → 가격·시가총액·지분가치 원값은 저장하지 않고 배수·비율만 저장한다. 주 1회(금요일) + 마지막 날.
"""
import json
import os
from datetime import date

import pandas as pd
import requests

from etl import consensus, dart

FINMIND = "https://api.finmindtrade.com/api/v4/data"
PEERS = [("2383", "EMC"), ("6274", "TUC"), ("6213", "ITEQ")]
HOLDCO = "000150.KS"
LISTED = {"두산에너빌리티": "034020.KS", "두산중공업": "034020.KS", "두산로보틱스": "454910.KS", "오리콤": "010470.KQ"}  # 타법인출자현황 이름 → 야후 심볼 (에너빌리티는 2022-03까지 두산중공업)
START = "2020-01-01"


def _fm(ds: str, sid: str, start: str = START) -> pd.DataFrame:
    r = requests.get(FINMIND, params={"dataset": ds, "data_id": sid, "start_date": start}, timeout=60)
    r.raise_for_status()
    j = r.json()
    if j.get("status") != 200:
        raise RuntimeError(j.get("msg"))
    return pd.DataFrame(j["data"])


def _avail(q_end: pd.Timestamp) -> pd.Timestamp:
    """분기 재무가 시장에 알려지는 날 (공시 기한)"""
    return q_end + pd.Timedelta(days=90 if q_end.month == 12 else 45)


def _peer(sid: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(월매출 [month, revenue], 주간 EV/EBITDA [date, value])"""
    rv = _fm("TaiwanStockMonthRevenue", sid)
    rev = pd.DataFrame({"month": [f"{y}-{m:02d}" for y, m in zip(rv.revenue_year, rv.revenue_month)], "revenue": rv.revenue.astype(float)})
    fs, cf, bs = _fm("TaiwanStockFinancialStatements", sid), _fm("TaiwanStockCashFlowsStatement", sid), _fm("TaiwanStockBalanceSheet", sid)
    oi = fs[fs.type == "OperatingIncome"].set_index("date").value.astype(float)
    dep_ytd = cf[cf.type.isin(["Depreciation", "AmortizationExpense"])].groupby("date").value.sum()
    dep_ytd.index = pd.to_datetime(dep_ytd.index)
    dep = dep_ytd - dep_ytd.groupby(dep_ytd.index.year).shift(1).fillna(0)  # 누계 → 분기 (1분기는 그대로)
    oi.index = pd.to_datetime(oi.index)
    q = pd.DataFrame({"oi": oi, "dep": dep}).dropna().sort_index()
    q["ebitda"] = (q.oi + q.dep).rolling(4).sum()
    b = bs.pivot_table(index="date", columns="type", values="value")
    b.index = pd.to_datetime(b.index)
    q["debt"] = b[[c for c in ("ShorttermBorrowings", "LongtermBorrowings", "BondsPayable") if c in b]].sum(axis=1)
    q["cash"] = b.get("CashAndCashEquivalents")
    q["shares"] = b.get("OrdinaryShare") / 10  # 액면 10 대만달러
    q = q.dropna(subset=["ebitda"])
    q["avail"] = [_avail(i) for i in q.index]
    px = _fm("TaiwanStockPrice", sid)
    px = pd.Series(px.close.astype(float).to_numpy(), index=pd.to_datetime(px.date))
    d = pd.merge_asof(px.rename("px").to_frame().rename_axis("date").reset_index(), q.sort_values("avail"), left_on="date", right_on="avail")
    d = d.dropna(subset=["ebitda"])
    d = d[d.ebitda > 0]
    d["value"] = (d.px * d.shares + d.debt - d.cash) / d.ebitda
    return rev, _weekly(d.set_index("date").value)


def _weekly(s: pd.Series) -> pd.DataFrame:
    s = s.dropna().sort_index()
    w = s[s.index.dayofweek == 4]
    w = pd.concat([w, s.iloc[-1:]])
    w = w[~w.index.duplicated(keep="last")]
    return pd.DataFrame({"date": w.index.strftime("%Y-%m-%d"), "value": w.to_numpy().round(4)})


def _stakes(corp: str) -> pd.DataFrame:
    """DART 타법인출자현황 → [as_of, name, shares, book] (보고서 기준일, 캐시)"""
    rows = []
    for y in range(int(START[:4]), date.today().year + 1):
        for rc, mmdd in (("11013", "03-31"), ("11012", "06-30"), ("11014", "09-30"), ("11011", "12-31")):
            path = dart.CACHE / "otr" / f"{corp}_{y}_{rc}.json"
            if path.exists():
                js = json.loads(path.read_text(encoding="utf-8"))
            else:
                if f"{y}-{mmdd}" > date.today().isoformat():
                    continue
                js = requests.get(f"{dart.BASE}/otrCprInvstmntSttus.json", timeout=30, params={
                    "crtfc_key": os.environ["DART_API_KEY"], "corp_code": corp, "bsns_year": str(y), "reprt_code": rc}).json()
                if js.get("status") not in ("000", "013"):  # 013 = 데이터 없음(아직 미제출) → 캐시하지 않음
                    continue
                if js.get("status") == "000":
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(json.dumps(js, ensure_ascii=False), encoding="utf-8")
            num = lambda v: float(str(v).replace(",", "")) if v not in (None, "-", "") else 0.0  # noqa: E731
            for x in js.get("list", []):
                rows.append({"as_of": f"{y}-{mmdd}", "name": x.get("inv_prm") or "", "shares": num(x.get("trmend_blce_qy")),
                             "book": num(x.get("trmend_blce_acntbk_amount"))})
    df = pd.DataFrame(rows)
    # 분기보고서는 출자 내역이 비어 있는 경우가 많음 → 개별 회사 행이 있는 보고서만
    has = df[(df.name != "합계") & ((df.shares > 0) | (df.book > 0))].as_of.unique() if len(df) else []
    return df[df.as_of.isin(has)]


def _holdco(con, s, crumb, log) -> pd.DataFrame:
    """두산: 자체사업 암묵 EV/EBITDA · NAV 할인율 · 시총 중 지분가치 비중 (주간)"""
    from etl.market_credit import _yahoo
    st = _stakes(dart.corp_code(HOLDCO.split(".")[0]))
    if st.empty:
        raise RuntimeError("타법인출자현황 없음")
    px, sh = _yahoo(s, crumb, HOLDCO, "10y")
    if not sh:
        raise RuntimeError("주식수 없음")
    sub = {sym: _yahoo(s, crumb, sym, "10y")[0] for sym in LISTED.values()}
    bk = pd.read_sql("SELECT q_end, debt, cash, ebitda_ttm FROM credit_metrics WHERE ticker=? ORDER BY q_end", con, params=(HOLDCO,))
    bk["avail"] = [_avail(pd.Timestamp(q)) for q in bk.q_end]
    reports = sorted(st.as_of.unique())
    out = []
    for d, p in px.items():
        if d < pd.Timestamp("2021-01-01"):
            continue
        rep = [r for r in reports if _avail(pd.Timestamp(r)) <= d]
        b = bk[bk.avail <= d].tail(1)
        if not rep or b.empty:
            continue
        cur = st[(st.as_of == rep[-1]) & (st.name != "합계")]
        listed = unlisted = 0.0
        for x in cur.itertuples():
            sym = next((v for k, v in LISTED.items() if k in x.name), None)
            spx = sub.get(sym) if sym else None
            last = spx[spx.index <= d] if spx is not None else None
            if sym and last is not None and len(last) and (d - last.index[-1]).days < 10:  # 상장 전(로보틱스 2023-10)은 장부가
                listed += x.shares * last.iloc[-1]
            else:
                unlisted += x.book
        mcap, nd, e = p * sh, b.debt.iloc[0] - b.cash.iloc[0], b.ebitda_ttm.iloc[0]
        row = {"date": d, "stake_discount": 1 - mcap / (listed + unlisted - nd), "listed_share": listed / (listed + unlisted)}
        if e and e > 0:  # 별도 EBITDA는 감가상각(XBRL)이 있는 2022년 말부터
            row["own_ev_ebitda"] = (mcap - listed - unlisted + nd) / e
        out.append(row)
    df = pd.DataFrame(out).set_index("date")
    frames = []
    for m in df.columns:
        w = _weekly(df[m])
        w["metric"] = m
        frames.append(w)
    return pd.concat(frames)


def collect(con, log=print) -> int:
    revs, vals = [], []
    peer_ev = {}
    for sid, name in PEERS:
        try:
            rev, ev = _peer(sid)
        except Exception as e:  # noqa: BLE001 — 부가 정보: 실패해도 빌드는 계속
            log(f"  ✗ 피어 {name}: {e}")
            continue
        revs += [(name, m, v) for m, v in zip(rev.month, rev.revenue)]
        vals += [(name, d, "ev_ebitda", v) for d, v in zip(ev.date, ev.value)]
        peer_ev[name] = pd.Series(ev.value.to_numpy(), index=pd.to_datetime(ev.date))
    if revs:
        con.execute("DELETE FROM peer_revenue")
        con.executemany("INSERT OR REPLACE INTO peer_revenue VALUES (?,?,?)", revs)
    try:
        s, crumb = consensus._session()
        h = _holdco(con, s, crumb, log)
        vals += [(HOLDCO, d, m, v) for d, m, v in zip(h.date, h.metric, h.value)]
    except Exception as e:  # noqa: BLE001
        log(f"  ✗ 두산 NAV: {e}")
    if vals:
        con.execute("DELETE FROM valuation")
        con.executemany("INSERT OR REPLACE INTO valuation VALUES (?,?,?,?)", vals)
    last = {n: float(round(v.iloc[-1], 1)) for n, v in peer_ev.items()}
    hd = {m: v for (t, d, m, v) in vals if t == HOLDCO}
    log(f"  ✓ 피어 월매출 {len(revs)}행 · EV/EBITDA {last} · 두산 지분가치 할인 {hd.get('stake_discount', float('nan')):.0%} · 자체사업 암묵 {hd.get('own_ev_ebitda', float('nan')):.1f}배")
    return len(vals)
