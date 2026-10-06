# Yomin

글로벌 세관 무역 데이터(미국·일본·한국)를 미국/한국 종목에 매핑해 실적을 먼저 읽는 사이트. 한국 투자자 대상, 한국어 UI.
기획: PLAN.md · 실행법: README.md
사이트 표시 이름은 **Investing Idea** (사용자의 텔레그램 채널명). 코드·DB 이름(yomin)은 그대로.

## 사용자·범위 (결정 사항)
- 한국 투자자 대상, AI·반도체 중심. 보유/관심: MU, SNDK, LITE, BE, IREN, NBIS, RXRX, TXG, INSM, 두산(전자BG CCL), 삼성전기(MLCC). 비교군 FN.
- 주가·컨센서스는 사용자가 따로 봄 → 이 프로젝트 범위는 무역데이터 수집·검증·매핑.
- 작업 환경: 윈도우 PC, 맥북, claude.ai/code 클라우드 세션을 오가며 작업 → 모든 상태는 GitHub(SFByomi/blueboard)로 공유.

## 큐레이션 = data/curation.json (git이 원본)
- 종목·시리즈·매핑·HS태그는 `data/curation.json`이 원본. DB는 캐시라 언제든 재생성.
- 관리 페이지에서 수정 → 웹이 curation.json 자동 저장 → **작업 끝나면 commit·push** (다른 환경에서 pull 후 `etl.build`로 반영).
- 코드로 큐레이션을 바꿀 때도 DB 수정 후 `etl.curation.export` 또는 json 직접 수정 → commit.

## 구조
- `etl/` Python 수집기 → `data/yomin.db`(SQLite, git 미포함 — `python -m etl.build`로 재생성)
  - 큐레이션(companies·series·mappings·hs_tags)은 `seed.py`로 INSERT OR IGNORE → 이후 관리 페이지 편집이 우선
  - 소스: census.py(미국) · estat.py(일본, 엔→달러) · kcs.py(한국 관세청, 시군구) · sec.py/dart.py/dart_segment.py(매출)
  - surge.py 급등 탐지 · breaks.py 통계 단절 경고
  - **상관 모델(핵심 원칙: 어떤 품목이 매출과 직접 연결되는지 숫자로)**: scores.py가 빌드마다 모든 매핑을 분기 매출과 비교 → `flow_scores`(전년비 상관 0~2분기 선행·최근 8분기·등급 A~D). check.py로 개별 검증, discover.py로 HS×국가/주 후보 자동 탐색
  - prices.py GPU 렌탈가(Vast.ai 온디맨드 매물 중앙값)·토큰 가격(OpenRouter ~latest 플래그십) 일별 스냅샷 → `price_snapshots`. 과거 이력은 소스에 없어 Supabase에 누적(publish의 ACCUMULATE). Ornn·Silicon Data 지수는 재게시 금지 약관이라 링크만.
- `web/` Next.js 16 (App Router, Turbopack). **Next 16은 학습 데이터와 다름 → `web/node_modules/next/dist/docs/` 확인 후 작성.** params는 Promise.
- `verify/` 상관 검증 스크립트 (0단계)
- 공개 사이트: GitHub Actions(`.github/workflows/etl.yml`)가 매일 `etl.build` → `etl.publish`(SQLite→Supabase Postgres 전체 교체), Vercel(`web/`)이 `DATABASE_URL`로 읽음.
  - 웹 조회는 `web/src/lib/db.ts`의 `query()` 하나로 SQLite·Postgres 공용 → SQL은 양쪽 공통 문법, 파라미터 `?`.
  - `DATABASE_URL`이 있으면 관리 페이지·서버 액션 비활성(`ADMIN_ENABLED`). 큐레이션 수정은 로컬에서만 → curation.json push.

## 키
`.env`: CENSUS_API_KEY, ESTAT_APP_ID, DATA_GO_KR_KEY, DART_API_KEY (+ 게시용 DATABASE_URL). 절대 커밋 금지. Actions에는 같은 이름의 저장소 Secrets.

## 데이터 소스 함정 (중요)
- Census: 키 필수. 수출(exports) API는 대량 조회가 매우 느림 → 품목 단위로. 큰 장(84)은 500 에러 → 자동 분할.
- HS 세번 분할/재분류가 실제로 자주 발생 (예: 3818000095→0091/0095, 2026-07; 미국 MLCC 2026-01 단가 단절) → 리스트 합산 + breaks.py 경고.
- e-Stat: 미공개 월을 0으로 반환. 일본 메모리칩은 요카이치가 아니라 関西空港·成田로 나감. 수량은 단위2(개수)일 수 있음.
- 한국 관세청: 조회기간 1년 이내. 시군구 API는 `HsSgn`(대문자, HS6)+`sidoCd` 필수, 금액 천달러. 삼성전기 MLCC는 수원시(본사)로 신고.
- DART 부문매출(XBRL)은 2023년~, 누적값 → 분기 차이 계산, 내부거래 제거 member 제외.

## 검증된 핵심 매핑
- 두산 전자BG ↔ 충북 증평군 CCL 수출: 금액 상관 0.97, YoY 0.83
- Sandisk ↔ 간사이공항·나리타→말레이시아 메모리 수출 (Micron과는 무상관)
- Lumentum/Fabrinet ↔ 태국산 광통신장비 미국 수입 (업계 합산)

## 클라우드 세션
- 세션 시작 시 `.claude/settings.json` SessionStart 훅이 `scripts/cloud-session-start.sh` 실행 (CLAUDE_CODE_REMOTE=true일 때만): 의존성 설치·키 .env 반영·도메인 점검·DB 확인.
- 경고가 있으면 `cloud-setup` 스킬(.claude/skills/cloud-setup) 절차를 따른다.
