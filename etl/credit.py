"""기업별 재무 신용 지표 (장부 기준) — SEC XBRL(미국)·DART(한국) → credit_metrics. 분기 말 기준, 흐름 항목은 최근 4분기 합(TTM).

- 총차입금: 그 분기에 값이 있는 첫 정의 (회사·시기마다 태그가 달라 우선순위로)
    단·장기 합계 태그 → LongTermDebt(유동 포함)+단기차입·CP → 비유동+유동 → 리스 포함 태그 → DebtInstrumentCarryingAmount(코어위브)
  + 금융리스 부채(별도 보고 시). 운용리스는 제외(신용평가사는 포함하기도 함)
- 현금 = 현금성자산 + 단기 투자·유가증권
- 순부채/EBITDA, 이자보상배율 = 영업이익(TTM) ÷ 이자비용(TTM, 없으면 이자 지급액), FCF = 영업현금흐름 − 설비투자
- 1년 내 만기: '12개월 안 상환 원금' 공시 → 없으면 유동성 부채(유동 차입금+CP)
- 현금흐름표는 연초 누적(YTD)이라 분기값 = 누적 차이
한국(DART): 부채총계·자본총계·현금·차입금(IFRS 표준 계정 ID — 없으면 계정명), 영업이익, 이자지급(요약 현금흐름표 누적), 감가상각(XBRL 현금흐름표 조정 — 요약 API엔 없음). 원본 캐시
"""
import json
import re
from datetime import date

import pandas as pd
import requests

from etl import dart, sec

DEBT_DEFS = [["DebtLongtermAndShorttermCombinedAmount"], ["LongTermDebt", "+ShortTermBorrowings", "+CommercialPaper"],
             ["LongTermDebtNoncurrent", "+LongTermDebtCurrent|DebtCurrent", "+ShortTermBorrowings", "+CommercialPaper"],
             ["LongTermNotesAndLoans", "+NotesPayableCurrent|DebtCurrent", "+ShortTermBorrowings", "+CommercialPaper"],  # 오라클 2026-08
             ["LongTermNotesPayable", "+NotesPayableCurrent|DebtCurrent", "+ShortTermBorrowings", "+CommercialPaper"],
             ["LongTermDebtAndCapitalLeaseObligations", "+LongTermDebtAndCapitalLeaseObligationsCurrent|DebtCurrent", "+ShortTermBorrowings", "+CommercialPaper"],
             ["DebtInstrumentCarryingAmount"], ["ConvertibleLongTermNotesPayable", "+ConvertibleNotesPayableCurrent", "+ShortTermBorrowings"],
             ["ConvertibleDebtNoncurrent", "+ConvertibleDebtCurrent", "+ShortTermBorrowings"], ["ConvertibleDebtCurrent", "+ShortTermBorrowings"]]  # 비유동이 사라진 상환 직전(옥타)  # 전환사채만 있는 회사(플루언스 등)
LEASE = ["FinanceLeaseLiabilityNoncurrent", "FinanceLeaseLiabilityCurrent"]
CASH = ["CashAndCashEquivalentsAtCarryingValue", "+ShortTermInvestments", "+MarketableSecuritiesCurrent", "+AvailableForSaleSecuritiesDebtSecuritiesCurrent"]
DUE = ["LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths"]
DUE_ALT = ["LongTermDebtCurrent|DebtCurrent|LongTermDebtAndCapitalLeaseObligationsCurrent", "+ShortTermBorrowings", "+CommercialPaper"]
FLOWS = {"oi": ["OperatingIncomeLoss"], "da": ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization", "Depreciation"],
         "int": ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense", "InterestExpenseOperating"], "int_paid": ["InterestPaidNet"],
         "ocf": ["NetCashProvidedByUsedInOperatingActivities"], "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"]}


def _instant(facts: dict, tag: str) -> dict[str, float]:
    """분기 말 → 값 (같은 날 여러 공시면 최신)"""
    out = {}
    for u in sorted(facts.get(tag, {}).get("units", {}).get("USD", []), key=lambda u: u["filed"]):
        if "start" not in u:
            out[u["end"]] = u["val"]
    return out


def _flow(facts: dict, tag: str) -> dict[str, float]:
    """분기 말 → 3개월 값. 3개월 사실이 없으면 같은 시작일 누적(YTD) 차이로"""
    rows = {}
    for u in sorted(facts.get(tag, {}).get("units", {}).get("USD", []), key=lambda u: u["filed"]):
        if "start" in u:
            rows[(u["start"], u["end"])] = u["val"]
    out = {}
    for (s, e), v in rows.items():
        days = (pd.Timestamp(e) - pd.Timestamp(s)).days
        if 80 <= days <= 100:
            out[e] = v
    for (s, e), v in rows.items():
        if e in out or (pd.Timestamp(e) - pd.Timestamp(s)).days <= 100:
            continue
        prev = [(e2, v2) for (s2, e2), v2 in rows.items() if s2 == s and 80 <= (pd.Timestamp(e) - pd.Timestamp(e2)).days <= 100]
        if prev:
            out[e] = v - prev[0][1]
    return out


def _combo(facts: dict, spec: list[str], end: str) -> float | None:
    """spec: ["A", "B|C", "+D"] → A + (B 또는 C) + (D 있으면). 필수 항목이 없으면 None"""
    total = 0.0
    for part in spec:
        opt = part.startswith("+")
        val = None
        for t in part.lstrip("+").split("|"):
            v = _instant(facts, t).get(end)
            if v is not None:
                val = v
                break
        if val is None and not opt:
            return None
        total += val or 0
    return total


def _near(d: dict[str, float], end: str, days=10) -> float | None:
    e = pd.Timestamp(end)
    hit = [v for k, v in d.items() if abs((pd.Timestamp(k) - e).days) <= days]
    return hit[0] if hit else None


def _ttm(q: dict[str, float], end: str) -> float | None:
    """end까지 최근 4분기 합 (4분기가 1년 안에 다 있어야)"""
    e = pd.Timestamp(end)
    vals = sorted(((pd.Timestamp(k), v) for k, v in q.items() if pd.Timestamp(k) <= e + pd.Timedelta(days=10)), key=lambda x: x[0])[-4:]
    if len(vals) < 4 or (e - vals[0][0]).days > 300:
        return None
    return sum(v for _, v in vals)


def us(ticker: str, sec_t: str) -> list[dict]:
    facts = sec._get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{sec.cik(sec_t)}.json", sec.CACHE / f"{sec_t}.json", False)["facts"]["us-gaap"]
    flows = {}
    for k, tags in FLOWS.items():  # 분기마다 우선순위 첫 태그
        merged: dict[str, float] = {}
        for t in tags:
            for e, v in _flow(facts, t).items():
                if _near(merged, e, 10) is None:
                    merged[e] = v
        flows[k] = merged
    eq = {**_instant(facts, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"), **_instant(facts, "StockholdersEquity")}
    ends = sorted({e for e in eq if e >= "2021-01-01"})
    found = {end: next((v for d in DEBT_DEFS if (v := _combo(facts, d, end)) is not None), None) for end in ends}
    out = []
    for i, end in enumerate(ends):
        debt = found[end]
        if debt is None:
            if any(found[e] for e in ends[max(0, i - 8): i]):
                continue  # 최근 2년에 차입이 있었는데 이 분기만 태그가 없음 — 0으로 보면 오판(오라클 2026-08 사례) → 건너뜀
            debt = 0.0  # 2년 내 차입 태그가 한 번도 없음 = 무차입(아리스타·파브리넷 등)
        if not any("CapitalLease" in t for d in DEBT_DEFS for t in d if _combo(facts, d, end) is not None):
            debt += sum(_instant(facts, t).get(end) or 0 for t in LEASE)
        cash = _combo(facts, CASH, end) or 0.0
        due = _combo(facts, DUE, end)
        if due is None:
            due = _combo(facts, DUE_ALT, end)
        t = {k: _ttm(v, end) for k, v in flows.items()}
        interest, basis = (t["int"], "이자비용") if t["int"] else (t["int_paid"], "이자 지급액")
        ebitda = t["oi"] + t["da"] if t["oi"] is not None and t["da"] is not None else None
        out.append({"ticker": ticker, "q_end": end, "currency": "USD", "debt": debt, "cash": cash, "net_debt": debt - cash, "equity": eq.get(end),
                    "liabilities": _instant(facts, "Liabilities").get(end), "due_1y": due, "ebit_ttm": t["oi"], "ebitda_ttm": ebitda,
                    "interest_ttm": interest, "interest_basis": basis if interest else None, "ocf_ttm": t["ocf"], "capex_ttm": t["capex"],
                    "fcf_ttm": t["ocf"] - t["capex"] if t["ocf"] is not None and t["capex"] is not None else None})
    return out


# ---- 한국 (DART 전체 재무제표, 누적 → 분기) ----
KR_BORROW_IDS = {"ifrs-full_ShorttermBorrowings", "ifrs-full_CurrentPortionOfLongtermBorrowings", "ifrs-full_CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings",
                 "ifrs-full_LongtermBorrowings", "ifrs-full_NoncurrentPortionOfNoncurrentBondsIssued", "ifrs-full_BondsIssued", "dart_BondsIssued",
                 "ifrs-full_LeaseLiabilities", "ifrs-full_CurrentLeaseLiabilities", "ifrs-full_NoncurrentLeaseLiabilities", "dart_ShortTermBorrowings", "dart_LongTermBorrowingsGross"}
KR_BORROW_NM = ("차입금", "사채", "유동성장기부채", "리스부채")


def _kr_raw(corp: str, year: int, reprt: str, fs: str) -> list | None:
    """재무상태표·현금흐름표 원본 행 [(sj_div, account_id, 계정명, 금액)] — 계산 규칙을 바꿔도 다시 받지 않게 원본으로 캐시"""
    path = dart.CACHE / f"{corp}_{year}_{reprt}_{fs}_credit2.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    import os
    d = requests.get(f"{dart.BASE}/fnlttSinglAcntAll.json", params={"crtfc_key": os.environ["DART_API_KEY"], "corp_code": corp, "bsns_year": year,
                     "reprt_code": reprt, "fs_div": fs}, timeout=60).json()
    if d["status"] == "013":
        return None
    if d["status"] != "000":
        raise RuntimeError(d.get("message"))
    num = lambda x: float(x.replace(",", "")) if x and x not in ("-", "") else 0.0  # noqa: E731
    rows = [(x["sj_div"], x["account_id"], x["account_nm"].replace(" ", ""), num(x["thstrm_amount"])) for x in d["list"] if x["sj_div"] in ("BS", "CF")]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return rows


def _kr_report(corp: str, year: int, reprt: str, fs: str) -> dict | None:
    rows = _kr_raw(corp, year, reprt, fs)
    if rows is None:
        return None
    bs = [r for r in rows if r[0] == "BS"]
    cf = [r for r in rows if r[0] == "CF"]
    one = lambda rs, ids, names: next((r[3] for r in rs if r[1] in ids or r[2] in names), None)  # noqa: E731
    by_id = [r for r in bs if r[1] in KR_BORROW_IDS]  # 표준 계정 ID 우선, 없으면 계정명(회사 고유 계정)
    borrow = sum(r[3] for r in by_id) if by_id else sum(r[3] for r in bs if any(k in r[2] for k in KR_BORROW_NM) and "할인" not in r[2] and "이연" not in r[2])
    return {"liab": one(bs, ("ifrs-full_Liabilities",), ("부채총계",)), "equity": one(bs, ("ifrs-full_Equity",), ("자본총계",)),
            "cash": one(bs, ("ifrs-full_CashAndCashEquivalents",), ("현금및현금성자산",)), "borrow": borrow,
            "dep_ytd": sum(r[3] for r in cf if "감가상각" in r[2] or "사용권자산상각" in r[2]),
            "int_paid_ytd": abs(sum(r[3] for r in cf if r[1] in ("ifrs-full_InterestPaidClassifiedAsOperatingActivities", "ifrs-full_InterestPaidClassifiedAsFinancingActivities")
                                    or ("이자" in r[2] and "지급" in r[2]))),
            "ocf_ytd": one(cf, ("ifrs-full_CashFlowsFromUsedInOperatingActivities",), ("영업활동현금흐름", "영업활동으로인한현금흐름")),
            "capex_ytd": abs(sum(r[3] for r in cf if r[1] == "ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities" or r[2] in ("유형자산의취득", "유형자산취득")))}


DEP_TAGS = ("AdjustmentsForDepreciationExpense", "AdjustmentsForAmortisationExpense", "AdjustmentsForDepreciationAndAmortisationExpense")


def _xbrl_dep(rcept: str, reprt: str) -> list | None:
    """정기보고서 XBRL에서 현금흐름표 감가상각·상각 조정(누적) 사실 → [{start, end, members, tag, value}] (요약 API에는 없음). 캐시"""
    import io
    import os
    import xml.etree.ElementTree as ET
    import zipfile
    path = dart.CACHE / "xbrl_dep" / f"{rcept}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    r = requests.get(f"{dart.BASE}/fnlttXbrl.xml", params={"crtfc_key": os.environ["DART_API_KEY"], "rcept_no": rcept, "reprt_code": reprt}, timeout=180)
    try:
        z = zipfile.ZipFile(io.BytesIO(r.content))
    except zipfile.BadZipFile:
        facts = None
    else:
        ns = {"xbrli": "http://www.xbrl.org/2003/instance"}
        root = ET.fromstring(z.read(next(n for n in z.namelist() if n.endswith(".xbrl"))))
        ctx = {}
        for c in root.findall("xbrli:context", ns):
            p = c.find("xbrli:period", ns)
            ctx[c.get("id")] = (p.findtext("xbrli:startDate", None, ns), p.findtext("xbrli:endDate", None, ns),
                                [m.text for m in c.iter("{http://xbrl.org/2006/xbrldi}explicitMember")])
        facts = []
        for el in root:
            tag = next((t for t in DEP_TAGS if el.tag.endswith("}" + t)), None)
            if tag and el.text and el.get("contextRef") in ctx:
                st, en, mem = ctx[el.get("contextRef")]
                if st and not any("Segment" in m for m in mem):
                    facts.append({"start": st, "end": en, "members": mem, "tag": tag, "value": float(el.text)})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(facts), encoding="utf-8")
    return facts


def _dep_ytd(corp: str, fs: str) -> dict[str, float]:
    """분기 말 → 그해 1월부터 누적 감가상각+상각 (XBRL). 연결(CFS)은 별도 member 없는 문맥, 별도(OFS)는 SeparateMember 문맥"""
    from etl import dart_segment
    out = {}
    for (y, mm), rc in dart_segment._filings(corp, 2021).items():
        for f in _xbrl_dep(rc, dart_segment.REPRT[mm]) or []:
            sep = any("Separate" in m for m in f["members"])
            if (fs == "OFS") != sep or not f["start"].endswith("-01-01"):
                continue
            key = f["end"]
            out.setdefault(key, {})
            out[key][f["tag"]] = f["value"]
    return {e: (v.get("AdjustmentsForDepreciationExpense", 0) + v.get("AdjustmentsForAmortisationExpense", 0)) or v.get("AdjustmentsForDepreciationAndAmortisationExpense", 0)
            for e, v in out.items()}


def kr(ticker: str, fs: str) -> list[dict]:
    corp = dart.corp_code(ticker.split(".")[0])
    try:
        xdep = _dep_ytd(corp, fs)
    except Exception:  # noqa: BLE001 — XBRL 실패 시 요약 현금흐름표 값(대개 없음)
        xdep = {}
    oi = dart.quarterly_operating_income(ticker.split(".")[0], fs).set_index("end")["oi"]
    q = {}
    for y in range(2021, date.today().year + 1):
        got = {k: _kr_report(corp, y, r, fs) for r, k in dart.REPORTS}
        for k in (1, 2, 3, 4):
            g = got[k]
            if not g:
                continue
            end = (pd.Timestamp(f"{y}-{3 * k - 2:02d}-01") + pd.offsets.QuarterEnd(0)).strftime("%Y-%m-%d")
            if xdep.get(end):
                g = {**g, "dep_ytd": xdep[end]}
            if prev_end := (pd.Timestamp(end) - pd.offsets.QuarterEnd(1)).strftime("%Y-%m-%d") if k > 1 else None:
                if got.get(k - 1) and xdep.get(prev_end):
                    got[k - 1] = {**got[k - 1], "dep_ytd": xdep[prev_end]}
            prev = got.get(k - 1) if k > 1 else None
            if k > 1 and not prev:
                continue
            dif = lambda f: (g[f] or 0) - ((prev[f] or 0) if prev else 0)  # noqa: E731 — 누적 → 분기
            q[end] = {**g, "dep": dif("dep_ytd"), "int_paid": dif("int_paid_ytd"), "ocf": dif("ocf_ytd") if g["ocf_ytd"] is not None else None, "capex": dif("capex_ytd")}
    out = []
    for end, g in sorted(q.items()):
        ser = lambda f: {e: v[f] for e, v in q.items() if v.get(f) is not None}  # noqa: E731
        o = _ttm({e.strftime("%Y-%m-%d"): v for e, v in oi.items()}, end)
        dep, ip, ocf, capex = _ttm(ser("dep"), end), _ttm(ser("int_paid"), end), _ttm(ser("ocf"), end), _ttm(ser("capex"), end)
        out.append({"ticker": ticker, "q_end": end, "currency": "KRW", "debt": g["borrow"], "cash": g["cash"] or 0, "net_debt": g["borrow"] - (g["cash"] or 0),
                    "equity": g["equity"], "liabilities": g["liab"], "due_1y": None, "ebit_ttm": o,
                    "ebitda_ttm": o + dep if o is not None and dep else None,  # 감가상각이 요약 현금흐름표에 없으면 None → 화면은 영업이익 기준
                    "interest_ttm": ip or None, "interest_basis": "이자 지급액" if ip else None, "ocf_ttm": ocf, "capex_ttm": capex,
                    "fcf_ttm": ocf - capex if ocf is not None and capex is not None else None})
    return out


def _num_after(txt: str, label: str, idx: int = 1) -> float | None:
    """보도자료 표에서 label 다음 숫자들 중 idx번째 (괄호 = 음수, — = 0). 분기 표는 [전년 동기, 당분기, ...], 재무상태표는 [전기말, 당분기말]"""
    m = re.search(re.escape(label) + r"((?:\s+(?:\(?[\d,]+\.?\d*(?:\s*\))?|—))+)", txt)
    if not m:
        return None
    vals = re.findall(r"(\()?([\d,]+\.?\d*|—)\s*(\))?", m.group(1))
    out = [0.0 if v == "—" else (-1 if p else 1) * float(v.replace(",", "")) for p, v, _ in vals]
    return out[idx] if len(out) > idx else None


def first(g, labels: list[str]) -> float | None:
    """표 라벨이 분기마다 조금씩 달라(예: 'Net cash used in …') 후보를 차례로"""
    return next((v for lab in labels if (v := g(lab)) is not None), None)


def nbis(ticker: str, sec_t: str) -> list[dict]:
    """6-K 분기 실적 보도자료(첨부 99.1) 표에서 — 20-F 외국 발행사라 SEC XBRL엔 연간만 있음. 백만 달러"""
    import html
    import requests

    from etl import sec6k
    from etl.sec import UA
    f = sec6k.FILERS[sec_t]
    res = json.loads(sec6k.RESULTS.read_text()) if sec6k.RESULTS.exists() else {}
    q: dict[str, dict] = {}
    for acc, v in res.items():
        if not v or not v[0] or v[0] < f.get("since", "2000"):
            continue
        base = f"https://www.sec.gov/Archives/edgar/data/{f['cik']}/{acc.replace('-', '')}"
        try:
            items = json.loads(sec6k._get(f"{base}/index.json"))["directory"]["item"]
        except Exception:  # noqa: BLE001
            items = requests.get(f"{base}/index.json", headers=UA, timeout=60).json()["directory"]["item"]
        for name in sorted(i["name"] for i in items if i["name"].endswith(".htm") and "index" not in i["name"]):
            t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", sec6k._get(f"{base}/{name}"))))
            if "balance sheet" not in t.lower() or "Cash and cash equivalents" not in t:
                continue
            g = lambda label, i=1: _num_after(t, label, i)  # noqa: E731
            debt = sum(x for x in (g("Debt, current"), g("Debt, non-current")) if x) or (g("Convertible notes") or 0.0)
            oi = g("Loss from operations") if g("Loss from operations") is not None else g("Income / (loss) from operations")
            q[v[0]] = {"cash": g("Cash and cash equivalents"), "debt": debt, "equity": g("Total shareholders’ equity"), "liab": g("Total liabilities"),
                       "oi": oi, "dep": g("Depreciation and amortization"), "int": abs(g("Interest expense") or 0.0),
                       "ocf": first(g, ["Net cash provided by / (used in) operating activities – continuing operations", "Net cash used in operating activities – continuing operations",
                                        "Net cash provided by operating activities – continuing operations", "Net cash provided by / (used in) operating activities"]),
                       "capex": abs(c) if (c := first(g, ["Purchases of property and equipment and intangible assets", "Purchases of property, plant and equipment"])) is not None else None}
            break
    ends = sorted(q)
    out = []
    for i, end in enumerate(ends):
        x = q[end]
        last4 = [q[e] for e in ends[max(0, i - 3): i + 1]]
        ttm = (lambda k: sum(y[k] for y in last4) * 1e6 if len(last4) == 4 and all(y[k] is not None for y in last4) else None)
        o, dep, it, ocf, capex = ttm("oi"), ttm("dep"), ttm("int"), ttm("ocf"), ttm("capex")
        if x["cash"] is None:
            continue
        debt, cash = x["debt"] * 1e6, x["cash"] * 1e6
        out.append({"ticker": ticker, "q_end": end, "currency": "USD", "debt": debt, "cash": cash, "net_debt": debt - cash,
                    "equity": x["equity"] * 1e6 if x["equity"] is not None else None, "liabilities": x["liab"] * 1e6 if x["liab"] is not None else None,
                    "due_1y": None, "ebit_ttm": o, "ebitda_ttm": o + dep if o is not None and dep is not None else None,
                    "interest_ttm": it or None, "interest_basis": "이자비용" if it else None, "ocf_ttm": ocf, "capex_ttm": capex,
                    "fcf_ttm": ocf - capex if ocf is not None and capex is not None else None})
    return out


COLS = ["ticker", "q_end", "currency", "debt", "cash", "net_debt", "equity", "liabilities", "due_1y", "ebit_ttm", "ebitda_ttm", "interest_ttm", "interest_basis", "ocf_ttm", "capex_ttm", "fcf_ttm"]


def _prefetch_kr(con, log) -> None:
    """한국 종목 DART 원본(요약 재무제표·XBRL 감가상각)을 4개씩 동시에 미리 받아 캐시 — 첫 실행이 순차면 1시간 넘게 걸림"""
    from concurrent.futures import ThreadPoolExecutor

    from etl import dart_segment
    jobs = []
    for t, fs in con.execute("SELECT ticker, dart_fs FROM companies WHERE dart_fs IS NOT NULL").fetchall():
        corp = dart.corp_code(t.split(".")[0])
        jobs += [(_kr_raw, (corp, y, r, fs)) for y in range(2021, date.today().year + 1) for r, _ in dart.REPORTS]
        jobs += [(_xbrl_dep, (rc, dart_segment.REPRT[mm])) for (y, mm), rc in dart_segment._filings(corp, 2021).items()]

    def go(j):
        try:
            j[0](*j[1])
        except Exception as e:  # noqa: BLE001
            return str(e)[:60]
    with ThreadPoolExecutor(4) as ex:
        errs = [e for e in ex.map(go, jobs) if e]
    if errs:
        log(f"  · 한국 신용 원본 받기 실패 {len(errs)}건 (예: {errs[0]})")


def collect(con, log=print) -> int:
    from etl import sec6k
    _prefetch_kr(con, log)
    rows = []
    for ticker, sec_t, dart_fs in con.execute("SELECT ticker, sec_ticker, dart_fs FROM companies ORDER BY sort").fetchall():
        try:
            if dart_fs:
                got = kr(ticker, dart_fs)
            elif sec_t and sec_t not in sec6k.FILERS:
                got = us(ticker, sec_t)
            elif sec_t == "NBIS":  # 20-F 외국 발행사 — 분기 실적 보도자료 표에서
                got = nbis(ticker, sec_t)
            else:
                continue  # ASML(IFRS 6-K)은 아직
        except Exception as e:  # noqa: BLE001
            log(f"  ✗ 신용 {ticker}: {e}")
            continue
        rows += got
    con.execute("DELETE FROM credit_metrics")
    con.executemany(f"INSERT INTO credit_metrics ({', '.join(COLS)}) VALUES ({','.join('?' * len(COLS))})", [tuple(r[c] for c in COLS) for r in rows])
    con.commit()
    log(f"  ✓ 신용 지표 {len({r['ticker'] for r in rows})}종목 {len(rows)}분기")
    return len(rows)
