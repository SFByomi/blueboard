"""빅테크(AI 설비투자 주체) 분기 현금흐름 — SEC XBRL → bigtech_cash. 업황 탭 'AI 수요 쪽'의 돈 내는 쪽.

- 영업현금흐름(OCF) · 설비투자(유형자산 취득) · FCF = OCF − 설비투자 (회사 자체 정의와 다를 수 있음: 메타는 금융리스 원금 상환도 뺌)
- 외부 조달 = 장기·단기 차입 발행액 + 주식 발행액 (총액, 상환 차감 전 — '빈자리를 무엇으로 메웠나')
- 현금흐름표는 연초 누적이라 분기값 = 누적 차이 (credit._flow)
- 분기는 끝난 달로 달력 분기에 붙임 — 오라클(8·11·2·5월 말)은 가장 가까운 달력 분기
"""
import pandas as pd

from etl import credit, sec

COS = [("MSFT", "마이크로소프트", "Microsoft"), ("GOOGL", "알파벳", "Alphabet"), ("AMZN", "아마존", "Amazon"), ("META", "메타", "Meta"), ("ORCL", "오라클", "Oracle")]
START = "2021-01-01"
CAPEX = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"]
DEBT_LT = ["ProceedsFromIssuanceOfLongTermDebt", "ProceedsFromDebtNetOfIssuanceCosts", "ProceedsFromIssuanceOfSeniorLongTermDebt", "ProceedsFromIssuanceOfDebt",
           "ProceedsFromIssuanceOfUnsecuredDebt", "ProceedsFromIssuanceOfLongTermDebtAndCapitalSecuritiesNet"]
DEBT_ST = ["ProceedsFromShortTermDebt"]  # 만기 90일 넘는 단기 차입 (CP 순증감은 회전이라 뺌)
EQUITY = ["ProceedsFromIssuanceOfCommonStock"]


def _first(facts: dict, tags: list[str]) -> dict[str, float]:
    """분기마다 우선순위 첫 태그 (같은 분기 ±10일은 하나로)"""
    out: dict[str, float] = {}
    for t in tags:
        for e, v in credit._flow(facts, t).items():
            if credit._near(out, e, 10) is None:
                out[e] = v
    return out


def _cal_q(end: str) -> str:
    d = pd.Timestamp(end) + pd.Timedelta(days=15)  # 8/31 → 9월(3분기), 11/30 → 12월(4분기), 9/28 같은 52주 결산도 그 분기
    return f"{d.year}Q{(d.month - 1) // 3 + 1}"


def one(ticker: str) -> list[tuple]:
    facts = sec._get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{sec.cik(ticker)}.json", sec.CACHE / f"{ticker}.json", True)["facts"]["us-gaap"]
    ocf, capex = credit._flow(facts, "NetCashProvidedByUsedInOperatingActivities"), _first(facts, CAPEX)
    debt, st, eq = _first(facts, DEBT_LT), _first(facts, DEBT_ST), _first(facts, EQUITY)
    rows = []
    for e in sorted(ocf):
        c = credit._near(capex, e, 10)
        if e < START or c is None:
            continue
        raised = sum(x for x in (credit._near(debt, e, 10), credit._near(st, e, 10), credit._near(eq, e, 10)) if x)
        rows.append((ticker, e, _cal_q(e), ocf[e], c, ocf[e] - c, raised))
    return rows


def collect(con, log=print) -> int:
    rows = []
    for t, *_ in COS:
        try:
            rows += one(t)
        except Exception as e:  # noqa: BLE001 — 한 회사 실패가 나머지를 막지 않게
            log(f"  ✗ 빅테크 현금흐름 {t}: {e}")
    if not rows:
        log("  ✗ 빅테크 현금흐름: 받은 회사 없음 — 기존 값 유지")
        return 0
    got = sorted({r[0] for r in rows})
    con.execute(f"DELETE FROM bigtech_cash WHERE ticker IN ({','.join('?' * len(got))})", got)
    con.executemany("INSERT OR REPLACE INTO bigtech_cash (ticker, q_end, cal_q, ocf, capex, fcf, raised) VALUES (?,?,?,?,?,?,?)", rows)
    con.commit()
    log(f"  ✓ 빅테크 현금흐름 {len(got)}곳 {len(rows)}분기")
    return len(rows)
