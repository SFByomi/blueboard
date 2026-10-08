"""SEC EDGAR companyfacts에서 분기 매출 실측치 추출 (검증용)."""
import json
import re
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "raw" / "sec"
UA = {"User-Agent": "Yomin research contact@example.com"}
REV_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"]


def _get(url, path, refresh):
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    r = requests.get(url, headers=UA, timeout=60)
    r.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(r.text)
    return r.json()


def cik(ticker: str) -> str:
    m = _get("https://www.sec.gov/files/company_tickers.json", CACHE / "tickers.json", False)
    for v in m.values():
        if v["ticker"] == ticker:
            return f"{v['cik_str']:010d}"
    raise KeyError(ticker)


def quarterly_revenue(ticker: str, refresh=False) -> pd.DataFrame:
    """[end, start, revenue] — 약 3개월 구간. 4분기는 연간 - 1~3분기로 계산."""
    facts = _get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik(ticker)}.json",
                 CACHE / f"{ticker}.json", refresh)["facts"]["us-gaap"]
    rows = []
    for tag in REV_TAGS:
        for u in facts.get(tag, {}).get("units", {}).get("USD", []):
            if "start" in u:
                rows.append({"start": u["start"], "end": u["end"], "val": u["val"], "filed": u["filed"], "tag": tag})
    latest = max((r["filed"] for r in rows), default="")
    rows += _unindexed(ticker, latest)  # companyfacts가 아직 반영 안 한 최근 10-Q·10-K (예: BE 2026-07 10-Q)
    df = pd.DataFrame(rows)
    df["start"], df["end"] = pd.to_datetime(df["start"]), pd.to_datetime(df["end"])
    df["days"] = (df["end"] - df["start"]).dt.days
    df["tag"] = df["tag"].fillna("direct")
    df = df.sort_values("filed").drop_duplicates(["start", "end", "tag"], keep="last")  # 태그별 최신 정정치
    # 회사가 여러 태그로 매출을 보고하면 값이 엇갈림(BE는 Revenues가 총매출, NetApp은 일부 분기에 제품 매출만 다른 시작일로)
    # → 사실이 가장 많은 태그를 기본으로, 같은 분기 말이면 기본 태그 안에서 큰 값(총액), 없을 때만 다른 태그
    primary = df[df.tag != "direct"].tag.value_counts().idxmax() if (df.tag != "direct").any() else "direct"
    df["prio"] = (~df.tag.isin([primary, "direct"])).astype(int)
    df = df.sort_values(["prio", "val"], ascending=[True, False])

    q = df[df["days"].between(80, 100)].drop_duplicates("end")[["start", "end", "val"]]
    annual = df[df["days"].between(350, 380)].drop_duplicates("end")
    derived = []
    for _, a in annual.iterrows():  # 연간에만 있는 4분기 복원
        inside = q[(q["start"] >= a["start"]) & (q["end"] <= a["end"])]
        if len(inside) == 3 and not (q["end"] == a["end"]).any():
            derived.append({"start": inside["end"].max() + pd.Timedelta(days=1), "end": a["end"],
                            "val": a["val"] - inside["val"].sum()})
    q = pd.concat([q, pd.DataFrame(derived)]).drop_duplicates("end").sort_values("end")
    return q.rename(columns={"val": "revenue"}).reset_index(drop=True)


def _instance_revenue(cik_: int, acc: str) -> list[dict]:
    """공시 XBRL 인스턴스(*_htm.xml)에서 차원(segment) 없는 매출 사실만 → [{start, end, val}]. 결과는 캐시(지난 공시는 안 바뀜)"""
    path = CACHE / "filings" / f"{acc}.json"
    if path.exists():
        return json.loads(path.read_text())
    base = f"https://www.sec.gov/Archives/edgar/data/{cik_}/{acc.replace('-', '')}"
    items = requests.get(f"{base}/index.json", headers=UA, timeout=60).json()["directory"]["item"]
    inst = next((i["name"] for i in items if i["name"].endswith("_htm.xml")), None)
    out = []
    if inst:
        x = requests.get(f"{base}/{inst}", headers=UA, timeout=120).text
        ctx = {}
        for m in re.finditer(r"<(?:xbrli:)?context id=\"([^\"]+)\">(.*?)</(?:xbrli:)?context>", x, re.S):
            if "segment" in m.group(2):
                continue
            sd, ed = re.search(r"startDate>([\d-]+)<", m.group(2)), re.search(r"endDate>([\d-]+)<", m.group(2))
            if sd and ed:
                ctx[m.group(1)] = (sd.group(1), ed.group(1))
        for tag in REV_TAGS:
            for m in re.finditer(rf"<us-gaap:{tag} [^>]*contextRef=\"([^\"]+)\"[^>]*>([\d.-]+)<", x):
                if m.group(1) in ctx:
                    out.append({"start": ctx[m.group(1)][0], "end": ctx[m.group(1)][1], "val": float(m.group(2)), "tag": tag})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out))
    return out


def _unindexed(ticker: str, after: str) -> list[dict]:
    """companyfacts의 마지막 공시일 이후 제출된 10-Q·10-K(정정 포함)를 직접 읽음. 태그 우선순위는 REV_TAGS 순"""
    c = cik(ticker)
    try:
        sub = requests.get(f"https://data.sec.gov/submissions/CIK{c}.json", headers=UA, timeout=60).json()["filings"]["recent"]
    except Exception:
        return []
    rows = []
    for form, filed, acc in zip(sub["form"], sub["filingDate"], sub["accessionNumber"]):
        if form.split("/")[0] in ("10-Q", "10-K") and filed > after:
            facts = _instance_revenue(int(c), acc)
            for tag in REV_TAGS:  # companyfacts와 같게 첫 태그 우선
                hit = [f for f in facts if f["tag"] == tag]
                if hit:
                    rows += [{"start": f["start"], "end": f["end"], "val": f["val"], "filed": filed, "tag": tag} for f in hit]
                    break
    return rows
