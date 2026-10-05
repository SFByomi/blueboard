"""일본 e-Stat 무역통계 — 税関別品別国別表 (세관 지서 × HS9 × 국가 × 월).

표는 기간별로 나뉘어 있어 TABLES를 합쳐 읽는다. 결과는 data/raw/estat/ 캐시.
"""
import json
import os
import re
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
API = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData"
CACHE = ROOT / "data" / "raw" / "estat"

TABLES = {  # 税関別品別国別表
    "export": ["0003425301", "0004002162"],  # 2021-22 확정, 2023-26
    "import": ["0003425302", "0004002161"],
}
OFFICES = {"関西空港": "50404", "成田": "50104", "大阪": "50400", "呉": "50344", "中部空港": "50502", "福岡空港": "50605",
           "四日市": "50540", "横浜": "50200", "東京": "50100", "仙台塩釜": "50260", "仙台空港": "50265"}
COUNTRIES = {"50105": "중국", "50106": "대만", "50103": "한국", "50111": "태국", "50113": "말레이시아",
             "50112": "싱가포르", "50110": "베트남", "50117": "필리핀", "50304": "미국"}


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _get(table, params, refresh):
    key = "_".join([table] + [f"{k}-{v}" for k, v in sorted(params.items())]).replace(",", "+")
    path = CACHE / f"{key}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    values, start = [], 1
    while start:
        r = requests.get(API, params={"appId": os.environ["ESTAT_APP_ID"], "statsDataId": table, "metaGetFlg": "N",
                                      "cntGetFlg": "N", "startPosition": start, **params}, timeout=120)
        r.raise_for_status()
        d = r.json()["GET_STATS_DATA"]
        if d["RESULT"]["STATUS"] not in (0, 1):  # 1 = 데이터 없음
            raise RuntimeError(d["RESULT"]["ERROR_MSG"])
        inf = d.get("STATISTICAL_DATA", {}).get("DATA_INF", {})
        v = inf.get("VALUE", [])
        values += v if isinstance(v, list) else [v]
        start = d.get("STATISTICAL_DATA", {}).get("RESULT_INF", {}).get("NEXT_KEY")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(values, ensure_ascii=False), encoding="utf-8")
    return values


def fetch(flow: str, hs9: list, office: str, country: str | None = None, refresh=False) -> pd.DataFrame:
    """[month, hs9, country, value_kjpy(천엔), qty1] — 월별 행. country는 e-Stat 국가코드(예: 50113 말레이시아)."""
    rows = []
    q = {"cdCat01": ",".join(hs9), "cdCat03": OFFICES.get(office, office)}
    if country:
        q["cdArea"] = country
    units = {}
    for table in TABLES[flow]:
        for v in _get(table, q, refresh):
            if v["@cat02"] in ("100", "110"):  # 단위1 / 단위2 (예: ＮＯ, ＫＧ)
                units.setdefault(v["@cat02"], v["$"].translate(str.maketrans("ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ", "ABCDEFGHIJKLMNOPQRSTUVWXYZ")))
                continue
            m = re.match(r"(\d+)月_(数量1|数量2|金額)", _cat02_name(v["@cat02"]))
            if not m:
                continue
            rows.append({"year": int(v["@time"][:4]), "mon": int(m.group(1)), "kind": m.group(2),
                         "hs9": v["@cat01"], "country": v["@area"], "val": _num(v["$"])})
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df = df.pivot_table(index=["year", "mon", "hs9", "country"], columns="kind", values="val", aggfunc="sum").reset_index()
    df["month"] = pd.PeriodIndex.from_fields(year=df["year"], month=df["mon"], freq="M")
    df = df.rename(columns={"金額": "value_kjpy", "数量1": "qty1", "数量2": "qty2"}).drop(columns=["year", "mon"])
    for c in ("qty1", "qty2"):
        if c not in df:
            df[c] = 0.0
    # 수량은 단위1이 비어 있으면(예: IC는 단위2=개수) 단위2를 사용
    use2 = units.get("100", "").strip() in ("", "-", "－") and units.get("110")
    df["qty"] = df["qty2"] if use2 else df["qty1"]
    df["unit"] = units.get("110") if use2 else units.get("100")
    return df.drop_duplicates(["month", "hs9", "country"], keep="last").sort_values("month")


# cat02 코드 → 이름: 100,110 단위 / 120~140 합계 / 150부터 월별 (数量1, 数量2, 金額) 3개씩
def _cat02_name(code: str) -> str:
    c = int(code)
    if c < 150:
        return ""
    i = (c - 150) // 10
    return f"{i // 3 + 1}月_{['数量1', '数量2', '金額'][i % 3]}"


def jpyusd() -> pd.Series:
    """월평균 엔/달러 (FRED EXJPUS, 1달러당 엔)."""
    path = CACHE / "EXJPUS.csv"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(requests.get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=EXJPUS", timeout=60).text)
    fx = pd.read_csv(path)
    return pd.Series(fx["EXJPUS"].values, index=pd.PeriodIndex(fx["observation_date"], freq="M"))


def monthly_usd(flow, hs9, offices, country=None) -> pd.DataFrame:
    """여러 세관 합산 → [month, value_usd, qty] (census.fetch와 같은 형태)."""
    df = pd.concat([fetch(flow, hs9, o, country) for o in offices])
    g = df.groupby("month")[["value_kjpy", "qty"]].sum(min_count=1).fillna(0)
    g = g[g.index <= g.index[g["value_kjpy"] > 0].max()]  # e-Stat은 미공개 월도 0으로 줌 → 마지막 실값 이후 제거
    fx = jpyusd().reindex(g.index).ffill()
    return pd.DataFrame({"month": g.index, "value_usd": (g["value_kjpy"] * 1000 / fx).values, "qty": g["qty"].values,
                         "unit": df["unit"].dropna().iloc[0] if df["unit"].notna().any() else None})
