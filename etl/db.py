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
CREATE TABLE IF NOT EXISTS plants (  -- 공장 지도 (data/plants.json이 원본, 빌드마다 다시 읽음) — 공장별 상태·제품·연결된 무역 흐름
  id INTEGER PRIMARY KEY, company TEXT NOT NULL, ticker TEXT, category TEXT NOT NULL, site TEXT NOT NULL, city TEXT, country TEXT,
  lat REAL NOT NULL, lon REAL NOT NULL, status TEXT, product TEXT, note TEXT, asof TEXT, flows TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  series_id TEXT NOT NULL, month TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT,
  PRIMARY KEY (series_id, month, kind)
);
CREATE TABLE IF NOT EXISTS indicators (          -- 가격지수 정의 (etl/indicators.py가 매번 덮어씀). 값은 price_snapshots(kind='index')
  id TEXT PRIMARY KEY, label TEXT NOT NULL, grp TEXT NOT NULL, unit TEXT, source TEXT, note TEXT, sort INTEGER DEFAULT 100
);
CREATE TABLE IF NOT EXISTS price_snapshots (   -- GPU 렌탈가·토큰 가격 일별 스냅샷 (etl/prices.py)
  date TEXT NOT NULL, kind TEXT NOT NULL,            -- kind: 'gpu' | 'token' | 'nebius' | 'index'
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
CREATE TABLE IF NOT EXISTS consensus (         -- 분기 매출 컨센서스 (etl/consensus.py, 야후). 재게시 금지 → 게시하지 않음(로컬 전용)
  date TEXT NOT NULL, ticker TEXT NOT NULL, period TEXT NOT NULL,   -- ticker = sec_ticker, period: 0q·+1q
  end_date TEXT, avg REAL, low REAL, high REAL, n INTEGER,
  PRIMARY KEY (date, ticker, period)
);
CREATE TABLE IF NOT EXISTS kr_share (   -- 미국 수입 중 한국산 비중 (3개월 합 기준, etl/surge.py)
  hs6 TEXT PRIMARY KEY, month TEXT, kr_usd REAL, world_usd REAL, share REAL, share_ago REAL, change REAL,
  spark TEXT                    -- 최근 24개월 3개월 이동 비중(%) JSON
);
CREATE TABLE IF NOT EXISTS earnings_calendar (  -- 다음 실적 발표 예정일 (etl/consensus.py, 야후 calendarEvents) — 사실 정보라 게시
  ticker TEXT PRIMARY KEY, next_date TEXT, updated TEXT, last_reported TEXT
);
CREATE TABLE IF NOT EXISTS earnings_reports ( -- 분기 실적 발표를 처음 확인한 날 (야후 earningsHistory) — 실적 검증의 '발표 전 고정' 기준, Supabase에 누적
  ticker TEXT NOT NULL, q_end TEXT NOT NULL, seen TEXT NOT NULL,
  PRIMARY KEY (ticker, q_end, seen)
);
CREATE TABLE IF NOT EXISTS revenue_estimates ( -- 무역 기반 진행 분기 매출 추정 일별 스냅샷 (etl/estimates.py) — Supabase에 누적
  date TEXT NOT NULL, ticker TEXT NOT NULL,
  q_start TEXT, q_end TEXT,                          -- 추정 대상 분기
  est REAL, low REAL, high REAL, yoy REAL,           -- 추정 매출·범위(±1σ)·예측 전년비
  last_actual REAL, months INTEGER,                  -- 직전 분기 실적, 반영된 무역 개월 수(흐름 중 최소)
  flows TEXT,                                        -- 사용 흐름 JSON [{sid, lag, yoy, se, r2, n, months}]
  mape REAL, mape_naive REAL, bt_n INTEGER, backtest TEXT,  -- 백테스트 평균 절대 오차 (모델 vs 직전 성장률 유지), 분기별 JSON
  cons_gap REAL, cons_end TEXT,                      -- 추정/컨센서스 − 1 (컨센 금액 자체는 게시 안 함)
  currency TEXT, method TEXT,                        -- method: yoy(전년비 회귀) | level(금액 회귀) — 백테스트로 선택
  PRIMARY KEY (date, ticker)
);
CREATE TABLE IF NOT EXISTS econ_events ( -- 주요 일정 (etl/econ_calendar.py) — 날짜·시각은 한국 시간, approx=1은 규칙·작년 기준 추정일
  date TEXT NOT NULL, time_kst TEXT, title TEXT NOT NULL, cat TEXT, country TEXT, source TEXT, ticker TEXT, approx INTEGER DEFAULT 0, note TEXT
);
CREATE TABLE IF NOT EXISTS credit_metrics ( -- 기업별 재무 신용 지표 (etl/credit.py): 분기 말 잔액 + 최근 4분기 합(_ttm). 원 통화
  ticker TEXT NOT NULL, q_end TEXT NOT NULL, currency TEXT,
  debt REAL, cash REAL, net_debt REAL, equity REAL, liabilities REAL, due_1y REAL,
  ebit_ttm REAL, ebitda_ttm REAL, interest_ttm REAL, interest_basis TEXT, ocf_ttm REAL, capex_ttm REAL, fcf_ttm REAL,
  PRIMARY KEY (ticker, q_end)
);
CREATE TABLE IF NOT EXISTS market_credit ( -- 주가 내재 신용위험 (etl/market_credit.py, Merton): 가격·시가총액은 저장 안 함(야후 재게시 금지)
  ticker TEXT NOT NULL, date TEXT NOT NULL, vol REAL, dd REAL, pd1 REAL, pd5 REAL, lev_mkt REAL,  -- 주가 변동성(연율)·부도거리(1년)·1년·5년(누적) 부도확률·부채/(시총+부채)
  PRIMARY KEY (ticker, date)
);
CREATE TABLE IF NOT EXISTS ai_arr ( -- AI 랩 연환산 매출(ARR) 공개 수치 (data/ai_labs.json이 원본, 빌드마다 다시 읽음)
  lab TEXT NOT NULL, date TEXT NOT NULL, usd_b REAL, kind TEXT, note TEXT, url TEXT,
  PRIMARY KEY (lab, date)
);
CREATE TABLE IF NOT EXISTS ai_deals ( -- 네오클라우드 ↔ AI 랩·빅테크 계약 (data/ai_labs.json)
  company TEXT NOT NULL, counterparty TEXT NOT NULL, date TEXT, value TEXT, status TEXT, link TEXT, note TEXT, url TEXT, sort INTEGER
);
CREATE TABLE IF NOT EXISTS peer_revenue ( -- 대만 CCL 경쟁사 월매출 (etl/peers.py, MOPS 공시 · FinMind), 대만달러
  ticker TEXT NOT NULL, month TEXT NOT NULL, revenue REAL,
  PRIMARY KEY (ticker, month)
);
CREATE TABLE IF NOT EXISTS valuation ( -- 배수·비율만 (etl/peers.py): 피어 ev_ebitda, 두산 stake_discount(지분가치 할인율)·listed_share·own_ev_ebitda. 주가·시총 원값은 저장 안 함
  ticker TEXT NOT NULL, date TEXT NOT NULL, metric TEXT NOT NULL, value REAL,
  PRIMARY KEY (ticker, date, metric)
);
CREATE TABLE IF NOT EXISTS multiple_hist ( -- 분기 말 연환산 배수 이력 (etl/multiples.py): ev_s = EV/매출, ev_ebit = EV/영업이익. 배수만 저장
  ticker TEXT NOT NULL, q_end TEXT NOT NULL, metric TEXT NOT NULL, value REAL,
  PRIMARY KEY (ticker, q_end, metric)
);
CREATE TABLE IF NOT EXISTS multiple_now ( -- 지금 배수(추정 기준)·3년 밴드·시나리오(약세/기준/강세: 배수·우리 계산 주가·현재 대비) 또는 생략 이유. 원 주가·시총은 저장 안 함
  date TEXT NOT NULL, ticker TEXT NOT NULL, metric TEXT, basis TEXT, tier TEXT, now REAL, now_trail REAL,
  p10 REAL, p25 REAL, p50 REAL, p75 REAL, p90 REAL, p50_1y REAL, n INTEGER, pct REAL, scen TEXT, reason TEXT, currency TEXT,
  px_time TEXT, px_date TEXT, px_kind TEXT, -- 계산에 쓴 주가의 시각(UTC)·거래소 현지 날짜·종가/장중
  PRIMARY KEY (date, ticker)
);
CREATE TABLE IF NOT EXISTS finra_market ( -- FINRA 회사채 시장 집계 (etl/finra.py): 숫자 필드를 이름 그대로
  dataset TEXT NOT NULL, date TEXT NOT NULL, category TEXT NOT NULL, field TEXT NOT NULL, value REAL,
  PRIMARY KEY (dataset, date, category, field)
);
CREATE TABLE IF NOT EXISTS macro_obs ( -- 거시 유동성 (etl/macro.py): 금액은 십억 달러, DEBT_* 는 배 · DGS*(국채 금리 %, etl/finra.py)
  series TEXT NOT NULL, date TEXT NOT NULL, value REAL,
  PRIMARY KEY (series, date)
);
CREATE TABLE IF NOT EXISTS inflation_contrib ( -- 미국 물가 구성요소 기여도 (etl/inflation.py): 막대 합 = total
  measure TEXT NOT NULL, basis TEXT NOT NULL, kind TEXT NOT NULL, month TEXT NOT NULL,  -- CPI|PCE · headline|core · yoy|mom
  total REAL, services REAL, goods REAL, food REAL, energy REAL, resid REAL,           -- 변화율·기여도(비율), resid = 비례 조정 전 차이
  PRIMARY KEY (measure, basis, kind, month)
);
CREATE TABLE IF NOT EXISTS oi_estimates ( -- 진행 분기 GAAP 영업이익 추정 일별 스냅샷 (etl/oi_estimates.py) — Supabase에 누적
  date TEXT NOT NULL, ticker TEXT NOT NULL, q_end TEXT,
  est REAL, margin REAL, rev_est REAL, last_q TEXT, last_oi REAL, last_margin REAL,  -- 추정 영업이익·영업이익률, 기준 매출 추정, 직전 확인 분기 말·실적
  method TEXT,                                       -- guide(회사 마진 가이던스 − 과거 차이) | naive(직전 분기 영업이익률 유지) | none
  mape REAL, mape_naive REAL, err_pts REAL, bt_n INTEGER, backtest TEXT,  -- 영업이익 백테스트 오차(%)·단순 유지 오차·영업이익률 기준 오차(%p)
  tier TEXT, caution TEXT, guide TEXT, currency TEXT,
  PRIMARY KEY (date, ticker)
);
"""


MIGRATIONS = [
    ("companies", "dart_fs TEXT"),                    # 한국 상장사: CFS(연결)/OFS(별도) — 있으면 DART에서 매출 수집
    ("financials", "currency TEXT DEFAULT 'USD'"),
    ("companies", "dart_segment TEXT"),               # 사업부문 매출 사용: "ElectroMaterialsBg" 또는 "Component:Separate"
    ("financials", "basis TEXT"),                     # 매출 기준 표시 (예: "ElectroMaterialsBg 부문")
    ("companies", "grp TEXT"),                        # 섹터 그룹 (종목 목록 묶음): 메모리·광통신·서버/네트워크·전력/냉각·AI 클라우드·기타
    ("companies", "sites TEXT"),                      # 생산거점 JSON: [{"name","country","what"}] — 종목 페이지 공급망 요약
    ("revenue_estimates", "reliable INTEGER"),        # 1 = 신뢰 (etl/estimates.reliability)
    ("revenue_estimates", "caution TEXT"),            # 신뢰가 아닌 이유 JSON 목록
    ("earnings_calendar", "last_reported TEXT"),
    ("revenue_estimates", "conf REAL"),               # 신뢰도: 백테스트 적중(±5%) 비율, 표본 보정
    ("revenue_estimates", "hits INTEGER"),            # 백테스트 적중 분기 수
    ("revenue_estimates", "tier TEXT"),
    ("revenue_estimates", "guide TEXT"),
    ("multiple_now", "px_time TEXT"),                 # 밸류에이션 계산에 쓴 주가 시각(UTC) · 거래소 현지 날짜 · 종가/장중 (etl/multiples.py)
    ("multiple_now", "px_date TEXT"),
    ("multiple_now", "px_kind TEXT"),
    ("earnings_calendar", "next_basis TEXT"),          # 발표 예정일 근거: NULL = 야후 확정 일정, 아니면 '작년 같은 분기 … 기준 추정' 등              # 진행 분기 회사 가이던스 JSON {low, high, filed, beat, prelim} (etl/guidance.py)               # 신뢰 / 보통 / 참고      # 실적 발표가 끝난 마지막 분기 말일 (야후 earningsHistory)
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
