"""FINRA 회사채 시장 집계 (FINRA API, 무료 개인 키) + 미 국채 수익률 곡선(FRED DGS) → finra_market · macro_obs.

FINRA 개인(Public) 키로는 종목별 회사채 가격(TRACE)은 안 나오고 시장 집계만:
- corporateMarketBreadth: 투자등급·하이일드 등 분류별 상승/하락/보합 종목 수, 거래 건수·금액, 52주 신고가·신저가
- corporateMarketSentiment: 분류·거래 유형별 거래량
응답 필드가 문서와 다를 수 있어 숫자 필드는 이름 그대로 모두 저장(dataset, date, category, field, value).
키: FINRA_API_CLIENT_ID / FINRA_API_CLIENT_SECRET (Actions Secrets). 없으면 건너뜀.
재게시 조건: 비영리·FINRA 출처 표기 — 신용 탭은 본인 전용 비공개 화면.
"""
import base64
import os
from datetime import date, timedelta

import requests

from etl import fred

TOKEN = "https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials"
API = "https://api.finra.org/data/group/fixedIncomeMarket/name/"
DATASETS = ("corporateMarketBreadth", "corporateMarketSentiment", "corporate144AMarketBreadth")
UST = {"DGS3MO": "3개월", "DGS6MO": "6개월", "DGS1": "1년", "DGS2": "2년", "DGS3": "3년", "DGS5": "5년", "DGS7": "7년", "DGS10": "10년", "DGS20": "20년", "DGS30": "30년"}


def _token() -> str | None:
    cid, sec = os.environ.get("FINRA_API_CLIENT_ID"), os.environ.get("FINRA_API_CLIENT_SECRET")
    if not cid or not sec:
        return None
    auth = base64.b64encode(f"{cid}:{sec}".encode()).decode()
    r = requests.post(TOKEN, headers={"Authorization": f"Basic {auth}"}, timeout=60)
    r.raise_for_status()
    return r.json()["access_token"]


def _fetch(tok: str, name: str, start: str) -> list[dict]:
    h = {"Authorization": f"Bearer {tok}", "Accept": "application/json", "Content-Type": "application/json"}
    out, off = [], 0
    while True:
        body = {"limit": 5000, "offset": off, "dateRangeFilters": [{"fieldName": "tradeReportDate", "startDate": start, "endDate": date.today().isoformat()}]}
        r = requests.post(API + name, headers=h, json=body, timeout=120)
        if r.status_code == 204:
            break
        r.raise_for_status()
        rows = r.json()
        out += rows
        if len(rows) < 5000:
            break
        off += 5000
    return out


def collect(con, log=print) -> int:
    n = 0
    try:  # 국채 곡선 (공공 데이터)
        rows = []
        for sid in UST:
            d = fred.series(sid)
            rows += [(sid, r.date.strftime("%Y-%m-%d"), float(r.value)) for r in d.itertuples() if r.date >= __import__("pandas").Timestamp("2021-01-01")]
        con.execute(f"DELETE FROM macro_obs WHERE series IN ({','.join('?' * len(UST))})", list(UST))
        con.executemany("INSERT OR REPLACE INTO macro_obs (series, date, value) VALUES (?,?,?)", rows)
        con.commit()
        last = {s: v for s, _, v in rows}
        log(f"  ✓ 국채 곡선 {len(rows)}행 · 2년 {last.get('DGS2')}% · 10년 {last.get('DGS10')}% · 30년 {last.get('DGS30')}%")
    except Exception as e:  # noqa: BLE001
        log(f"  ✗ 국채 곡선: {e}")
    try:
        tok = _token()
    except Exception as e:  # noqa: BLE001
        log(f"  ✗ FINRA 인증: {e}")
        return n
    if not tok:
        log("  · FINRA 키 없음 — 회사채 시장 집계 건너뜀 (FINRA_API_CLIENT_ID/SECRET)")
        return n
    start = (date.today() - timedelta(days=3 * 365)).isoformat()
    for name in DATASETS:
        try:
            rows = _fetch(tok, name, start)
        except Exception as e:  # noqa: BLE001
            log(f"  ✗ FINRA {name}: {e}")
            continue
        if not rows:
            log(f"  · FINRA {name}: 0행")
            continue
        log(f"  · FINRA {name} 필드: {sorted(rows[0])} · 분류 예: {sorted({str(r.get('productCategory')) for r in rows})[:6]}")
        recs = []
        for r in rows:
            d = str(r.get("tradeReportDate", ""))[:10]
            cat = " / ".join(str(r[k]) for k in ("productCategory", "tradeType", "gradeCode") if r.get(k) not in (None, ""))
            for f, v in r.items():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    recs.append((name, d, cat, f, float(v)))
        con.execute("DELETE FROM finra_market WHERE dataset=?", (name,))
        con.executemany("INSERT OR REPLACE INTO finra_market (dataset, date, category, field, value) VALUES (?,?,?,?,?)", recs)
        con.commit()
        n += len(recs)
        log(f"  ✓ FINRA {name}: {len(rows)}행 ({min(r[1] for r in recs)}~{max(r[1] for r in recs)})")
    return n
