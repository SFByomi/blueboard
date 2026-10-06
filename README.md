# Yomin

글로벌 세관 무역 데이터(미국·일본·한국)로 AI·반도체 공급망 흐름을 추적하고 종목에 매핑하는 사이트. 기획은 [PLAN.md](PLAN.md).

## 구조

```
etl/        Python 수집기 → data/yomin.db (SQLite)
  census.py   미국 Census 무역 API (세관구역·주·HS10·수량)
  estat.py    일본 e-Stat 세관별 무역통계 (세관지서·HS9·수량, 엔→달러 환산)
  kcs.py      한국 관세청 (품목·품목×국가·시군구×품목)
  sec.py      SEC EDGAR 분기 매출 (미국)
  dart.py     OpenDART 분기 매출 (한국, 연결/별도)
  surge.py    급등 탐지 (미국 HS6 세계 합계 + 관심 품목 국가별)
  seed.py     초기 종목·시리즈·매핑 (이후엔 관리 페이지에서 편집)
  build.py    전체 갱신 실행
web/        Next.js 16 사이트 (급등 탐색 / 종목 / 관리)
verify/     0단계 상관 검증 스크립트 → reports/
```

## 처음 세팅 (새 PC)

```bash
cp .env.example .env   # 키 4개 채우기
bash scripts/setup.sh  # 맥·리눅스: venv + pip + npm 설치

# 윈도우
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
npm --prefix web install
```

## 실행

```bash
# 1) 데이터 갱신 (첫 실행 5~10분, 이후 캐시) — 윈도우는 .venv/Scripts/python
.venv/bin/python -m etl.build

# 2) 사이트
npm --prefix web run dev   # http://localhost:3000
```

관리 페이지(`/admin`)에서 종목 추가, 무역 흐름 연결(역할·신뢰도·근거), 품목→종목 태그, 데이터 갱신 버튼을 쓸 수 있습니다.

## 키 (.env)

| 키 | 용도 | 발급 |
|---|---|---|
| `CENSUS_API_KEY` | 미국 무역 | api.census.gov/data/key_signup.html |
| `ESTAT_APP_ID` | 일본 무역 | e-stat.go.jp 마이페이지 → API 기능 |
| `DATA_GO_KR_KEY` | 한국 관세청 (품목·국가·시군구) | data.go.kr — API별 활용신청 필요 |
| `DART_API_KEY` | 한국 상장사 분기 매출 | opendart.fss.or.kr |

## 공개 사이트 (배포)

**https://buywhenitgoesup.vercel.app** (Vercel 프로덕션 — `main` push 시 자동 배포)

```
GitHub Actions (매일 06:17 KST)                     Vercel (web/, 서울 리전)
  etl.build  → data/yomin.db (SQLite, 캐시 유지)       DATABASE_URL 있으면 Postgres 읽기
  etl.publish → Supabase Postgres (전체 교체) ───────→  관리 페이지 404 · 요청마다 렌더
```

- 큐레이션 원본은 계속 `data/curation.json`: 로컬 관리 페이지에서 수정 → commit·push → Actions가 바로 수집·게시
- 웹은 `DATABASE_URL`이 없으면 지금처럼 `../data/yomin.db`(SQLite)를 읽고 관리 페이지가 켜짐 (로컬 작업용)
- 수동 게시: `.env`에 `DATABASE_URL` 넣고 `.venv/bin/python -m etl.publish`

### 처음 한 번 설정
1. **Supabase**: 새 프로젝트(리전 Seoul) → Connect → **Transaction pooler** 주소(포트 6543)를 복사, `[YOUR-PASSWORD]` 자리에 DB 비밀번호
2. **GitHub** 저장소 → Settings → Secrets and variables → Actions → New repository secret:
   `CENSUS_API_KEY`, `ESTAT_APP_ID`, `DATA_GO_KR_KEY`, `DART_API_KEY`, `DATABASE_URL`
3. **GitHub Actions** 탭 → "데이터 갱신" → Run workflow (첫 실행 20~40분)
4. **Vercel**: Add New Project → `blueboard` 가져오기 → Root Directory `web` → Environment Variables에 `DATABASE_URL` → Deploy

테이블은 `public` 스키마에 만들고 RLS를 켜 둔다(Supabase REST API로는 접근 불가, 웹·ETL은 DB 직접 접속).
