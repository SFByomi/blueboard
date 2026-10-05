"""DART XBRL에서 사업부문(Operating Segment) 매출 추출 → 분기 매출.

정기공시(분기·반기·사업보고서) XBRL의 ifrs-full:Revenue 중 영업부문 차원(member)이 붙은 값을 모은다.
공시 값은 대부분 누적(1월~)이라 분기 = 누적 차이. 3개월 값이 있으면 그대로 사용.
"""
import io
import json
import os
import re
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from pathlib import Path

import pandas as pd
import requests

from etl.dart import BASE, CACHE, corp_code

NS = {"xbrli": "http://www.xbrl.org/2003/instance"}
DIM = "{http://xbrl.org/2006/xbrldi}explicitMember"
REPRT = {"03": "11013", "06": "11012", "09": "11014", "12": "11011"}


def _filings(corp: str, start_year: int) -> dict:
    """{(연도, 월): rcept_no} — 같은 기간 정정공시는 최신 접수번호 사용."""
    out = {}
    for y in range(start_year, date.today().year + 2):
        path = CACHE / "list" / f"{corp}_{y}.json"
        if path.exists() and y < date.today().year:
            items = json.loads(path.read_text(encoding="utf-8"))
        else:
            r = requests.get(f"{BASE}/list.json", params={"crtfc_key": os.environ["DART_API_KEY"], "corp_code": corp,
                             "bgn_de": f"{y}0101", "end_de": f"{y}1231", "pblntf_ty": "A", "page_count": 100}, timeout=60).json()
            items = r.get("list", [])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        for it in items:
            m = re.search(r"(분기|반기|사업)보고서 \((\d{4})\.(\d{2})\)", it["report_nm"])
            if m:
                key = (int(m.group(2)), m.group(3))
                out[key] = max(out.get(key, ""), it["rcept_no"])
    return out


def _facts(rcept: str, reprt: str):
    path = CACHE / "xbrl" / f"{rcept}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    r = requests.get(f"{BASE}/fnlttXbrl.xml", params={"crtfc_key": os.environ["DART_API_KEY"], "rcept_no": rcept, "reprt_code": reprt}, timeout=120)
    facts = []
    try:
        z = zipfile.ZipFile(io.BytesIO(r.content))
    except zipfile.BadZipFile:  # XBRL 없는 공시
        facts = None
    else:
        name = next(n for n in z.namelist() if n.endswith(".xbrl"))
        root = ET.fromstring(z.read(name))
        ctx = {}
        for c in root.findall("xbrli:context", NS):
            p = c.find("xbrli:period", NS)
            ctx[c.get("id")] = (p.findtext("xbrli:startDate", None, NS), p.findtext("xbrli:endDate", None, NS),
                                [m.text for m in c.iter(DIM)])
        for el in root:
            if el.tag.endswith("}Revenue") and el.text and el.get("contextRef") in ctx:
                s, e, members = ctx[el.get("contextRef")]
                if s and any("Segment" in m for m in members):
                    facts.append({"start": s, "end": e, "members": members, "value": float(el.text)})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(facts, ensure_ascii=False), encoding="utf-8")
    return facts


def members(stock_code: str, year: int | None = None) -> set[str]:
    """부문 member 이름 목록 (매핑 키워드 정할 때 확인용)."""
    corp = corp_code(stock_code)
    fl = _filings(corp, year or date.today().year - 1)
    out = set()
    for (y, mm), rc in fl.items():
        for f in _facts(rc, REPRT[mm]) or []:
            out.update(m for m in f["members"] if "Segment" in m)
    return out


def quarterly_segment_revenue(stock_code: str, keyword: str, scope: str = "Consolidated", start_year=2020) -> pd.DataFrame:
    """keyword가 들어간 부문 member, scope = Consolidated | Separate. 반환 [start, end, revenue]."""
    corp = corp_code(stock_code)
    vals = {}  # (start, end) -> value
    for (y, mm), rc in sorted(_filings(corp, start_year).items()):
        for f in _facts(rc, REPRT[mm]) or []:
            ms = f["members"]
            if any(x in m for m in ms for x in ("Elimination", "Adjustment", "Reconcil", "Intersegment")):
                continue  # 내부거래 제거·조정 항목
            seg = [m for m in ms if "OperatingSegment" in m or "ReportableSegment" in m]  # 영업부문 표만 (수익 분해 표 제외)
            if any(keyword in m for m in seg) and \
                    (any(f"{scope}Member" in m for m in ms) or (scope == "Consolidated" and not any("Separate" in m for m in ms))):
                vals.setdefault((f["start"], f["end"]), f["value"])
    rows = []
    for (s, e), v in vals.items():
        s, e = pd.Timestamp(s), pd.Timestamp(e)
        if e.year < start_year:
            continue
        q_start = pd.Timestamp(e.year, e.month - 2, 1)
        if s == q_start:                       # 3개월 값
            rows.append((q_start, e, v))
        elif s.month == 1 and e.month > 3:     # 누적 → 직전 누적과 차이
            prev_end = q_start - pd.Timedelta(days=1)
            prev = vals.get((s.strftime("%Y-%m-%d"), prev_end.strftime("%Y-%m-%d")))
            if prev is not None:
                rows.append((q_start, e, v - prev))
    df = pd.DataFrame(rows, columns=["start", "end", "revenue"]).drop_duplicates(["end"]).sort_values("end")
    return df.reset_index(drop=True)
