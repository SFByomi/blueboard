"""회사 매출 가이던스 — 실적 발표 보도자료(8-K Item 2.02 첨부 99.1, 외국 기업 6-K)에서 '다음 분기 매출 전망'을 읽는다.

컨센서스는 대부분 이 가이던스에 맞춰지고, 회사는 보통 가이던스 범위 안팎으로 실적을 낸다 → 진행 분기 추정의 가장 강한 공개 근거.
- 범위형: "revenue ... in the range of / between $X and $Y", "$X to $Y", "$X – Y billion"
- ±형:   "Revenue $61.5 billion ± $1.5 billion" (마이크론)
- 근사:  "revenue of approximately $3.3 billion"
- 표:    "Revenue $ 49.0 – $ 51.0" (단위 없음 → 직전 분기 매출과 가장 가까운 단위로)
분기 가이던스만 쓴다(연간 가이던스 제외). 대상 분기 = 보도자료가 발표한 분기의 다음 분기.
추출 결과는 data/guidance.json(git)에 공시번호별로 저장 — 지난 공시는 다시 받지 않는다.
"""
import html
import json
import re
import time
from pathlib import Path

import requests

from etl.sec import UA, cik

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "data" / "guidance.json"
TEXT = ROOT / "data" / "raw" / "guidance"  # 보도자료 본문 캐시(git 제외) — 파서를 고치면 다시 받지 않고 재해석
VERSION = 7  # 파서 버전: 저장된 결과가 이보다 낮으면 본문으로 다시 해석
SINCE = "2021-06-01"
NUM = r"[$€]\s?([\d,]+(?:\.\d+)?)\s*(billion|million|B|M)?"  # ASML은 유로
SEP = r"\s*(?:to|and|-|–|—)\s*[$€]?\s?([\d,]+(?:\.\d+)?)\s*(billion|million|B|M)?"
REV = r"(?:total\s+|net\s+|gaap\s+)?(?:revenues?|net\s+sales|sales)"
QWORD = r"(?:first|second|third|fourth|1st|2nd|3rd|4th)[\s-]+(?:fiscal\s+)?quarter|\bQ[1-4]\b|\bF?Q[1-4][\s-]?(?:FY)?\d{2}|quarter\s+ending|fiscal\s+Q[1-4]|[1-4]Q\s?\d{2}"
YEARLY = r"full[\s-]+(?:fiscal[\s-]+)?year|fiscal\s+(?:year\s+)?20\d\d\s+(?:revenue|guidance|outlook)|annual|for\s+(?:fiscal\s+)?(?:year\s+)?20\d\d\b(?!\s*(?:first|second|third|fourth))|\b20\d\d\s+(?:total\s+)?(?:net\s+sales|revenue)"
UNIT = {"billion": 1e9, "b": 1e9, "million": 1e6, "m": 1e6}


def _get(url: str) -> requests.Response:
    for i in range(4):
        try:
            r = requests.get(url, headers=UA, timeout=60)
            r.raise_for_status()
            time.sleep(0.12)  # SEC 초당 10회 제한
            return r
        except Exception:  # noqa: BLE001
            if i == 3:
                raise
            time.sleep(2 ** i)
    raise RuntimeError(url)


def _num(v: str, unit: str | None) -> tuple[float, float | None]:
    return float(v.replace(",", "")), UNIT.get((unit or "").lower())


def parse(text: str) -> list[dict]:
    """보도자료 본문 → 분기 매출 가이던스 후보 [{low, high, unit, ctx}] (단위 없으면 unit=None)"""
    out = []
    for a in re.finditer(r"(?i)outlook|guidance|expects?|expected|anticipates?|forecast", text):
        win = text[a.start(): a.start() + 700]
        for m in re.finditer(rf"(?i){REV}\b[^$€%]{{0,160}}?{NUM}(?:{SEP}|\s*(?:±|\+/-|plus or minus)\s*[$€]?\s?([\d,]+(?:\.\d+)?)\s*(billion|million|B|M)?)?", win):
            pos = a.start() + m.start()
            pre = text[max(0, pos - 500): pos + 1] + m.group(0)[:200]
            post = text[a.start() + m.end(): a.start() + m.end() + 120]
            if re.search(r"(?i)\b(was|were|grew|increased|decreased|reached|totaled|record)\b", m.group(0)):
                continue  # 실적 문장
            if re.search(r"(?i)(record|reported|delivered|achieved|generated)\s*(?:quarterly\s+|total\s+)?$", text[max(0, pos - 30): pos]):
                continue  # "Record revenue of $47.0 billion" — 실적
            if re.search(r"(?i)(recurring|deferred|remaining performance|backlog)\s*$", text[max(0, pos - 30): pos]):
                continue  # ARR·이연 매출 등은 매출이 아님
            q = [x.end() for x in re.finditer(rf"(?i){QWORD}", pre)]
            y = [x.end() for x in re.finditer(rf"(?i){YEARLY}", pre)]
            if not q and re.match(rf"(?i)\s*,?\s*for\s+the\s+(?:{QWORD})", post):  # "...net sales of $X to $Y for the first quarter of ..."
                q, y = [len(pre)], [v for v in y if v < len(pre) - len(m.group(0))]
            # 표 머리글 "Q3 FY27 Guidance  Full Year FY27 Guidance  Revenue $X - $Y  $A - $B" → 첫 범위가 분기
            header = q and y and 0 <= max(y) - max(q) < 60
            if not q or (y and max(y) > max(q) and not header):
                continue  # 분기 가이던스가 아님(연간)
            lo, ul = _num(m.group(1), m.group(2))
            if m.group(3):  # 범위
                hi, uh = _num(m.group(3), m.group(4))
                ul = ul or uh
                uh = uh or ul
                lo_v, hi_v = lo, hi
            elif m.group(5):  # ±
                d, ud = _num(m.group(5), m.group(6))
                ud = ud or ul
                lo_v, hi_v, uh = lo - d * (ud or 1) / (ul or 1), lo + d * (ud or 1) / (ul or 1), ul
            else:
                table = re.search(r"(?i)guidance|outlook", pre[-160:]) and re.match(rf"(?i){REV}\s*[$€]", m.group(0))  # 표 칸: "Revenue $ 49.0"
                if not (re.search(r"(?i)approximately|about|around", m.group(0)) or table):
                    continue  # 단일 값은 '약'이거나 가이던스 표 안일 때만 (델: "Third-Quarter Guidance ... Revenue $ 49.0")
                lo_v = hi_v = lo
                uh = ul
            out.append({"low": lo_v, "high": hi_v, "unit_low": ul, "unit_high": uh, "ctx": re.sub(r"\s+", " ", m.group(0))[:220]})
        if out:
            break  # 첫 번째 가이던스 블록만
    return out


def parse_annual(text: str) -> list[dict]:
    """연간 매출 가이던스 → [{low, high, unit_low, unit_high, ctx}] 또는 성장률 [{g_low, g_high, ctx}] (AAON: "Sales Growth 55%-60%")"""
    out = []
    for m in re.finditer(rf"(?i){REV}\b[^$€%]{{0,80}}?{NUM}{SEP}", text):
        pos = m.start()
        pre = text[max(0, pos - 220): pos]
        if not re.search(rf"(?i){YEARLY}", pre) or not re.search(r"(?i)guidance|outlook|expects?|expected", pre + m.group(0)):
            continue
        if re.search(r"(?i)(recurring|deferred|remaining performance|backlog)\s*$", pre[-30:]) or re.search(r"\b[A-Z]{4,}[®™]?\s*$", pre[-20:]):
            continue  # ARR·특정 제품(BRINSUPRI 등) 가이던스는 회사 매출이 아님
        q = [x.end() for x in re.finditer(rf"(?i){QWORD}", pre)]
        y = [x.end() for x in re.finditer(rf"(?i){YEARLY}", pre)]
        if q and max(q) > max(y):
            continue  # 분기 가이던스
        if re.search(r"\b[A-Z]{5,}\b", m.group(0)) or re.search(r"\b[A-Z]{5,}[®™]?\s*$", pre[-25:]):
            continue  # 제품 브랜드(ARIKAYCE 등) 매출 가이던스
        if re.search(r"(?i)\bby\s+[$€]", m.group(0)):
            continue  # "raising ... outlook by $25 billion to $192 billion" — 상향 폭
        lo, ul = _num(m.group(1), m.group(2))
        hi, uh = _num(m.group(3), m.group(4))
        out.append({"low": lo, "high": hi, "unit_low": ul or uh, "unit_high": uh or ul, "ctx": re.sub(r"\s+", " ", m.group(0))[:200]})
    for m in re.finditer(r"(?i)(?:net\s+)?sales\s+growth\s+(?:of\s+)?(-?\d+(?:\.\d+)?)%\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)%", text):
        if re.search(rf"(?i){YEARLY}|FY\d\d", text[max(0, m.start() - 300): m.start()]):
            out.append({"g_low": float(m.group(1)) / 100, "g_high": float(m.group(2)) / 100, "ctx": m.group(0)[:120]})
    return out[:3]


def parse_actual(text: str) -> dict | None:
    """보도자료 첫머리의 발표 분기 매출 실적 ("Revenue was $X", "revenue of $X") → {value, unit, ctx}.
    연간·반기 합계나 부문 매출이 먼저 나오는 회사도 있어, 회사별 과거 일치율(actual_trust)로 쓸지 정한다."""
    head = text[:4000]
    for m in re.finditer(rf"(?i){REV}\b(?:\s+for\s+the\s+(?:fiscal\s+)?(?:first|second|third|fourth)\s+(?:fiscal\s+)?quarter(?:\s+of\s+(?:fiscal\s+)?(?:year\s+)?20\d\d)?)?"
                         r"\s*(?:was|were|of|totaled|reached|grew\s+\d+%\s+to|increased\s+\d+%\s+to|:)\s*(?:a\s+record\s+)?[$€]\s?([\d,]+(?:\.\d+)?)\s*(billion|million|B|M)?", head):
        pre = head[max(0, m.start() - 150): m.start()]
        if re.search(r"(?i)expect|guidance|outlook|full[\s-]+year|fiscal\s+year\s+20\d\d\s+revenue|annual|six months|nine months|twelve months", pre[-80:] + m.group(0)):
            continue
        v, u = _num(m.group(1), m.group(2))
        return {"value": v, "unit": u, "ctx": re.sub(r"\s+", " ", m.group(0))[:120]}
    return None


def scale(g: dict, ref: float) -> tuple[float, float]:
    """단위 확정: 명시 단위 우선, 없으면 직전 분기 매출(ref)과 로그 거리가 가장 가까운 단위"""
    def pick(v, u):
        if u:
            return v * u
        import math
        return min((v * k for k in (1, 1e3, 1e6, 1e9)), key=lambda x: abs(math.log(max(x, 1) / ref)))
    return pick(g["low"], g["unit_low"]), pick(g["high"], g["unit_high"])


def _exhibit(c: int, acc: str) -> str | None:
    base = f"https://www.sec.gov/Archives/edgar/data/{c}/{acc.replace('-', '')}"
    items = _get(f"{base}/index.json").json()["directory"]["item"]
    htm = [(i["name"], int(i.get("size") or 0)) for i in items if i["name"].endswith(".htm") and not re.match(r"(?i)R\d+\.htm|.*index", i["name"])]
    rank = lambda n: 0 if re.search(r"(?i)ex(?:hibit)?[-_]?99[-_.]?0?1(?!\d)|991|pressrelease|press", n) else 1 if re.search(r"(?i)99", n) else 2  # noqa: E731
    if not htm:
        return None
    name = min(htm, key=lambda x: (rank(x[0]), -x[1]))[0]  # 첨부 99.1(보도자료) → 없으면 가장 큰 문서
    raw = _get(f"{base}/{name}").text
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw)))


def _text(c: int, acc: str) -> str | None:
    path = TEXT / f"{acc}.txt"
    if path.exists():
        return path.read_text()
    txt = _exhibit(c, acc)
    if txt:
        TEXT.mkdir(parents=True, exist_ok=True)
        path.write_text(txt)
    return txt


def collect(tickers: list[str], log=print) -> dict:
    """새 실적 보도자료만 받아 가이던스 후보를 저장. 반환: {acc: {ticker, filed, cands}}"""
    store = json.loads(STORE.read_text()) if STORE.exists() else {}
    for t in tickers:
        try:
            c = cik(t)
            js = _get(f"https://data.sec.gov/submissions/CIK{c}.json").json()
            sub, fye = js["filings"]["recent"], js.get("fiscalYearEnd")  # 회계연도 말 "1231"·"0930" 등
        except Exception as e:  # noqa: BLE001
            log(f"  ✗ 가이던스 {t}: {e}")
            continue
        new = 0
        for form, filed, acc, items, doc in zip(sub["form"], sub["filingDate"], sub["accessionNumber"], sub["items"], sub["primaryDocument"]):
            if store.get(acc, {}).get("v") == VERSION or filed < SINCE or not ((form == "8-K" and "2.02" in items) or form == "6-K"):
                continue
            if form == "6-K" and (t not in SIX_K or int(filed[5:7]) not in (1, 2, 4, 5, 7, 8, 10, 11)
                                  or (t == "ASML" and "quarterly" not in doc)):  # 6-K는 실적 발표 달만 (ASML은 자사주 매입 6-K가 매주 나옴)
                continue
            try:
                txt = _text(int(c), acc)
            except Exception as e:  # noqa: BLE001
                log(f"  ✗ 가이던스 {t} {acc}: {e}")
                continue
            if form == "6-K" and not (txt and re.search(SIX_K[t], txt[:3000], re.I)):
                store[acc] = {"ticker": t, "filed": filed, "cands": [], "skip": True, "v": VERSION}
                continue
            prelim = bool(txt and re.search(r"(?i)preliminary\s+(?:unaudited\s+)?(?:financial\s+)?(?:results|net sales|revenue)|announces\s+preliminary", txt[:2500]))
            store[acc] = {"ticker": t, "filed": filed, "cands": parse(txt) if txt else [], "annual": parse_annual(txt) if txt else [],
                          "actual": parse_actual(txt) if txt else None,
                          "fye": fye, **({"prelim": True} if prelim else {}), "v": VERSION}
            new += 1
        if new:
            log(f"  ✓ 가이던스 {t}: 새 보도자료 {new}건")
            _save(store)  # 종목마다 저장 — 중간에 끊겨도 다음 실행은 이어서
    _save(store)
    return store


def _save(store: dict) -> None:
    STORE.write_text(json.dumps(dict(sorted(store.items(), key=lambda kv: (kv[1]["ticker"], kv[1]["filed"]))), ensure_ascii=False, indent=0) + "\n")


SIX_K = {"ASML": r"ASML reports", "NBIS": r"quarter.{0,40}results"}  # 6-K 중 실적 보도자료만


def resolve(store: dict, ticker: str, fin_ends: list[str], ref_rev: dict[str, float]) -> list[dict]:
    """공시별 가이던스 → 대상 분기. fin_ends: 이 종목 분기 말일(오름차순, 이미 공시된 분기), ref_rev: 분기 말일 → 매출.
    보도자료가 발표한 분기 R = 공시일 이전 마지막 분기 말(공시 전이면 직전 분기 + 3개월로 추정),
    대상 = R 다음 분기. 단 '잠정(preliminary)' 발표는 R 자체에 대한 숫자라 대상 = R.
    반환 [{filed, target_end(YYYY-MM-DD, 대략), low, high, prelim}] — 같은 대상 분기는 마지막 공시가 우선"""
    import pandas as pd
    out = {}
    ends = [pd.Timestamp(e) for e in fin_ends]
    for acc, g in store.items():
        if g["ticker"] != ticker or not g.get("cands") or not ends:
            continue
        filed = pd.Timestamp(g["filed"])
        rs = [e for e in ends if e < filed]
        if not rs:
            continue
        r = rs[-1]
        while r + pd.DateOffset(months=3) + pd.Timedelta(days=5) < filed:  # 아직 매출이 수집 안 된 분기
            r = r + pd.DateOffset(months=3)
        prelim = bool(g.get("prelim"))
        target = r if prelim else r + pd.DateOffset(months=3)
        ref = ref_rev.get(rs[-1].strftime("%Y-%m-%d"))
        if not ref:
            continue
        ok = [v for v in (scale(c, ref) for c in g["cands"]) if 0.5 < (v[0] + v[1]) / 2 / ref < 2.5]  # 단위·연간·문장 오인 제외
        if not ok:
            continue
        lo, hi = ok[0]
        key = target.strftime("%Y-%m")
        out[key] = {"filed": g["filed"], "target_end": target.strftime("%Y-%m-%d"), "low": lo, "high": hi, "prelim": prelim, "acc": acc}
    return sorted(out.values(), key=lambda x: x["target_end"])


def implied(store: dict, ticker: str, ends: list, revs: list, t_end) -> list[dict]:
    """연간 가이던스 → 분기 환산 가이던스 (분기 가이던스가 없는 회사용, guide_model이 그대로 씀).
    분기 k의 값 = (연간 가이던스 − 그 회계연도에 이미 발표된 분기 실적) × 작년 같은 분기들 중 k의 비중.
    가이던스는 분기 k가 끝나기 전(+10일)까지 나온 것 중 가장 최근 — 그 분기 실적을 보고 낸 숫자는 쓰지 않음.
    ends/revs: 실적 분기 말·매출(오름차순), t_end: 진행 분기 말."""
    import pandas as pd
    ann = sorted(((pd.Timestamp(g["filed"]), g) for g in store.values() if g.get("ticker") == ticker and g.get("annual")), key=lambda x: x[0])
    if not ann or not ends:
        return []
    fye = ann[-1][1].get("fye") or "1231"
    fy_m = int(fye[:2])
    rev = dict(zip([pd.Timestamp(e) for e in ends], revs))
    keys = sorted(rev)
    near = lambda d: next((k for k in keys if abs((k - d).days) <= 20), None)  # noqa: E731

    def fy_end(d):  # d가 속한 회계연도 말(달 기준)
        y = d.year if d.month <= fy_m else d.year + 1
        return pd.Timestamp(y, fy_m, 1) + pd.offsets.MonthEnd(0)

    out = []
    for q in [*keys, pd.Timestamp(t_end)]:
        fe = fy_end(q - pd.Timedelta(days=10))
        qs = [fe - pd.DateOffset(months=3 * i) for i in (3, 2, 1, 0)]  # 회계연도 4개 분기 말(근사)
        cand = [(f, g) for f, g in ann if f <= q + pd.Timedelta(days=10) and f > fe - pd.DateOffset(months=12)]
        if not cand:
            continue
        filed, g = cand[-1]
        done = [near(x) for x in qs if x < q - pd.Timedelta(days=20)]
        if any(d is None for d in done):
            continue
        rest = [x for x in qs if x >= q - pd.Timedelta(days=20)]
        ly = [near(x - pd.DateOffset(years=1)) for x in rest]
        if any(d is None for d in ly):
            continue
        a = g["annual"][0]
        if "g_low" in a:  # 성장률 가이던스 → 작년 연간 × (1+g)
            prev = [near(x - pd.DateOffset(years=1)) for x in qs]
            if any(d is None for d in prev):
                continue
            base = sum(rev[d] for d in prev)
            fy_lo, fy_hi = base * (1 + a["g_low"]), base * (1 + a["g_high"])
        else:
            fy_lo, fy_hi = scale(a, sum(rev[d] for d in ly) * 4 / max(len(ly), 1))
        got = sum(rev[d] for d in done)
        w = rev[ly[0]] / sum(rev[d] for d in ly)
        lo, hi = (fy_lo - got) * w, (fy_hi - got) * w
        if lo <= 0:
            continue
        out.append({"filed": filed.strftime("%Y-%m-%d"), "target_end": q.strftime("%Y-%m-%d"), "low": lo, "high": hi, "prelim": False,
                    "annual": {"low": fy_lo, "high": fy_hi, "done": got, "left": len(rest)}})
    return out


ACTUAL_TRUST, ACTUAL_MIN = 0.9, 6  # 보도자료 실적을 쓰려면 과거 SEC 수치와 ±0.5% 일치율 90% 이상(6건 이상)


def actuals(store: dict, ticker: str, ends: list[str], revs: list[float]) -> tuple[float | None, list[dict]]:
    """보도자료 실적 → (과거 일치율, SEC 공시 전 분기 실적 [{start, end, revenue, filed}]).
    10-Q·10-K XBRL은 발표 몇 주 뒤에 나오므로 그 사이 실적을 보도자료로 먼저 반영 — 일치율이 낮은 회사는 쓰지 않음."""
    import pandas as pd
    if not ends:
        return None, []
    keys = [pd.Timestamp(e) for e in ends]
    rev = dict(zip(keys, revs))
    ok = n = 0
    new = []
    for acc, g in sorted(store.items(), key=lambda kv: kv[1].get("filed", "")):
        if g.get("ticker") != ticker or not g.get("actual") or g.get("skip"):
            continue
        filed = pd.Timestamp(g["filed"])
        rs = [e for e in keys if e < filed]
        if not rs:
            continue
        a = g["actual"]
        if (filed - rs[-1]).days <= 100:  # 이미 공시된 분기 → 일치율 집계
            ref = rev[rs[-1]]
            v = a["value"] * a["unit"] if a["unit"] else min((a["value"] * k for k in (1, 1e3, 1e6, 1e9)), key=lambda x: abs(x / ref - 1))
            n += 1
            ok += abs(v / ref - 1) < 0.005
        else:  # 공시 전 분기: 직전 분기 + 3개월
            end = rs[-1] + pd.DateOffset(months=3)
            if (filed - end).days > 100 or (filed - end).days < 5:
                continue
            ref = rev[rs[-1]]
            v = a["value"] * a["unit"] if a["unit"] else min((a["value"] * k for k in (1, 1e3, 1e6, 1e9)), key=lambda x: abs(x / ref - 1))
            new.append({"start": rs[-1] + pd.Timedelta(days=1), "end": end, "revenue": v, "filed": g["filed"], "ref": ref})
    trust = ok / n if n else None
    if trust is None or n < ACTUAL_MIN or trust < ACTUAL_TRUST:
        return trust, []
    return trust, [x for x in new if x["end"] > keys[-1] and 0.6 < x["revenue"] / x["ref"] < 1.8][-1:]  # 최신 공시 이후 분기만, 터무니없으면 버림
