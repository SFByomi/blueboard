"""SQLite 스키마. 웹(Next.js)과 ETL(Python)이 같은 data/yomin.db를 공유한다.

- 큐레이션 테이블(companies, series, mappings, hs_tags)은 관리자 페이지에서 편집 → ETL은 덮어쓰지 않음
- 데이터 테이블(observations, financials, surge)은 ETL이 갱신
"""
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "yomin.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
  ticker TEXT PRIMARY KEY, name TEXT NOT NULL, name_ko TEXT, market TEXT, sector TEXT,
  thesis TEXT, sec_ticker TEXT, fy_note TEXT, sort INTEGER DEFAULT 100
);
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, source TEXT NOT NULL,   -- census | estat
  reporter TEXT, flow TEXT, region TEXT, hs TEXT, partner TEXT,
  spec TEXT NOT NULL,                                                -- 수집 파라미터 JSON
  unit TEXT, last_month TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS observations (
  series_id TEXT NOT NULL, month TEXT NOT NULL, value_usd REAL, qty REAL,
  PRIMARY KEY (series_id, month)
);
CREATE TABLE IF NOT EXISTS mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL, series_id TEXT NOT NULL,
  role TEXT NOT NULL, confidence TEXT NOT NULL, rationale TEXT, caveat TEXT,
  include_in_total INTEGER DEFAULT 1, sort INTEGER DEFAULT 100,
  UNIQUE (ticker, series_id)
);
CREATE TABLE IF NOT EXISTS financials (
  ticker TEXT NOT NULL, period_end TEXT NOT NULL, period_start TEXT, revenue REAL,
  PRIMARY KEY (ticker, period_end)
);
CREATE TABLE IF NOT EXISTS hs_tags (
  hs_prefix TEXT NOT NULL, ticker TEXT NOT NULL, note TEXT,
  PRIMARY KEY (hs_prefix, ticker)
);
CREATE TABLE IF NOT EXISTS hs_names (hs TEXT PRIMARY KEY, name_en TEXT, name_ko TEXT);
CREATE TABLE IF NOT EXISTS surge (
  scope TEXT NOT NULL,          -- 'us_imp_world' | 'us_exp_world' | 'us_imp_cty'
  hs6 TEXT NOT NULL, partner TEXT NOT NULL DEFAULT '-', partner_name TEXT,
  month TEXT NOT NULL, value_usd REAL, mom REAL, yoy REAL, yoy3m REAL, z REAL,
  spark TEXT,                   -- 최근 24개월 JSON
  PRIMARY KEY (scope, hs6, partner)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS alerts (
  series_id TEXT NOT NULL, month TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT,
  PRIMARY KEY (series_id, month, kind)
);
CREATE TABLE IF NOT EXISTS indicators (          -- 가격지수 정의 (etl/indicators.py가 매번 덮어씀). 값은 price_snapshots(kind='index')
  id TEXT PRIMARY KEY, label TEXT NOT NULL, grp TEXT NOT NULL, unit TEXT, source TEXT, note TEXT, sort INTEGER DEFAULT 100
);
CREATE TABLE IF NOT EXISTS price_snapshots (   -- GPU 렌탈가·토큰 가격 일별 스냅샷 (etl/prices.py)
  date TEXT NOT NULL, kind TEXT NOT NULL,            -- kind: 'gpu' | 'token'
  item TEXT NOT NULL, stat TEXT NOT NULL,            -- gpu: 'H100 SXM' / median·p25 · token: 'Opus' / input·output
  value REAL, n INTEGER, detail TEXT,                -- n: GPU 수(매물 기준) · detail: 실제 모델 ID 등
  PRIMARY KEY (date, kind, item, stat)
);
CREATE TABLE IF NOT EXISTS flow_scores (       -- 매핑별 매출 상관 점수 (etl/scores.py가 매 빌드 덮어씀)
  ticker TEXT NOT NULL, series_id TEXT NOT NULL,
  n INTEGER, n_yoy INTEGER,                          -- 금액·전년비 비교 분기 수
  level REAL, yoy0 REAL, yoy1 REAL, yoy2 REAL,       -- 금액 상관, 전년비 상관(무역 0·1·2분기 선행)
  best REAL, best_lag INTEGER, recent REAL,          -- 최고 전년비 상관·선행 분기, 최근 8분기 상관
  grade TEXT,                                        -- A·B·C·D (표본 부족은 NULL)
  PRIMARY KEY (ticker, series_id)
);
"""


MIGRATIONS = [
    ("companies", "dart_fs TEXT"),                    # 한국 상장사: CFS(연결)/OFS(별도) — 있으면 DART에서 매출 수집
    ("financials", "currency TEXT DEFAULT 'USD'"),
    ("companies", "dart_segment TEXT"),               # 사업부문 매출 사용: "ElectroMaterialsBg" 또는 "Component:Separate"
    ("financials", "basis TEXT"),                     # 매출 기준 표시 (예: "ElectroMaterialsBg 부문")
    ("companies", "grp TEXT"),                        # 섹터 그룹 (종목 목록 묶음): 메모리·광통신·서버/네트워크·전력/냉각·AI 클라우드·기타
    ("companies", "sites TEXT"),                      # 생산거점 JSON: [{"name","country","what"}] — 종목 페이지 공급망 요약
]


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=60)  # 웹/다른 ETL이 쓰는 중이면 최대 60초 대기
    con.execute("PRAGMA journal_mode=WAL")  # 웹이 읽는 중에도 ETL 쓰기 가능
    con.executescript(SCHEMA)
    for table, col in MIGRATIONS:  # 기존 DB에 컬럼 추가
        if col.split()[0] not in [r[1] for r in con.execute(f"PRAGMA table_info({table})")]:
            con.execute(f"ALTER TABLE {table} ADD COLUMN {col}")
    return con
