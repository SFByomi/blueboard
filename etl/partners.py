"""상대국별 추이 — 추적 종목에 매핑된 무역 흐름의 '같은 품목'을 상대국별로 나눠 월별로 (종목 페이지 누적 막대 + 최근 월 비중).

- 미국(Census): 시리즈 조건(품목·주·세관구역)은 그대로 두고 국가 조건만 빼서 CTY_CODE별로 → 수입은 원산지, 수출은 목적지
- 한국(관세청): 품목별 국가별(item_cty)을 국가 조건 없이 → 전국 수출·수입 목적지 (시군구 API는 국가가 없어 시군구 흐름도 전국 기준)
- 일본 e-Stat·EU Comext는 아직 (세관별 표 구조가 달라 다음 단계)
같은 품목을 여러 종목이 쓰면 하나로 묶고, 최근 24개월 합 기준 상위 10개국 + 기타로 줄여 저장 → partner_keys·partner_flows.
"""
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests

from etl import census, kcs

START = "2021-01"
TOP = 10
STATE_KO = {"CA": "캘리포니아", "TX": "텍사스", "DE": "델라웨어", "OK": "오클라호마", "AZ": "애리조나", "OH": "오하이오", "SC": "사우스캐롤라이나", "NY": "뉴욕", "OR": "오리건", "WA": "워싱턴"}
CTY_KO = {
    "TAIWAN": "대만", "KOREA, SOUTH": "한국", "JAPAN": "일본", "CHINA": "중국", "MEXICO": "멕시코", "MALAYSIA": "말레이시아",
    "THAILAND": "태국", "VIETNAM": "베트남", "SINGAPORE": "싱가포르", "PHILIPPINES": "필리핀", "INDIA": "인도", "CANADA": "캐나다",
    "GERMANY": "독일", "NETHERLANDS": "네덜란드", "IRELAND": "아일랜드", "ISRAEL": "이스라엘", "HONG KONG": "홍콩", "UNITED KINGDOM": "영국",
    "FRANCE": "프랑스", "ITALY": "이탈리아", "SWITZERLAND": "스위스", "INDONESIA": "인도네시아", "BRAZIL": "브라질", "COSTA RICA": "코스타리카",
    "CZECH REPUBLIC": "체코", "CZECHIA": "체코", "HUNGARY": "헝가리", "POLAND": "폴란드", "AUSTRIA": "오스트리아", "BELGIUM": "벨기에", "SPAIN": "스페인",
    "SWEDEN": "스웨덴", "DENMARK": "덴마크", "FINLAND": "핀란드", "NORWAY": "노르웨이", "AUSTRALIA": "호주", "TURKEY": "튀르키예", "CAMBODIA": "캄보디아",
    "DOMINICAN REPUBLIC": "도미니카공화국", "EL SALVADOR": "엘살바도르", "UNITED ARAB EMIRATES": "아랍에미리트", "SAUDI ARABIA": "사우디아라비아",
    "ROMANIA": "루마니아", "PORTUGAL": "포르투갈", "SLOVAKIA": "슬로바키아", "NEW ZEALAND": "뉴질랜드", "SOUTH AFRICA": "남아프리카공화국",
    "CHILE": "칠레", "COLOMBIA": "콜롬비아", "ARGENTINA": "아르헨티나", "PERU": "페루", "GUATEMALA": "과테말라", "HONDURAS": "온두라스",
    "BANGLADESH": "방글라데시", "SRI LANKA": "스리랑카", "PAKISTAN": "파키스탄", "MOROCCO": "모로코", "TUNISIA": "튀니지", "EGYPT": "이집트",
    "ESTONIA": "에스토니아", "LITHUANIA": "리투아니아", "SLOVENIA": "슬로베니아", "CROATIA": "크로아티아", "BULGARIA": "불가리아", "GREECE": "그리스",
}


def _key(*parts) -> str:
    return hashlib.md5(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]


def _hs_list(hs) -> list[str]:
    return [str(h) for h in (hs if isinstance(hs, (list, tuple)) else [hs])]


HS4_KO = {"8504": "변압기·전력변환기", "8537": "배전·제어반", "8544": "전선·케이블", "8471": "컴퓨터", "8542": "집적회로"}


def _product(con, hs: list[str]) -> str:
    h = hs[0].replace(".", "")
    if len(h) == 4:
        return HS4_KO.get(h, f"HS {h}")
    r = con.execute("SELECT coalesce(name_ko, name_en) FROM hs_names WHERE hs=?", (h[:6],)).fetchone()
    return (r[0] if r and r[0] else f"HS {h[:6]}")


def keys(con) -> dict:
    """매핑된 무역 시리즈 → 상대국 분해 대상 (같은 조건은 하나로)"""
    rows = con.execute("""SELECT DISTINCT s.id, s.source, s.spec, m.ticker FROM series s JOIN mappings m ON m.series_id = s.id
                          WHERE s.source IN ('census', 'kcs')""").fetchall()
    out: dict[str, dict] = {}
    for sid, src, spec, ticker in rows:
        sp = json.loads(spec)
        hs = _hs_list(sp["hs"])
        if src == "census":
            ds = sp["dataset"]
            filt = {k: v for k, v in sp.get("filters", {}).items() if k != "CTY_CODE"}
            k = _key("census", ds, hs, filt)
            imp = ds.startswith("imports")
            st = filt.get("STATE", "-")
            where = STATE_KO.get(st, st) if st != "-" else ("미국 일부 세관" if "DISTRICT" in filt else "미국")
            label = f"{where} {_product(con, hs)} {'수입 — 원산지' if imp else '수출 — 목적지'}"
            job = {"src": "census", "dataset": ds, "hs": hs, "filters": filt}
        else:
            flow = sp.get("flow", "export")
            k = _key("kcs", hs, flow)
            label = f"한국 {_product(con, hs)} {'수출 — 목적지' if flow == 'export' else '수입 — 원산지'}{' (전국)' if sp['api'] == 'sigungu' else ''}"
            job = {"src": "kcs", "hs": hs, "flow": flow}
        e = out.setdefault(k, {"label": label, "job": job, "tickers": set(), "series": set()})
        e["tickers"].add(ticker)
        e["series"].add(sid)
    # 같은 이름(같은 HS6 아래 다른 세번)이 겹치면 세번을 붙여 구분 — 한국 HS10은 받아 온 품목명으로 다시 바꿈(collect)
    seen: dict[str, int] = {}
    for v in out.values():
        seen[v["label"]] = seen.get(v["label"], 0) + 1
    for v in out.values():
        if seen[v["label"]] > 1:
            h = v["job"]["hs"]
            v["label"] += f" (HS {', '.join(x.replace('.', '') for x in h)})"
    return out


def _census(job) -> pd.DataFrame:
    d = census.DATASETS[job["dataset"]]
    frames = []
    for h in job["hs"]:
        h = h.replace(".", "")
        params = {"get": f"CTY_CODE,CTY_NAME,{d['val']}", d["comm"]: h, "COMM_LVL": f"HS{len(h)}", "time": f"from {START}", **job["filters"]}
        r = requests.get(f"{census.BASE}/{job['dataset']}", params={**params, "key": os.environ["CENSUS_API_KEY"]}, timeout=180)
        if r.status_code == 204:
            continue
        r.raise_for_status()
        j = r.json()
        df = pd.DataFrame(j[1:], columns=j[0])
        df = df[df.CTY_CODE.str.fullmatch(r"[1-7]\d{3}")]  # 국가만 (합계 '-'·지역 묶음 0xxx·1XXX 제외)
        frames.append(pd.DataFrame({"month": df.time, "partner": df.CTY_NAME.map(lambda n: CTY_KO.get(n, n.title())), "value": pd.to_numeric(df[d["val"]], errors="coerce")}))
    return pd.concat(frames) if frames else pd.DataFrame(columns=["month", "partner", "value"])


def _kcs(job) -> pd.DataFrame:
    today = pd.Timestamp.today().to_period("M")
    s, rows = pd.Period(START, freq="M"), []
    while s <= today:
        e = min(s + 11, today)
        for h in job["hs"]:
            rows += kcs._window("item_cty", {"strtYymm": s.strftime("%Y%m"), "endYymm": e.strftime("%Y%m"), "hsSgn": h.replace(".", "")}, e >= today - 3)
        s = e + 1
    df = pd.DataFrame([r for r in rows if (r.get("year") or "").replace(".", "").isdigit() and r.get("statCd") not in (None, "-")])
    if df.empty:
        return pd.DataFrame(columns=["month", "partner", "value"])
    col = "expDlr" if job["flow"] == "export" else "impDlr"
    out = pd.DataFrame({"month": df.year.str.replace(".", "-"), "partner": df.statCdCntnKor1.str.strip(), "value": pd.to_numeric(df[col], errors="coerce")})
    if all(len(h.replace(".", "")) == 10 for h in job["hs"]):  # HS10은 관세청 품목명(예: 디램·플래시메모리)
        out.attrs["name"] = " + ".join(df.statKor.dropna().str.strip().unique()[:2])
    return out


def _reduce(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """상위 TOP개국(최근 24개월 합) + 기타. 반환: (month, partner, value), 기타에 묶인 나라 수"""
    name = df.attrs.get("name")
    df = df.groupby(["month", "partner"], as_index=False)["value"].sum()
    df = df[df.value > 0]
    if df.empty:
        return df, 0
    recent = sorted(df.month.unique())[-24:]
    rank = df[df.month.isin(recent)].groupby("partner").value.sum().sort_values(ascending=False)
    top = list(rank.index[:TOP])
    others = df.partner.nunique() - len(top)
    df["partner"] = df.partner.where(df.partner.isin(top), "기타")
    out = df.groupby(["month", "partner"], as_index=False)["value"].sum()
    out.attrs["name"] = name
    return out, others


def collect(con, log=print) -> int:
    ks = keys(con)
    got: dict[str, tuple[pd.DataFrame, int]] = {}

    def run(k, fn):
        try:
            got[k] = _reduce(fn(ks[k]["job"]))
        except Exception as e:  # noqa: BLE001 — 한 품목 실패가 전체를 막지 않게 (이전 값 유지)
            log(f"  ✗ 상대국 {ks[k]['label']}: {e}")

    with ThreadPoolExecutor(4) as pool:  # Census는 병렬, 관세청은 동시 호출에 잘 끊겨 이 스레드에서 차례로
        futs = [pool.submit(run, k, _census) for k, v in ks.items() if v["job"]["src"] == "census"]
        for k, v in ks.items():
            if v["job"]["src"] == "kcs":
                run(k, _kcs)
        for f in as_completed(futs):
            f.result()
    if not got:
        log("  ✗ 상대국: 받은 품목 없음 — 기존 값 유지")
        return 0
    for k, (df, others) in got.items():
        if df.empty:
            continue
        v = ks[k]
        if df.attrs.get("name"):
            v["label"] = f"한국 {df.attrs['name']} {'수출 — 목적지' if v['job']['flow'] == 'export' else '수입 — 원산지'}"
        con.execute("DELETE FROM partner_flows WHERE key=?", (k,))
        con.executemany("INSERT INTO partner_flows (key, month, partner, value_usd) VALUES (?,?,?,?)", [(k, r.month, r.partner, float(r.value)) for r in df.itertuples()])
        con.execute("INSERT OR REPLACE INTO partner_keys (key, label, source, tickers, series, others) VALUES (?,?,?,?,?,?)",
                    (k, v["label"], v["job"]["src"], json.dumps(sorted(v["tickers"])), json.dumps(sorted(v["series"])), others))
    con.execute(f"DELETE FROM partner_keys WHERE key NOT IN ({','.join('?' * len(ks))})", list(ks))  # 매핑에서 빠진 품목 정리
    con.execute(f"DELETE FROM partner_flows WHERE key NOT IN ({','.join('?' * len(ks))})", list(ks))
    con.commit()
    log(f"  ✓ 상대국별 추이 {sum(1 for d, _ in got.values() if not d.empty)}/{len(ks)}개 품목")
    return len(got)
