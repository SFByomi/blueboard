"""주요 일정 — 미국 거시 발표(BLS·BEA·연준·Census)·한국 수출입·추적 종목 실적 발표일 → econ_events (모두 한국 시간).

- BLS(CPI·PPI·고용): bls.gov 일정 페이지. 자동 수집을 막으면(403) data/bls_schedule.json 사본
- BEA(GDP·PCE·무역수지): 공식 JSON(release_dates.json, UTC)
- 연준 FOMC: fomccalendars.htm — 회의 둘째 날 14:00(미국 동부) 성명
- Census 무역 상세(FT-900, 이 사이트의 미국 무역 데이터가 새 달로 바뀌는 날)·상품무역 속보(Advance Economic Indicators)
- 한국 수출입: 산업부 월간(1일 09:00)·관세청 1~10일/1~20일 잠정(11일·21일) — 규칙 기반이라 '~'
- 실적: earnings_calendar(야후 확정일, 없으면 작년 기준 추정일 '~')
"""
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ET, KST = ZoneInfo("America/New_York"), ZoneInfo("Asia/Seoul")
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"}
ROOT = Path(__file__).resolve().parents[1]
BLS_FILE = ROOT / "data" / "bls_schedule.json"
BLS = {"CPI": ("cpi", "미국 소비자물가(CPI)", "물가"), "PPI": ("ppi", "미국 생산자물가(PPI)", "물가"), "EMPSIT": ("empsit", "미국 고용보고서", "고용")}
BEA = {"Personal Income and Outlays": ("미국 개인소득·PCE 물가", "물가"), "Gross Domestic Product": ("미국 GDP", "성장"),
       "U.S. International Trade in Goods and Services": ("미국 무역수지 (Census 무역 데이터 갱신)", "무역")}
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def _et(d: date, hh: int, mm: int) -> datetime:
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=ET).astimezone(KST)


def _ev(dt: datetime | date, title: str, cat: str, country: str, source: str, ticker=None, approx=False, note=None) -> dict:
    if isinstance(dt, datetime):
        return {"date": dt.strftime("%Y-%m-%d"), "time_kst": dt.strftime("%H:%M"), "title": title, "cat": cat, "country": country,
                "source": source, "ticker": ticker, "approx": int(approx), "note": note}
    return {"date": dt.isoformat(), "time_kst": None, "title": title, "cat": cat, "country": country, "source": source,
            "ticker": ticker, "approx": int(approx), "note": note}


def bls(log) -> list[dict]:
    dates = {}
    for key, (page, _, _) in BLS.items():
        try:
            r = requests.get(f"https://www.bls.gov/schedule/news_release/{page}.htm", headers=H, timeout=30)
            r.raise_for_status()
            got = [date(int(y), MONTHS[m.lower()[:3]], int(d)) for m, d, y in re.findall(r"([A-Z][a-z]{2})\.? (\d{1,2}), (\d{4})", r.text)]
            if got:
                dates[key] = got
        except Exception:  # noqa: BLE001 — 403 등은 사본으로
            pass
    if len(dates) < len(BLS):
        saved = json.loads(BLS_FILE.read_text())
        for k in BLS:
            dates.setdefault(k, [date.fromisoformat(d) for d in saved[k]])
        log("  · BLS 일정: bls.gov 접속 불가 → 사본(data/bls_schedule.json)")
    return [_ev(_et(d, 8, 30), BLS[k][1], BLS[k][2], "미국", "BLS") for k, ds in dates.items() for d in sorted(set(ds))]


def bea() -> list[dict]:
    j = requests.get("https://apps.bea.gov/API/signup/release_dates.json", headers=H, timeout=60).json()
    out = []
    for name, (title, cat) in BEA.items():
        for ts in sorted(set(j.get(name, {}).get("release_dates", []))):
            out.append(_ev(datetime.fromisoformat(ts).astimezone(KST), title, cat, "미국", "BEA"))
    return out


def fomc() -> list[dict]:
    t = requests.get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", headers=H, timeout=60).text
    out = []
    for y, block in re.findall(r"(\d{4}) FOMC Meetings(.*?)(?=\d{4} FOMC Meetings|$)", re.sub(r"<[^>]+>", " ", t), re.S):
        for mon, d1, d2 in re.findall(r"(January|February|March|April|May|June|July|August|September|October|November|December)(?:/[A-Za-z]+)?\s+(\d{1,2})-(\d{1,2})", block):
            m = MONTHS[mon.lower()[:3]]
            end = date(int(y), m, int(d2)) if int(d2) > int(d1) else date(int(y), m % 12 + 1, int(d2))
            out.append(_ev(_et(end, 14, 0), "FOMC 금리 결정", "금리", "미국", "연준", note="성명 발표(기자회견 30분 뒤)"))
    return out


def census() -> list[dict]:
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", requests.get("https://www.census.gov/foreign-trade/schedule.html", headers=H, timeout=60).text))
    i = t.find("Advance Economic Indicators")
    seg = t[i:].split("All releases occur")[0] if i >= 0 else ""  # 바로 뒤 철강 수입 표(FT900a)는 제외
    out = []
    for mon, d, y in re.findall(r"(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})", seg):
        out.append(_ev(_et(date(int(y), MONTHS[mon.lower()[:3]], int(d)), 8, 30), "미국 상품무역 속보(Advance)", "무역", "미국", "Census"))
    return out


def korea(start: date, end: date) -> list[dict]:
    out, d = [], date(start.year, start.month, 1)
    while d <= end:
        out.append(_ev(datetime(d.year, d.month, 1, 9, 0, tzinfo=KST), "한국 수출입 동향(월간)", "무역", "한국", "산업부·관세청", approx=True,
                       note="매월 1일 09:00 (휴일이어도 대개 1일)"))
        for day, lab in ((11, "1~10일"), (21, "1~20일")):
            x = date(d.year, d.month, day)
            x += timedelta(days=(7 - x.weekday()) % 7 if x.weekday() >= 5 else 0)  # 주말이면 월요일 (공휴일은 반영 못 함)
            out.append(_ev(datetime(x.year, x.month, x.day, 9, 0, tzinfo=KST), f"한국 {lab} 수출(잠정)", "무역", "한국", "관세청", approx=True,
                           note="휴일이면 다음 영업일"))
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return out


def earnings(con) -> list[dict]:
    rows = con.execute("SELECT e.ticker, coalesce(c.name_ko, c.name), e.next_date, e.next_basis FROM earnings_calendar e JOIN companies c ON c.ticker=e.ticker "
                       "WHERE e.next_date IS NOT NULL").fetchall()
    return [_ev(date.fromisoformat(d[:10]), f"{n} 실적", "실적", "한국" if "." in t else "미국", "야후·DART" if "." in t else "야후·SEC", ticker=t,
                approx=bool(b), note=b) for t, n, d, b in rows]


def collect(con, log=print) -> int:
    today = date.today()
    start, end = date(today.year, today.month, 1) - timedelta(days=40), today + timedelta(days=120)
    evs = []
    for name, job in (("BLS", lambda: bls(log)), ("BEA", bea), ("FOMC", fomc), ("Census", census),
                      ("한국", lambda: korea(start, end)), ("실적", lambda: earnings(con))):
        try:
            got = job()
            evs += got
        except Exception as e:  # noqa: BLE001 — 한 소스 실패가 전체를 막지 않게
            log(f"  ✗ 일정 {name}: {e}")
    evs = [e for e in evs if start.isoformat() <= e["date"] <= end.isoformat()]
    con.execute("DELETE FROM econ_events")
    con.executemany("INSERT INTO econ_events (date, time_kst, title, cat, country, source, ticker, approx, note) VALUES (?,?,?,?,?,?,?,?,?)",
                    [(e["date"], e["time_kst"], e["title"], e["cat"], e["country"], e["source"], e["ticker"], e["approx"], e["note"]) for e in evs])
    con.commit()
    log(f"  ✓ 주요 일정 {len(evs)}건 ({start}~{end})")
    return len(evs)
