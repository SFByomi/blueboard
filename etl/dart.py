"""OpenDART 분기 매출 (한국 상장사). 12월 결산 기준.

분기보고서 thstrm_amount = 해당 3개월, 사업보고서 = 연간 → 4분기 = 연간 − 3분기 누적.
fs_div: CFS(연결) / OFS(별도). 지주회사의 사업부(예: 두산 전자BG)는 별도가 더 가까움.
"""
import io
import json
import os
import re
import zipfile
from datetime import date
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
CACHE = ROOT / "data" / "raw" / "dart"
BASE = "https://opendart.fss.or.kr/api"
REPORTS = [("11013", 1), ("11012", 2), ("11014", 3), ("11011", 4)]  # 1Q, 반기, 3Q, 사업
REV_IDS = ("ifrs-full_Revenue", "ifrs_Revenue")
REV_NAMES = ("매출액", "수익(매출액)", "영업수익", "매출")
OI_IDS = ("dart_OperatingIncomeLoss",)
OI_NAMES = ("영업이익", "영업이익(손실)", "영업손실", "영업손익")


def corp_code(stock_code: str) -> str:
    path = CACHE / "corp.zip"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(requests.get(f"{BASE}/corpCode.xml", params={"crtfc_key": os.environ["DART_API_KEY"]}, timeout=120).content)
    z = zipfile.ZipFile(io.BytesIO(path.read_bytes()))
    xml = z.read(z.namelist()[0]).decode("utf-8")
    m = re.search(r"<corp_code>(\d+)</corp_code>(?:(?!</list>).)*?<stock_code>" + stock_code, xml, re.S)
    if not m:
        raise KeyError(stock_code)
    return m.group(1)


def _report(corp, year, reprt, fs_div):
    path = CACHE / f"{corp}_{year}_{reprt}_{fs_div}.json"
    if path.exists():
        got = json.loads(path.read_text(encoding="utf-8"))
        if "oi" in got:  # 영업이익 추가 전 캐시는 다시 받음
            return got
    d = requests.get(f"{BASE}/fnlttSinglAcntAll.json", params={"crtfc_key": os.environ["DART_API_KEY"], "corp_code": corp,
                     "bsns_year": year, "reprt_code": reprt, "fs_div": fs_div}, timeout=60).json()
    if d["status"] == "013":  # 데이터 없음 (아직 미공시)
        return None
    if d["status"] != "000":
        raise RuntimeError(d.get("message"))
    is_rows = [x for x in d["list"] if x["sj_div"] in ("IS", "CIS")]
    rev = (next((x for x in is_rows if x["account_id"] in REV_IDS), None)
           # 표준계정코드 미사용 공시는 계정명으로
           or next((x for x in is_rows if x["account_nm"].replace(" ", "") in REV_NAMES), None))
    oi = (next((x for x in is_rows if x["account_id"] in OI_IDS), None)
          or next((x for x in is_rows if x["account_nm"].replace(" ", "") in OI_NAMES), None))
    num = lambda x: float(x["thstrm_amount"].replace(",", "")) if x and x["thstrm_amount"] and x["thstrm_amount"] != "-" else None  # noqa: E731
    out = {"amount": num(rev), "oi": num(oi)}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out))  # 공시된 보고서만 캐시 (정정공시는 refresh로 재수집)
    return out


def _quarterly(stock_code: str, fs_div: str, key: str, start_year: int) -> pd.DataFrame:
    corp = corp_code(stock_code)
    rows = []
    for y in range(start_year, date.today().year + 1):
        got = {q: _report(corp, y, r, fs_div) for r, q in REPORTS}
        for q in (1, 2, 3):
            if got[q] and got[q].get(key) is not None:
                rows.append((y, q, got[q][key]))
        if got[4] and got[4].get(key) is not None and all(got[q] and got[q].get(key) is not None for q in (1, 2, 3)):
            rows.append((y, 4, got[4][key] - sum(got[q][key] for q in (1, 2, 3))))
    df = pd.DataFrame(rows, columns=["year", "q", "v"])
    df["start"] = pd.to_datetime([f"{y}-{3 * q - 2:02d}-01" for y, q in zip(df.year, df.q)])
    df["end"] = df["start"] + pd.offsets.QuarterEnd(0)
    return df[["start", "end", "v"]]


def quarterly_revenue(stock_code: str, fs_div="CFS", start_year=2020) -> pd.DataFrame:
    return _quarterly(stock_code, fs_div, "amount", start_year).rename(columns={"v": "revenue"})


def quarterly_operating_income(stock_code: str, fs_div="CFS", start_year=2020) -> pd.DataFrame:
    """[end, oi] — 손익계산서 영업이익(분기 3개월 값, 4분기 = 연간 − 1~3분기)"""
    return _quarterly(stock_code, fs_div, "oi", start_year).rename(columns={"v": "oi"})[["end", "oi"]]
