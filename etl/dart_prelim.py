"""DART 영업(잠정)실적(공정공시) → 분기보고서 전에 연결 매출을 먼저 반영.

한국 회사는 실적 발표 날 '연결재무제표기준영업(잠정)실적(공정공시)'를 내고, 분기보고서(XBRL, dart.py)는
분기 말 45일 뒤에야 나온다(3분기는 11/14). 그 사이 사이트가 '공시 반영 대기'로 몇 주씩 멈춰 있던 문제 →
잠정실적 표의 '매출액 당해실적'을 읽어 financials에 basis='잠정실적'으로 넣는다(분기보고서가 오면 그 값으로 대체).
- 연결 기준 종목(dart_fs=CFS)만. 부문 매출(두산 전자BG·삼성전자 DS·삼성전기)은 잠정실적에 없어 data/estimate_reviews.json으로.
- 검증: 같은 표의 '전기실적'이 이미 받은 직전 분기 매출과 0.5% 안에서 맞을 때만 씀 (단위·기준 착오 방지).
- 해석 결과는 data/dart_prelim.json에 캐시(접수번호별) — 문서를 매번 다시 받지 않음.
"""
from __future__ import annotations

import io
import json
import os
import re
import zipfile
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import requests

from etl import dart

STORE = Path(__file__).resolve().parents[1] / "data" / "dart_prelim.json"
UNITS = {"원": 1, "천원": 1e3, "백만원": 1e6, "억원": 1e8}


def _doc_text(rcept_no: str) -> str:
    r = requests.get(f"{dart.BASE}/document.xml", params={"crtfc_key": os.environ["DART_API_KEY"], "rcept_no": rcept_no}, timeout=60)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    raw = " ".join(z.read(n).decode("utf-8", "ignore") for n in z.namelist())
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw))


def _n(s: str) -> float:
    return float(s.replace(",", ""))


def parse(text: str) -> dict | None:
    """'당기실적 YYYY-MM-DD ~ YYYY-MM-DD' · '단위 : 백만원' · '매출액 당해실적 <당기> <전기> …' → {start, end, revenue, prev, op}"""
    per = re.search(r"당기실적\s+(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})", text)
    unit = re.search(r"단위\s*:\s*(백만원|천원|억원|원)", text)
    rev = re.search(r"매출액\s+당해실적\s+(-?[\d,]+)\s+(-?[\d,]+|-)", text)
    if not (per and unit and rev):
        return None
    k = UNITS[unit.group(1)]
    op = re.search(r"영업이익\s+당해실적\s+(-?[\d,]+)", text)
    return {"start": per.group(1), "end": per.group(2), "revenue": _n(rev.group(1)) * k,
            "prev": None if rev.group(2) == "-" else _n(rev.group(2)) * k, "op": _n(op.group(1)) * k if op else None}


def collect(stock_code: str, since: str, store: dict, log=print) -> list[dict]:
    """since(직전 분기 말) 이후 잠정실적 공시 → 해석 결과 목록 (연결 기준 우선)"""
    corp = dart.corp_code(stock_code)
    d = requests.get(f"{dart.BASE}/list.json", params={"crtfc_key": os.environ["DART_API_KEY"], "corp_code": corp, "bgn_de": since.replace("-", ""),
                                                        "end_de": date.today().strftime("%Y%m%d"), "page_count": 100}, timeout=60).json()
    out = []
    for x in d.get("list", []):
        nm = x["report_nm"]
        if "영업(잠정)실적" not in nm or "연결" not in nm:  # 별도 기준 잠정실적은 연결 매출과 다름
            continue
        no = x["rcept_no"]
        if no not in store:
            try:
                store[no] = {"stock": stock_code, "filed": x["rcept_dt"], "name": nm.strip(), **(parse(_doc_text(no)) or {"fail": True})}
            except Exception as e:  # noqa: BLE001
                log(f"  ✗ 잠정실적 {stock_code} {no}: {e}")
                continue
        if not store[no].get("fail"):
            out.append(store[no])
    return sorted(out, key=lambda r: r["filed"])  # 정정 공시가 있으면 나중 것이 이김


def apply(con, log=print) -> int:
    """연결 기준 한국 종목: 분기보고서에 아직 없는 분기를 잠정실적으로 채움 → 반영 건수"""
    store = json.loads(STORE.read_text()) if STORE.exists() else {}
    n = 0
    for ticker, in con.execute("SELECT ticker FROM companies WHERE dart_fs='CFS' AND dart_segment IS NULL ORDER BY ticker").fetchall():
        last = con.execute("SELECT period_end, revenue FROM financials WHERE ticker=? AND coalesce(basis,'')<>'잠정실적' ORDER BY period_end DESC LIMIT 1",
                           (ticker,)).fetchone()
        if not last:
            continue
        since = (pd.Timestamp(last[0]) + timedelta(days=1)).strftime("%Y-%m-%d")
        try:
            rows = collect(ticker.split(".")[0], since, store, log)
        except Exception as e:  # noqa: BLE001
            log(f"  ✗ 잠정실적 {ticker}: {e}")
            continue
        for r in rows:
            if r["end"] <= last[0]:
                continue
            if r["prev"] is None or abs(r["prev"] / last[1] - 1) > 0.005:  # 직전 분기가 우리 값과 안 맞으면 기준이 다른 것 — 안 씀
                log(f"  ✗ 잠정실적 {ticker} {r['end']}: 전기실적 {r['prev'] or 0:,.0f} ≠ 직전 분기 {last[1]:,.0f} — 건너뜀")
                continue
            con.execute("INSERT OR REPLACE INTO financials (ticker, period_end, period_start, revenue, currency, basis) VALUES (?,?,?,?,?,?)",
                        (ticker, r["end"], r["start"], r["revenue"], "KRW", "잠정실적"))
            log(f"  ✓ 매출 {ticker}: {r['end'][:7]} 분기 {r['revenue'] / 1e8:,.0f}억원 — 잠정실적 공시({r['filed']}), 분기보고서 전")
            n += 1
    con.commit()
    STORE.write_text(json.dumps(store, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return n
