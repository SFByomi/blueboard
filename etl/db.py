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
"""


MIGRATIONS = [
    ("companies", "dart_fs TEXT"),                    # 한국 상장사: CFS(연결)/OFS(별도) — 있으면 DART에서 매출 수집
    ("financials", "currency TEXT DEFAULT 'USD'"),
    ("companies", "dart_segment TEXT"),               # 사업부문 매출 사용: "ElectroMaterialsBg" 또는 "Component:Separate"
    ("financials", "basis TEXT"),                     # 매출 기준 표시 (예: "ElectroMaterialsBg 부문")
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
