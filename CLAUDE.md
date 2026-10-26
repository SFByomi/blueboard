# Yomin

글로벌 세관 무역 데이터(미국·일본·한국)로 AI·반도체 공급망 흐름을 추적해 미국/한국 종목에 매핑하는 사이트. 한국 투자자 대상, 한국어 UI.
기획: PLAN.md · 실행법: README.md
사이트 표시 이름은 **Investing Idea** (사용자의 텔레그램 채널명). 코드·DB 이름(yomin)은 그대로.

## 사용자·범위 (결정 사항)
- 한국 투자자 대상, AI·반도체 중심. 메모리 섹터에 삼성전자(DS 부문, 별도)·SK하이닉스(연결) 포함. 네오클라우드 그룹 = IREN·NBIS·CRWV. 보유/관심: MU, SNDK, LITE, BE, IREN, NBIS, RXRX, TXG, INSM, 두산(전자BG CCL), 삼성전기(MLCC). 비교군 FN.
- 주가는 사용자가 따로 봄. 매출 컨센서스는 무역 추정과의 괴리율로만 공개(원 금액은 로컬). 범위는 무역데이터 수집·검증·매핑·매출 추정.
- 작업 환경: 윈도우 PC, 맥북, claude.ai/code 클라우드 세션을 오가며 작업 → 모든 상태는 GitHub(SFByomi/blueboard)로 공유.

## 큐레이션 = data/curation.json (git이 원본)
- 종목·시리즈·매핑·HS태그는 `data/curation.json`이 원본. DB는 캐시라 언제든 재생성.
- 관리 페이지에서 수정 → 웹이 curation.json 자동 저장 → **작업 끝나면 commit·push** (다른 환경에서 pull 후 `etl.build`로 반영).
- 코드로 큐레이션을 바꿀 때도 DB 수정 후 `etl.curation.export` 또는 json 직접 수정 → commit.
- AI 랩 ARR·네오클라우드 계약 = `data/ai_labs.json` (OpenAI·Anthropic 연환산 매출 공개 수치 + IREN·NBIS·CRWV 계약 관계, 출처·상태(회사 발표/보도/추정) 포함). 빌드마다 ai_arr·ai_deals로 다시 읽음 → 업황 탭 'AI 랩 매출 규모', 네오클라우드 종목 'AI 랩 수요와의 연결'. 새 발표가 나오면 한 줄 추가.
- 영어 이름 = curation.json의 `series.label_en`·`companies.thesis_en` (영어 페이지·X 게시용). 새 종목·시리즈를 추가하면 같이 채운다 — 비면 한국어 label로 대체됨
- 공장 지도 = `data/plants.json` (회사·분야·좌표·상태·제품·연결 시리즈 id). 빌드마다 plants 테이블로 다시 읽음 → 웹 /plants. 좌표는 산업단지·도시 수준, 상태는 `asof` 월 기준으로 갱신.

## 구조
- `etl/` Python 수집기 → `data/yomin.db`(SQLite, git 미포함 — `python -m etl.build`로 재생성)
  - 큐레이션(companies·series·mappings·hs_tags)은 `seed.py`로 INSERT OR IGNORE → 이후 관리 페이지 편집이 우선
  - 소스: census.py(미국) · estat.py(일본, 엔→달러) · kcs.py(한국 관세청, 시군구) · sec.py/dart.py/dart_segment.py(매출)
  - surge.py 급등 탐지 · breaks.py 통계 단절 경고
  - **상관 모델(핵심 원칙: 어떤 품목이 매출과 직접 연결되는지 숫자로)**: scores.py가 빌드마다 모든 매핑을 분기 매출과 비교 → `flow_scores`(전년비 상관 0~2분기 선행·최근 8분기·등급 A~D). check.py로 개별 검증, discover.py로 HS×국가/주 후보 자동 탐색
  - **진행 분기 매출 추정**: estimates.py가 (가이던스 종목은 같은 분기 상관 0.7 이상 흐름의 진행 분기 전분기·전년비를 `guide.xcheck`로 교차 확인 — 모델엔 안 넣음) A·B 흐름으로 전년비·금액 회귀(+직전 4분기 편향 보정판) 중 백테스트 오차가 작은 모델을 골라 추정 → `revenue_estimates`(Supabase 누적: 추정·괴리율 추이). consensus.py가 야후 매출 컨센서스 수집 → `consensus`는 **재게시 금지라 로컬 전용**(publish.PRIVATE), 공개엔 괴리율만. 원 금액은 /admin/consensus
  - inflation.py 미국 CPI·PCE 구성요소 기여도(서비스·공산품·식품·에너지, FRED) → `inflation_contrib` · econ_calendar.py 주요 일정(BLS·BEA·FOMC·Census·한국 수출입·실적, 한국 시간) → `econ_events`. bls.gov는 자동 수집을 403으로 막아 `data/bls_schedule.json` 사본을 씀(연 1회 갱신) · macro.py 연준 총자산·TGA·역레포·지준·순유동성·M2·연방부채/M2·/GDP(FRED, 십억 달러) → `macro_obs`
  - **신용(공개 탭 /credit)**: credit.py 기업별 재무 신용 지표(SEC XBRL·DART, 네비우스는 20-F 외국 발행사라 6-K 분기 실적 보도자료 표에서: 총차입·현금·순부채/EBITDA·이자보상·1년 내 만기·FCF, 분기 + 최근 4분기 합; 한국 감가상각은 요약 API에 없어 정기보고서 XBRL 현금흐름표에서) → `credit_metrics` · market_credit.py 주가 내재 부도확률(머튼/KMV 간편식: 야후 주가 변동성 + 장부 부채 → 1년 거리·5년 누적 부도확률, 주가·시총은 저장 안 하고 파생값만) → `market_credit` — 내재 신용 스프레드(bp)도 시험했으나 실제 회사채 스프레드와 방향까지 어긋나(코어위브 6개월 실제 +540bp vs 모델 −260bp) 빼기로 함 · finra.py FINRA API 회사채 시장 집계(개인 Public 키로는 종목별 TRACE 불가, finra.org 화면 수집은 약관 금지 — 상승/하락 종목 수 등만, 필드 그대로 `finra_market`, 표시 시 "Source: FINRA") + 미 국채 곡선(FRED DGS → `macro_obs`). ICE BofA 스프레드(FRED)는 재게시 금지라 안 씀
  - **피어·지주사 할인(두산 종목 페이지)**: peers.py 대만 CCL 경쟁사 EMC(台光電)·TUC(台燿)·ITEQ(聯茂) 월매출·분기 재무·주가(FinMind 공개 API = 대만 MOPS 공시) → `peer_revenue`, 주간 EV/EBITDA(최근 4분기, 공시 기한 45/90일 뒤 반영) → `valuation` · 두산 지분가치 할인율 = 1 − 시총 ÷ (상장 자회사 지분 시가 + 비상장 장부가 − 별도 순차입금), 지분 수는 DART 타법인출자현황(반기·사업보고서만, 에너빌리티 옛 이름 두산중공업). 야후 주가로 계산하되 배수·비율만 저장
  - **상대국별 추이**: partners.py — 매핑된 무역 흐름(Census·관세청)의 같은 품목을 상대국별 월 금액으로(미국은 흐름의 주·세관 조건 유지·국가 조건만 뺌, 한국은 item_cty 전국 — 시군구 API엔 국가가 없음). 같은 조건은 하나로 묶고 최근 24개월 상위 10개국 + 기타 → `partner_keys`·`partner_flows` → 종목 화면 공급망 흐름 카드 안 '상대국별 추이'(누적 막대 + 최근 월 도넛, 나라 칩 빼기·추가). 관세청은 동시 호출에 잘 끊겨 순서대로. 일본 e-Stat·EU Comext는 아직
  - prices.py GPU 렌탈가(Vast.ai 온디맨드 매물 중앙값)·토큰 가격(OpenRouter ~latest 플래그십)·Nebius 스팟가(NBIS 공시 API, 지역별 → 하루 평균·최저, 최근 30일만 제공돼 매번 30일 백필) 일별 스냅샷 → `price_snapshots`. 과거 이력은 소스에 없어 Supabase에 누적(publish의 ACCUMULATE). Ornn·Silicon Data 지수는 재게시 금지 약관이라 링크만.
- `web/` Next.js 16 (App Router, Turbopack). **Next 16은 학습 데이터와 다름 → `web/node_modules/next/dist/docs/` 확인 후 작성.** params는 Promise.
  - 메뉴: 브리핑(/) · 종목 · 실적 추정(/earnings) · 업황(/prices) · 매크로(/macro) · 신용 · 무역 탐색(/surge) · 일정 (+ 공장 지도·소개). 모바일은 하단 막대(앞 4개 + 더보기 시트)
  - 영어 페이지(X 팔로워용): `/en`(실적 추정·스코어카드·공급망 급변·커버리지) · `/en/stocks/[ticker]` — `lib/en.ts`, 레이아웃 머리·꼬리는 `components/Lang.tsx`(OnlyLang)로 경로에 따라 한/영 전환. 선택 환경변수 `X_HANDLE`이면 영어 머리에 X 링크
  - 화면 원칙: 요약 먼저(숫자·한 줄 결론) → 근거는 접기(`Fold`)·정의/방법론은 카드 제목 옆 ⓘ(`InfoTip`)로. 공용 부품 `components/ui.tsx`(Card·CardHead·Stat·Badge·Fold·PageHead·SectionHead·Defs), 긴 페이지는 `SectionNav`(섹션 칩·스크롤 위치 강조), 같은 자리 차트 전환은 `SegTabs`
  - 종목 화면 순서: 한눈에(추정·최근 매출·핵심 흐름·밸류 타일 + 핵심 포인트) → 실적 추정 → 밸류에이션 → 공급망 흐름(연관도 표·관련 품목은 접기) → 신용 → 업황
- **밸류에이션(multiples.py)**: 배수 = EV(시가총액 + 순부채) ÷ 분기 실적 × 4. 흑자·이익률 10%↑·비경기순환이면 EV/영업이익, 그 밖(적자·저마진·메모리)은 EV/매출. 최근 12분기 분기 말 배수 밴드(상위 25%·중앙·하위 25%) × 진행 분기 추정(상단·추정·하단) → Best·Base·Worst 예상 시가총액(− 순부채)과 주가(÷ 주식 수). 배수 변동 큼(상위25/하위25 > 1.8)·최근 1년 중앙이 3년 중앙과 30% 넘게 다름(재평가)·지금 배수가 3년 하위10~상위10% 밖·추정 보류면 시나리오 대신 이유만 → `multiple_now`(Supabase 누적)·`multiple_hist`. 과거 시가총액 = 야후 현재 시총 × 분기 말 종가/현재가 × SEC 희석 주식 수 비율(야후 분할 기록으로 분할 보정). 부문 매출 종목(삼성전자 DS·두산 전자BG·삼성전기)은 제외. 야후 주가·시총은 저장·표시하지 않고 배수·우리 계산 시나리오·현재 대비 %만. 주가는 하루 한 번(데이터 갱신 때) 값이라 실시간 아님 → 계산에 쓴 주가 시각·종가/장중(px_time·px_date·px_kind)을 저장해 화면에 '○/○ 종가 기준'으로 표시. 예상 시가총액은 주가와 무관
- 분기 매출·영업이익(sec.py)은 분기 단독 공시가 없으면 연간 − 3개 분기, 같은 회계연도 누적(3·6·9·12개월) 차이로 복원(분사 기업 샌디스크 2023-09·2024-06 분기). scores.py는 그래도 빠진 분기를 빈 행으로 채워 위치 기반 전년비가 엉뚱한 분기와 짝지어지지 않게 함
- `verify/` 상관 검증 스크립트 (0단계)
- **자동 게시(X·텔레그램, 승인제)**: `web/src/lib/autopost/` — 후보(types.Candidate: earnings.ts 실적 결과·프리뷰, pick.ts 무역 TOP 3, prices.ts 주간 GPU 가격, 확인 필요 플래그) → draft.ts(Claude, 넘긴 숫자만·코드로 숫자 재검사) → chart.tsx(ImageResponse) → flow.ts(Supabase `autopost_drafts` 상태, 텔레그램 [게시][수정][버리기], X OAuth 1.0a·채널 게시). 경로 `/api/autopost/{cron,telegram,setup,preview}`, Vercel Cron 매일 08:30 KST. 키는 Vercel 환경변수만(README '자동 게시'). 게시 글엔 무역 흐름 숫자만 — 야후 주가·컨센서스 등 재게시 금지 데이터는 넘기지 않는다
- 공개 사이트: GitHub Actions(`.github/workflows/etl.yml`)가 매일 `etl.build` → `etl.publish`(SQLite→Supabase Postgres 전체 교체), Vercel(`web/`)이 `DATABASE_URL`로 읽음.
  - 웹 조회는 `web/src/lib/db.ts`의 `query()` 하나로 SQLite·Postgres 공용 → SQL은 양쪽 공통 문법, 파라미터 `?`.
  - `DATABASE_URL`이 있으면 관리 페이지·서버 액션 비활성(`ADMIN_ENABLED`). 큐레이션 수정은 로컬에서만 → curation.json push.

## 키
`.env`: CENSUS_API_KEY, ESTAT_APP_ID, DATA_GO_KR_KEY, DART_API_KEY, EIA_API_KEY, FINRA_API_CLIENT_ID/SECRET(시크릿 120일마다 만료) (+ 게시용 DATABASE_URL). Vercel: DATABASE_URL. 절대 커밋 금지. Actions에는 같은 이름의 저장소 Secrets.

## 데이터 소스 함정 (중요)
- Census: 키 필수. 수출(exports) API는 대량 조회가 매우 느림 → 품목 단위로. 큰 장(84)은 500 에러 → 자동 분할.
- HS 세번 분할/재분류가 실제로 자주 발생 (예: 3818000095→0091/0095, 2026-07; 미국 MLCC 2026-01 단가 단절) → 리스트 합산 + breaks.py 경고.
- e-Stat: 미공개 월을 0으로 반환. 일본 메모리칩은 요카이치가 아니라 関西空港·成田로 나감. 수량은 단위2(개수)일 수 있음. 전국 합계는 세관별 표 대신 品別国別表(spec offices `["全国"]`, 연도별 표를 목록에서 자동 탐색 — 세관 조건 없이 세관별 표를 부르면 시간 초과).
- 한국 관세청: 조회기간 1년 이내. 시군구 API는 `HsSgn`(대문자, HS6)+`sidoCd` 필수, 금액 천달러. 삼성전기 MLCC는 수원시(본사)로 신고.
- DART 부문매출(XBRL)은 2023년~, 누적값 → 분기 차이 계산, 내부거래 제거 member 제외.

## 검증된 핵심 매핑
- 두산 전자BG ↔ 충북 증평군 CCL 수출: 금액 상관 0.97, YoY 0.83
- Sandisk ↔ 간사이공항·나리타→말레이시아 메모리 수출 (Micron과는 무상관)
- Lumentum/Fabrinet ↔ 태국산 광통신장비 미국 수입 (업계 합산)

## 클라우드 세션
- 세션 시작 시 `.claude/settings.json` SessionStart 훅이 `scripts/cloud-session-start.sh` 실행 (CLAUDE_CODE_REMOTE=true일 때만): 의존성 설치·키 .env 반영·도메인 점검·DB 확인.
- 경고가 있으면 `cloud-setup` 스킬(.claude/skills/cloud-setup) 절차를 따른다.
