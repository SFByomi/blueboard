"""공급망 가격지수 — 생산자물가(PPI)·수출입 가격지수 (BLS, FRED 경유). 월별.

정의는 여기(코드)가 원본: 수집할 때마다 indicators 테이블을 이 목록으로 맞추고, 값은 price_snapshots
(kind='index', item=지수 id, stat='value', date=YYYY-MM-01)에 넣는다 → Supabase에 누적 게시.
새 지수 추가: INDICATORS에 한 줄(FRED 시리즈 ID) 또는 UNIT_PRICES에 한 줄(수량 있는 무역 시리즈의 단가).
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
# 무역 단가 지수 — 이미 수집한 시리즈의 금액/수량 (재게시 제약 없는 공개 통계로 만든 단가 사이클 지표)
# (id, 표시 이름, 그룹, 시리즈 id, 메모)
UNIT_PRICES = [
    ("UV_KR_DRAM", "한국 DRAM 수출 단가 ($/kg)", "메모리 단가", "kr_exp_dram", "한국 관세청 8542.32-1010 금액/중량"),
    ("UV_KR_HBM", "한국 HBM·복합칩 수출 단가 ($/kg)", "메모리 단가", "kr_exp_hbm", "한국 관세청 8542.32-3000"),
    ("UV_KR_FLASH", "한국 플래시 수출 단가 ($/kg)", "메모리 단가", "kr_exp_flash", "한국 관세청 플래시 메모리"),
    ("UV_US_TW_DRAM", "대만산 DRAM 미국 수입 단가 ($/개)", "메모리 단가", "us_imp_tw_dram", "Census 8542.32.0036 대만 금액/개수"),
    ("UV_US_SSD", "미국 SSD 수입 단가 ($/개)", "메모리 단가", "us_imp_all_ssd", "Census 8523.51 전체 금액/개수"),
    ("UV_KR_SERVER", "한국 처리장치(서버 본체) 수출 단가 ($/kg)", "서버·스토리지", "kr_exp_server", "한국 관세청 8471.50"),
    ("UV_KR_PCB", "한국 PCB 수출 단가 ($/kg)", "부품 단가", "kr_exp_pcb", "한국 관세청 8534"),
    ("UV_KR_MLCC", "한국 MLCC 수출 단가 ($/kg)", "부품 단가", "kr_exp_mlcc", "한국 관세청 8532.24"),
    ("UV_KR_CCL", "한국 CCL 수출 단가 ($/kg)", "부품 단가", "kr_exp_ccl", "한국 관세청 7410.21"),
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
    base = len(INDICATORS)
    con.executemany("INSERT INTO indicators (id, label, grp, unit, source, note, sort) VALUES (?,?,?,?,?,?,?)",
                    [(i, label, grp, "단가", "무역통계", note, base + k) for k, (i, label, grp, _, note) in enumerate(UNIT_PRICES)])
    for iid, label, _, sid, _ in UNIT_PRICES:
        rows = con.execute("SELECT month, value_usd / qty FROM observations WHERE series_id=? AND qty > 0 AND value_usd > 0 ORDER BY month", (sid,)).fetchall()
        con.execute("DELETE FROM price_snapshots WHERE kind='index' AND item=?", (iid,))
        con.executemany("INSERT INTO price_snapshots (date, kind, item, stat, value, n, detail) VALUES (?,?,?,?,?,?,?)",
                        [(f"{m}-01", "index", iid, "value", float(v), None, sid) for m, v in rows])
        n += len(rows); ok += bool(rows)
    con.commit()
    log(f"  ✓ 가격지수 {ok}/{len(INDICATORS) + len(UNIT_PRICES)}개 · {n}개월")
    return n
