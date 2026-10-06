"""공급망 가격지수 — 생산자물가(PPI)·수출입 가격지수 (BLS, FRED 경유). 월별.

정의는 여기(코드)가 원본: 수집할 때마다 indicators 테이블을 이 목록으로 맞추고, 값은 price_snapshots
(kind='index', item=지수 id, stat='value', date=YYYY-MM-01)에 넣는다 → Supabase에 누적 게시.
새 지수 추가: INDICATORS에 한 줄 (FRED 시리즈 ID). 다른 소스(대만 물가 등)는 FETCH에 함수 등록.
"""
from etl import fred

# (id, 표시 이름, 그룹, 메모)
INDICATORS = [
    ("PCU334111334111", "컴퓨터(서버·PC) 생산자가", "서버·스토리지", "BLS PPI 산업: 전자컴퓨터 제조"),
    ("PCU334112334112", "저장장치 생산자가", "서버·스토리지", "BLS PPI 산업: 컴퓨터 저장장치 제조"),
    ("IQ21300", "컴퓨터 수출가", "서버·스토리지", "BLS 수출가격지수(최종용도): 컴퓨터"),
    ("IQ21301", "컴퓨터 부품·주변기기 수출가", "서버·스토리지", "BLS 수출가격지수(최종용도): 컴퓨터 부속품"),
    ("PCU334418334418", "PCB 조립품 생산자가", "서버·스토리지", "BLS PPI 산업: 인쇄회로 조립"),
    ("PCU334413334413", "반도체 생산자가", "반도체", "BLS PPI 산업: 반도체·관련소자 제조"),
    ("PCU3344133344131", "IC 패키지 생산자가", "반도체", "BLS PPI: 집적회로 패키지"),
    ("IQ21320", "반도체 수출가", "반도체", "BLS 수출가격지수(최종용도): 반도체"),
    ("IR21320", "반도체 수입가", "반도체", "BLS 수입가격지수(최종용도): 반도체"),
    ("PCU334412334412", "PCB(베어 기판) 생산자가", "반도체", "BLS PPI 산업: 베어 PCB 제조"),
    ("PCU334210334210", "통신장비 생산자가", "네트워크", "BLS PPI 산업: 전화·통신장치 제조"),
    ("PCU335311335311", "변압기 생산자가", "전력·냉각", "BLS PPI 산업: 전력·특수 변압기 제조"),
    ("PCU335313335313", "개폐장치·배전반 생산자가", "전력·냉각", "BLS PPI 산업: 스위치기어·배전반"),
    ("PCU335312335312", "모터·발전기 생산자가", "전력·냉각", "BLS PPI 산업: 모터·발전기 제조"),
    ("PCU335929335929", "전력·통신 케이블 생산자가", "전력·냉각", "BLS PPI 산업: 기타 통신·에너지 전선"),
    ("PCU333415333415", "공조·냉각장비 생산자가", "전력·냉각", "BLS PPI 산업: 공조·냉동·난방 장비"),
]
SINCE = "2015-01-01"


def collect(con, log=print) -> int:
    con.execute("DELETE FROM indicators")
    con.executemany("INSERT INTO indicators (id, label, grp, unit, source, note, sort) VALUES (?,?,?,?,?,?,?)",
                    [(i, label, grp, "지수", "BLS (FRED)", note, k) for k, (i, label, grp, note) in enumerate(INDICATORS)])
    n = ok = 0
    for sid, label, *_ in INDICATORS:
        try:
            df = fred.series(sid)
        except Exception as e:  # noqa: BLE001 — 한 지수 실패가 전체를 막지 않게
            log(f"  ✗ {sid} {label}: {e}")
            continue
        df = df[df.date >= SINCE]
        con.execute("DELETE FROM price_snapshots WHERE kind='index' AND item=?", (sid,))
        con.executemany("INSERT INTO price_snapshots (date, kind, item, stat, value, n, detail) VALUES (?,?,?,?,?,?,?)",
                        [(d.strftime("%Y-%m-%d"), "index", sid, "value", float(v), None, "FRED") for d, v in zip(df.date, df.value)])
        n += len(df); ok += 1
    con.commit()
    log(f"  ✓ 가격지수 {ok}/{len(INDICATORS)}개 · {n}개월")
    return n
