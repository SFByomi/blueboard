"""전체 갱신: 시드 → 시계열 수집 → 매출 → 급등 탐지.

실행 (프로젝트 루트): .venv/bin/python -m etl.build [--skip-surge]
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from etl import breaks, consensus, curation, dart, dart_segment, estimates, guidance, indicators, prices, scores, sec, sec6k, seed, sources, surge
from etl.db import connect


def log(msg):
    print(msg, flush=True)


def apply_seed(con):
    con.executemany("INSERT OR IGNORE INTO companies (ticker, name, name_ko, market, sector, thesis, sec_ticker, fy_note, sort) "
                    "VALUES (?,?,?,?,?,?,?,?,?)", seed.COMPANIES)
    con.executemany("INSERT OR IGNORE INTO series (id, label, source, reporter, flow, region, hs, partner, spec) VALUES (?,?,?,?,?,?,?,?,?)",
                    [(k, *v[:7], json.dumps(v[7], ensure_ascii=False)) for k, v in seed.SERIES.items()])
    con.executemany("INSERT OR IGNORE INTO mappings (ticker, series_id, role, confidence, rationale, caveat, include_in_total, sort) "
                    "VALUES (?,?,?,?,?,?,?,?)", seed.MAPPINGS)
    con.executemany("UPDATE companies SET dart_fs=? WHERE ticker=? AND dart_fs IS NULL", [(v, k) for k, v in seed.DART_FS.items()])
    con.executemany("UPDATE companies SET dart_segment=? WHERE ticker=? AND dart_segment IS NULL", [(v, k) for k, v in seed.DART_SEGMENT.items()])
    con.executemany("INSERT OR IGNORE INTO hs_tags (hs_prefix, ticker, note) VALUES (?,?,?)", seed.HS_TAGS)
    con.executemany("INSERT INTO hs_names (hs, name_ko) VALUES (?,?) ON CONFLICT(hs) DO UPDATE SET name_ko=excluded.name_ko",
                    list(seed.HS_NAMES_KO.items()))
    con.commit()


PARALLEL = {"census"}  # 동시 호출해도 되는 소스 (관세청은 연결 끊김이 잦아 순차, e-Stat은 환율 캐시 공유)


def fetch_series(con):
    rows = con.execute("SELECT id, source, spec FROM series").fetchall()
    with ThreadPoolExecutor(6) as pool:  # Census 수출 조회는 건당 15~40초 → 병렬로 받고 DB 쓰기는 이 스레드에서
        futs = {pool.submit(sources.fetch, src, json.loads(spec)): sid for sid, src, spec in rows if src in PARALLEL}
        for f in as_completed(futs):
            save_series(con, futs[f], f)
    for sid, src, spec in rows:
        if src not in PARALLEL:
            save_series(con, sid, lambda src=src, spec=spec: sources.fetch(src, json.loads(spec)))


def save_series(con, sid, job):
    """job: 완료된 Future 또는 호출하면 DataFrame을 돌려주는 함수"""
    try:
        df = job.result() if hasattr(job, "result") else job()
    except Exception as e:  # noqa: BLE001 — 한 시리즈 실패가 전체를 막지 않게
        log(f"  ✗ {sid}: {e}")
        return
    unit = df["unit"].iloc[0] if "unit" in df and len(df) else None
    con.execute("DELETE FROM observations WHERE series_id=?", (sid,))
    con.executemany("INSERT INTO observations (series_id, month, value_usd, qty) VALUES (?,?,?,?)",
                    [(sid, str(r.month), float(r.value_usd), float(r.qty) if "qty" in df and r.qty is not None and r.qty == r.qty else None)
                     for r in df.itertuples()])
    con.execute("UPDATE series SET last_month=?, unit=?, updated_at=? WHERE id=?",
                (str(df["month"].max()) if len(df) else None, unit, datetime.now().isoformat(timespec="seconds"), sid))
    con.commit()
    log(f"  ✓ {sid}: {len(df)}개월 ~{df['month'].max() if len(df) else '-'}")


def apply_hs_names_ko(con):
    """data/hs_names_ko.json(git 원본)의 HS6 한국어 품목명 적용. seed의 짧은 이름이 있으면 그걸 유지."""
    path = curation.PATH.parent / "hs_names_ko.json"
    if not path.exists():
        return
    names = json.loads(path.read_text(encoding="utf-8"))
    con.executemany("INSERT INTO hs_names (hs, name_ko) VALUES (?,?) ON CONFLICT(hs) DO UPDATE SET name_ko=coalesce(hs_names.name_ko, excluded.name_ko)",
                    list(names.items()))
    missing = [h for (h,) in con.execute("SELECT DISTINCT s.hs6 FROM surge s LEFT JOIN hs_names n ON n.hs=s.hs6 WHERE n.name_ko IS NULL")]
    if missing:  # 새로 급등 목록에 들어온 품목 — hs_names_ko.json에 추가할 것 (그 전까진 영문 표시)
        log(f"  한국어 품목명 없음 {len(missing)}개: {', '.join(missing[:20])}{' …' if len(missing) > 20 else ''}")


def fetch_financials(con):
    targets = con.execute("SELECT ticker, sec_ticker, dart_fs, dart_segment FROM companies "
                          "WHERE sec_ticker IS NOT NULL OR dart_fs IS NOT NULL OR dart_segment IS NOT NULL").fetchall()
    for ticker, sec_ticker, dart_fs, dart_seg in targets:
        basis = None
        try:
            if dart_seg:
                kw, _, scope = dart_seg.partition(":")
                q, cur = dart_segment.quarterly_segment_revenue(ticker.split(".")[0], kw, scope or "Consolidated"), "KRW"
                basis = f"{kw} 부문{' (별도)' if scope == 'Separate' else ''}"
            elif dart_fs:
                q, cur = dart.quarterly_revenue(ticker.split(".")[0], dart_fs), "KRW"
                basis = "별도" if dart_fs == "OFS" else "연결"
            elif sec_ticker in sec6k.FILERS:  # 20-F 제출 외국 기업 — 분기 매출은 6-K 보도자료에서
                q, cur = sec6k.quarterly_revenue(sec_ticker), sec6k.FILERS[sec_ticker]["currency"]
            else:
                q, cur = sec.quarterly_revenue(sec_ticker), "USD"
        except Exception as e:  # noqa: BLE001
            log(f"  ✗ 매출 {ticker}: {e}")
            continue
        con.execute("DELETE FROM financials WHERE ticker=?", (ticker,))
        con.executemany("INSERT INTO financials (ticker, period_end, period_start, revenue, currency, basis) VALUES (?,?,?,?,?,?)",
                        [(ticker, r.end.strftime("%Y-%m-%d"), r.start.strftime("%Y-%m-%d"), float(r.revenue), cur, basis) for r in q.itertuples()])
        con.commit()
        log(f"  ✓ 매출 {ticker}: {len(q)}분기 ({cur}{', ' + basis if basis else ''})")


def main():
    t0 = time.time()
    step = lambda msg: log(f"{msg}  [{time.time() - t0:.0f}s]")  # noqa: E731 — 단계별 경과 시간 (Actions 지연 진단용)
    con = connect()
    if curation.load(con):
        log("1) 큐레이션: data/curation.json 적용")
    else:
        log("1) 시드 → data/curation.json 생성"); apply_seed(con); curation.export(con)
    step("2) 시계열"); fetch_series(con)
    step("3) 분기 매출 (SEC·DART)"); fetch_financials(con)
    step("3-1) 통계 단절 탐지"); n = breaks.scan(con, log); con.commit(); log(f"  경고 {n}건")
    step("3-2) 매출 상관 점수"); scores.score_all(con, log); con.commit()
    step("3-3) 컨센서스 (로컬 전용)"); consensus.collect(con, log); con.commit()
    step("3-4) 회사 매출 가이던스 (실적 보도자료)")
    guidance.collect([t for (t,) in con.execute("SELECT sec_ticker FROM companies WHERE sec_ticker IS NOT NULL ORDER BY sec_ticker")], log)
    step("3-5) 진행 분기 매출 추정·백테스트"); estimates.estimate_all(con, log); con.commit()
    if "--skip-surge" not in sys.argv:
        step("4) 급등 탐지")
        tagged = sorted({h for (h,) in con.execute("SELECT hs_prefix FROM hs_tags WHERE length(hs_prefix)=6")})
        n = surge.scan(con, tagged, log)
        con.commit()
        log(f"  ✓ 급등 후보 {n}건")
    apply_hs_names_ko(con); con.commit()
    step("5) GPU 렌탈가·토큰 가격"); prices.collect(con, log)
    step("6) 가격지수 (PPI·수출입 가격)"); indicators.collect(con, log)
    con.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('built_at', ?)", (datetime.now().isoformat(timespec="seconds"),))
    con.commit()
    step("완료")


if __name__ == "__main__":
    main()
