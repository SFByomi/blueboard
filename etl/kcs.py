"""한국 관세청 수출입실적 (공공데이터포털).

- item     : 품목별 (Itemtrade)          — HS 앞자리(6·10자리)로 조회, 하위 세번 합산
- item_cty : 품목별 국가별 (nitemtrade)  — cntyCd(예: TW, CN, US) 필터
- sigungu  : 시군구별 품목별 (sigunguperprlstperacrs) — HS6 + 시도코드 필수, sggNm(시군구명)으로 필터. 금액 천달러, 중량 없음
한 번에 1년 이내만 조회 가능 → 12개월 창으로 나눠 호출. 금액 USD, 중량 KG.
"""
import json
import os
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
CACHE = ROOT / "data" / "raw" / "kcs"
API = {
    "item": "https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList",
    "item_cty": "https://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList",
    "sigungu": "https://apis.data.go.kr/1220000/sigunguperprlstperacrs/getSigunguPerPrlstPerAcrs",
}
_unreachable = False  # 한 번 접속 실패가 확정되면 같은 실행의 나머지 관세청 호출은 즉시 실패

SIDO = {"서울": "11", "부산": "26", "대구": "27", "인천": "28", "광주": "29", "대전": "30", "울산": "31", "세종": "36",
        "경기": "41", "충북": "43", "충남": "44", "전남": "46", "경북": "47", "경남": "48", "제주": "50", "강원": "51", "전북": "52"}


def _num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _window(api, params, refresh):
    key = "_".join(f"{k}-{v}" for k, v in sorted(params.items()))
    path = CACHE / api / f"{key}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    global _unreachable
    if _unreachable:  # 이번 실행에서 이미 접속 불가 확인 → 시리즈마다 수 분씩 기다리지 않고 바로 건너뜀 (DB의 이전 값 유지)
        raise RuntimeError("관세청 API 접속 불가 — 이번 실행은 건너뜀")
    for attempt in range(3):  # apis.data.go.kr는 연결 끊김·응답 지연이 잦음 → 재시도
        try:
            r = requests.get(API[api], params={"serviceKey": os.environ["DATA_GO_KR_KEY"], **params}, timeout=(10, 60))
            break
        except (requests.ConnectionError, requests.Timeout):
            if attempt == 2:
                _unreachable = True  # 해외(GitHub Actions 미국 서버)에서 접속이 막히는 경우가 있음
                raise
            time.sleep(2 ** attempt)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    code = root.findtext(".//resultCode") or root.findtext(".//returnReasonCode")
    if code != "00":
        raise RuntimeError(root.findtext(".//resultMsg") or root.findtext(".//returnAuthMsg"))
    items = [{c.tag: c.text for c in it} for it in root.iter("item")]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    return items


def fetch(api: str, hs: str, flow: str = "export", cnty: str | None = None, start="2020-01", refresh=False,
          sido: str | None = None, sgg: str | None = None) -> pd.DataFrame:
    """[month, value_usd, qty, unit] — 월별 (하위 세번 합산). sigungu는 sido(시도코드)·sgg(예: '경기도 수원시') 필요."""
    today = pd.Timestamp.today().to_period("M")
    s = pd.Period(start, freq="M")
    rows = []
    while s <= today:
        e = min(s + 11, today)
        params = {"strtYymm": s.strftime("%Y%m"), "endYymm": e.strftime("%Y%m")}
        if api == "sigungu":
            params.update(HsSgn=hs, sidoCd=sido)
        else:
            params["hsSgn"] = hs
        if cnty:
            params["cntyCd"] = cnty
        # 지난 창은 캐시, 최신 창(올해)은 매번 갱신
        rows += _window(api, params, refresh or e == today)
        s = e + 1
    if api == "sigungu":
        df = pd.DataFrame([r for r in rows if (r.get("sggNm") or "").strip() == sgg])
        if df.empty:
            return pd.DataFrame(columns=["month", "value_usd", "qty", "unit"])
        df["month"] = pd.PeriodIndex(df["priodTitle"].str.strip().str.replace(".", "-"), freq="M")
        df["value_usd"] = df["expUsdAmt" if flow == "export" else "impUsdAmt"].map(_num) * 1000  # 천달러
        g = df.groupby("month", as_index=False)["value_usd"].sum()
        g["qty"], g["unit"] = None, None
        return g
    val, wgt = ("expDlr", "expWgt") if flow == "export" else ("impDlr", "impWgt")
    df = pd.DataFrame([r for r in rows if r.get("year", "").replace(".", "").isdigit()])
    if df.empty:
        return pd.DataFrame(columns=["month", "value_usd", "qty", "unit"])
    df["month"] = pd.PeriodIndex(df["year"].str.replace(".", "-"), freq="M")
    df["value_usd"] = pd.to_numeric(df[val], errors="coerce")
    df["qty"] = pd.to_numeric(df[wgt], errors="coerce")
    g = df.groupby("month", as_index=False)[["value_usd", "qty"]].sum()
    g = g[g["value_usd"] > 0]
    g["unit"] = "KG"
    return g
