"""전체 갱신: 시드 → 시계열 수집 → 매출 → 급등 탐지.

실행 (프로젝트 루트): .venv/bin/python -m etl.build [--skip-surge]
"""
import json
import sys
from datetime import datetime

from etl import breaks, census, curation, dart, dart_segment, estat, kcs, sec, seed, surge
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


def fetch_series(con):
    for sid, source, spec in con.execute("SELECT id, source, spec FROM series").fetchall():
        spec = json.loads(spec)
        try:
            if source == "census":
                df = census.fetch(spec["dataset"], spec["hs"], spec["filters"])
            elif source == "estat":
                df = estat.monthly_usd(spec["flow"], spec["hs9"], spec["offices"], spec.get("country"))
            elif source == "kcs":
                df = kcs.fetch(spec["api"], spec["hs"], spec.get("flow", "export"), spec.get("cnty"),
                               sido=spec.get("sido"), sgg=spec.get("sgg"))
            else:
                log(f"  ? {sid}: 지원하지 않는 source {source}")
                continue
        except Exception as e:  # noqa: BLE001 — 한 시리즈 실패가 전체를 막지 않게
            log(f"  ✗ {sid}: {e}")
            continue
        unit = df["unit"].iloc[0] if "unit" in df and len(df) else None
        con.execute("DELETE FROM observations WHERE series_id=?", (sid,))
        con.executemany("INSERT INTO observations (series_id, month, value_usd, qty) VALUES (?,?,?,?)",
                        [(sid, str(r.month), float(r.value_usd), float(r.qty) if "qty" in df and r.qty is not None and r.qty == r.qty else None)
                         for r in df.itertuples()])
        con.execute("UPDATE series SET last_month=?, unit=?, updated_at=? WHERE id=?",
                    (str(df["month"].max()) if len(df) else None, unit, datetime.now().isoformat(timespec="seconds"), sid))
        con.commit()
        log(f"  ✓ {sid}: {len(df)}개월 ~{df['month'].max() if len(df) else '-'}")


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
    con = connect()
    if curation.load(con):
        log("1) 큐레이션: data/curation.json 적용")
    else:
        log("1) 시드 → data/curation.json 생성"); apply_seed(con); curation.export(con)
    log("2) 시계열"); fetch_series(con)
    log("3) 분기 매출 (SEC·DART)"); fetch_financials(con)
    log("3-1) 통계 단절 탐지"); n = breaks.scan(con, log); con.commit(); log(f"  경고 {n}건")
    if "--skip-surge" not in sys.argv:
        log("4) 급등 탐지")
        tagged = sorted({h for (h,) in con.execute("SELECT hs_prefix FROM hs_tags WHERE length(hs_prefix)=6")})
        n = surge.scan(con, tagged, log)
        con.commit()
        log(f"  ✓ 급등 후보 {n}건")
    con.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('built_at', ?)", (datetime.now().isoformat(timespec="seconds"),))
    con.commit()


if __name__ == "__main__":
    main()
