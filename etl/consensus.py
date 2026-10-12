"""분기 매출 컨센서스 — 야후 파이낸스 earningsTrend (비공식 API, 쿠키+crumb 필요).

약관상 재게시 금지 → `consensus` 테이블은 로컬 SQLite에만 두고 Supabase에 게시하지 않는다(publish.PRIVATE).
공개 사이트에는 우리 추정치와의 괴리율(revenue_estimates.cons_gap)만 나간다. 원 금액은 로컬 관리 화면(/admin/consensus)에서만.
한국 종목은 부문 매출 기준이라 회사 전체 컨센서스와 비교할 수 없어 컨센서스는 받지 않고 발표 예정일만 (없으면 DART 작년 공시일로 추정).
다음 실적 발표 예정일(calendarEvents)·발표가 끝난 마지막 분기(earningsHistory)는 사실 정보라 earnings_calendar로 게시한다.
"""
from datetime import date

import requests

UA = {"User-Agent": "Mozilla/5.0"}
BASE = "https://query2.finance.yahoo.com"


def _session() -> tuple[requests.Session, str]:
    s = requests.Session()
    s.headers.update(UA)
    s.get("https://fc.yahoo.com/", timeout=20)  # 쿠키 (응답 코드는 404여도 됨)
    crumb = s.get(f"{BASE}/v1/test/getcrumb", timeout=20).text.strip()
    if not crumb or "{" in crumb:
        raise RuntimeError(f"crumb 실패: {crumb[:80]}")
    return s, crumb


def revenue_trend(s: requests.Session, crumb: str, symbol: str) -> tuple[list[dict], str | None, str | None]:
    """(이번·다음 분기 매출 컨센서스, 다음 실적 발표 예정일, 발표 끝난 마지막 분기 말일)"""
    r = s.get(f"{BASE}/v10/finance/quoteSummary/{symbol}", params={"modules": "earningsTrend,calendarEvents,earningsHistory", "crumb": crumb}, timeout=20)
    r.raise_for_status()
    res = r.json()["quoteSummary"]["result"][0]
    dates = [d.get("fmt") for d in ((res.get("calendarEvents") or {}).get("earnings") or {}).get("earningsDate") or [] if d.get("fmt")]
    out = []
    for t in res["earningsTrend"]["trend"]:
        if t.get("period") not in ("0q", "+1q"):
            continue
        rev = t.get("revenueEstimate") or {}
        avg = (rev.get("avg") or {}).get("raw")
        if avg:
            out.append({"period": t["period"], "end_date": t.get("endDate"), "avg": avg,
                        "low": (rev.get("low") or {}).get("raw"), "high": (rev.get("high") or {}).get("raw"),
                        "n": (rev.get("numberOfAnalysts") or {}).get("raw")})
    future = [d for d in dates if d >= date.today().isoformat()]  # 지난 발표일이 남아 있는 경우가 있음
    # SEC 10-K/10-Q는 발표 몇 주 뒤에 올라옴 → 그 사이 '이미 발표된 분기'를 추정 중으로 보이지 않게 표시용
    done = [(h.get("quarter") or {}).get("fmt") for h in ((res.get("earningsHistory") or {}).get("history") or [])]
    done = [d for d in done if d]
    return out, (min(future) if future else None), (max(done) if done else None)


def expected_date(con, ticker: str, sec_ticker: str | None, last_reported: str | None, today: date) -> tuple[str, str] | None:
    """발표 예정일이 없을 때(야후에 없음, 한국 종목 다수) 작년 같은 분기 발표일 + 1년으로 추정 → (날짜, 근거).
    한국: DART 잠정실적 공시일(없으면 분기·반기·사업보고서 제출일), 미국: 실적 보도자료(8-K) 제출일(data/guidance.json)."""
    import json
    import os

    import pandas as pd

    from etl import dart, guidance
    last = con.execute("SELECT max(period_end) FROM financials WHERE ticker=?", (ticker,)).fetchone()[0]
    ends = [pd.Timestamp(x) for x in (last, last_reported) if x]
    if not ends:
        return None
    q = max(ends) + pd.offsets.MonthEnd(3)  # 다음에 발표될 분기 말
    q_ly = q - pd.DateOffset(years=1)
    lo, hi = q_ly + pd.Timedelta(days=1), q_ly + pd.Timedelta(days=100)
    found = None
    if sec_ticker:
        store = json.loads(guidance.STORE.read_text()) if guidance.STORE.exists() else {}
        filed = sorted(g["filed"] for g in store.values() if g.get("ticker") == sec_ticker and not g.get("skip")
                       and lo <= pd.Timestamp(g["filed"]) <= hi)
        if filed:
            found = (filed[0], "작년 같은 분기 실적 발표일 기준 추정")
    elif os.environ.get("DART_API_KEY"):
        try:
            r = requests.get(f"{dart.BASE}/list.json", timeout=30, params={
                "crtfc_key": os.environ["DART_API_KEY"], "corp_code": dart.corp_code(ticker.split(".")[0]),
                "bgn_de": lo.strftime("%Y%m%d"), "end_de": hi.strftime("%Y%m%d"), "page_count": 100}).json()
            docs = sorted((x["rcept_dt"], x["report_nm"]) for x in r.get("list", []))
            pre = [d for d, n in docs if "잠정" in n and "실적" in n]
            rep = [d for d, n in docs if any(k in n for k in ("분기보고서", "반기보고서", "사업보고서"))]
            if pre:
                found = (f"{pre[0][:4]}-{pre[0][4:6]}-{pre[0][6:]}", "작년 같은 분기 잠정실적 공시일 기준 추정")
            elif rep:
                found = (f"{rep[0][:4]}-{rep[0][4:6]}-{rep[0][6:]}", "작년 같은 분기 정기보고서 제출일 기준 추정")
        except Exception:  # noqa: BLE001
            found = None
    if not found:  # 법정 기한: 분기·반기 45일, 사업보고서 90일
        d = q + pd.Timedelta(days=90 if q.month == 12 else 45)
        return (d.strftime("%Y-%m-%d"), "정기보고서 법정 기한") if d.date() >= today else None
    d = pd.Timestamp(found[0]) + pd.DateOffset(years=1)
    return (d.strftime("%Y-%m-%d"), found[1]) if d.date() >= today else None


def collect(con, log=print) -> int:
    targets = [t for (t,) in con.execute("SELECT sec_ticker FROM companies WHERE sec_ticker IS NOT NULL")]
    try:
        s, crumb = _session()
    except Exception as e:  # noqa: BLE001 — 컨센서스는 부가 정보: 실패해도 빌드는 계속
        log(f"  ✗ 컨센서스: {e}")
        return 0
    today, rows = date.today().isoformat(), []
    tick = dict(con.execute("SELECT sec_ticker, ticker FROM companies WHERE sec_ticker IS NOT NULL").fetchall())
    for sym in targets:
        try:
            trend, nxt, done = revenue_trend(s, crumb, sym)
            rows += [(today, sym, t["period"], t["end_date"], t["avg"], t["low"], t["high"], t["n"]) for t in trend]
            basis = None
            if not nxt and (e := expected_date(con, tick[sym], sym, done, date.today())):
                nxt, basis = e
            con.execute("INSERT OR REPLACE INTO earnings_calendar (ticker, next_date, updated, last_reported, next_basis) VALUES (?,?,?,?,?)",
                        (tick[sym], nxt, today, done, basis))  # 없으면 NULL로 지난 날짜 지움
            if done and not con.execute("SELECT 1 FROM earnings_reports WHERE ticker=? AND q_end=?", (tick[sym], done)).fetchone():
                con.execute("INSERT INTO earnings_reports VALUES (?,?,?)", (tick[sym], done, today))  # 발표를 처음 본 날 → 그 전 추정이 '발표 전 고정'

        except Exception as e:  # noqa: BLE001
            log(f"  ✗ 컨센서스 {sym}: {e}")
    # 한국 종목: 컨센서스는 부문 매출과 비교할 수 없어 받지 않고, 발표 예정일·발표 끝난 분기만 (야후 .KS/.KQ → 없으면 DART 작년 공시일)
    for (kt,) in con.execute("SELECT ticker FROM companies WHERE sec_ticker IS NULL").fetchall():
        try:
            _, nxt, done = revenue_trend(s, crumb, kt)
        except Exception:  # noqa: BLE001 — 야후에 없는 종목
            nxt = done = None
        basis = None
        if not nxt and (e := expected_date(con, kt, None, done, date.today())):
            nxt, basis = e
        con.execute("INSERT OR REPLACE INTO earnings_calendar (ticker, next_date, updated, last_reported, next_basis) VALUES (?,?,?,?,?)",
                    (kt, nxt, today, done, basis))
        if done and not con.execute("SELECT 1 FROM earnings_reports WHERE ticker=? AND q_end=?", (kt, done)).fetchone():
            con.execute("INSERT INTO earnings_reports VALUES (?,?,?)", (kt, done, today))
    con.executemany("INSERT OR REPLACE INTO consensus VALUES (?,?,?,?,?,?,?,?)", rows)
    log(f"  ✓ 컨센서스 {len({r[1] for r in rows})}/{len(targets)}종목 (로컬 전용, 게시 안 함)")
    return len(rows)
