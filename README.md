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
web/        Next.js 16 사이트 (브리핑 / 종목 / 실적 추정 / 업황 / 매크로 / 신용 / 무역 탐색 / 일정 / 관리)
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
| `EIA_API_KEY` | 미국 주별 전력 판매(데이터센터 수요) | eia.gov/opendata/register.php |

## 공개 사이트 (배포)

**https://buywhenitgoesup.vercel.app** (Vercel 프로덕션 — `main` push 시 자동 배포)

```
GitHub Actions (매일 03:43 KST 예약)                     Vercel (web/, 서울 리전)
  etl.build  → data/yomin.db (SQLite, 캐시 유지)       DATABASE_URL 있으면 Postgres 읽기
  etl.publish → Supabase Postgres (전체 교체) ───────→  관리 페이지 404 · 요청마다 렌더
```

- 큐레이션 원본은 계속 `data/curation.json`: 로컬 관리 페이지에서 수정 → commit·push → Actions가 바로 수집·게시
- 웹은 `DATABASE_URL`이 없으면 지금처럼 `../data/yomin.db`(SQLite)를 읽고 관리 페이지가 켜짐 (로컬 작업용)
- 수동 게시: `.env`에 `DATABASE_URL` 넣고 `.venv/bin/python -m etl.publish`

### 처음 한 번 설정
1. **Supabase**: 새 프로젝트(리전 Seoul) → Connect → **Transaction pooler** 주소(포트 6543)를 복사, `[YOUR-PASSWORD]` 자리에 DB 비밀번호
2. **GitHub** 저장소 → Settings → Secrets and variables → Actions → New repository secret:
   `CENSUS_API_KEY`, `ESTAT_APP_ID`, `DATA_GO_KR_KEY`, `DART_API_KEY`, `EIA_API_KEY`, `DATABASE_URL`
3. **GitHub Actions** 탭 → "데이터 갱신" → Run workflow (첫 실행 20~40분)
4. **Vercel**: Add New Project → `blueboard` 가져오기 → Root Directory `web` → Environment Variables에 `DATABASE_URL` → Deploy

테이블은 `public` 스키마에 만들고 RLS를 켜 둔다(Supabase REST API로는 접근 불가, 웹·ETL은 DB 직접 접속).

## X·텔레그램 자동 게시 (승인제)

매일 08:30 KST Vercel Cron → 공급망 흐름 TOP 3 초안 → 텔레그램으로 나에게 **[게시][수정][버리기]** → 게시를 누르면 X(영어)·텔레그램 채널 `@buywhenitgoesup`(한국어)에 차트와 함께 올라감. 코드: `web/src/lib/autopost/`, `web/src/app/api/autopost/`.

- **TOP 3**: 홈 '공급망 모멘텀'과 같은 숫자(`lib/signals.ts`) 중 최근 3개월 전년비 절댓값이 큰 회사 고유 흐름(업황 대리 흐름 제외, 같은 흐름 쓰는 종목은 합침)
- **확인 필요 표시**: 전년비 200% 초과(사이트의 `*`, 기저효과 가능), 기준월이 3개월 넘게 지남, 매출 비교 표본 8분기 미만, 매출 연관도 C·D
- **초안**: Claude API(`claude-opus-5-5`, 구조화 출력)에 미리 포맷한 숫자만 넘김. 결과를 코드로 다시 검사해 넘겨주지 않은 숫자·출처/기준월 누락·X 280자 초과를 경고하고, "Not investment advice / 투자 권유 아님"은 빠지면 자동으로 붙임. 정책상 거절되면 서버 기본 대체 모델로 재시도(`fallbacks: "default"`)
- **같은 TOP 3·기준월이면 다시 보내지 않음** (무역 데이터는 월 단위라 매일 바뀌지 않음). 상태는 Supabase `autopost_drafts` 테이블(웹이 만들고 RLS 켬, ETL 게시와 무관)
- **수정**: [수정] → 봇 안내 메시지에 답장으로 `EN: …` / `KO: …` (한쪽만 가능). **게시**는 두 번 눌러도 한 번만, 한쪽만 실패하면 다시 눌러 나머지만 올림

### 처음 한 번 설정 (키는 Vercel 환경변수에만 — 코드·채팅에 붙이지 않기)
1. 텔레그램 @BotFather → 새 봇 → 토큰. 봇을 채널 `@buywhenitgoesup` 관리자로 추가(메시지 게시 권한). 봇에게 아무 말이나 보낸 뒤 내 chat_id 확인(@userinfobot 등)
2. X Developer Portal → 앱 권한 **Read and write** → API Key/Secret, Access Token/Secret(권한 변경 후 재발급)
3. Vercel → Settings → Environment Variables (Production):
   `ANTHROPIC_API_KEY`, `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`(임의 긴 문자열, 영문·숫자·`_-`), `CRON_SECRET`(임의 긴 문자열) — 선택 `TELEGRAM_CHANNEL`(기본 `@buywhenitgoesup`)
4. 재배포 후 웹훅 등록 한 번: `curl -H "Authorization: Bearer <CRON_SECRET>" https://buywhenitgoesup.vercel.app/api/autopost/setup`
5. 바로 시험: `…/api/autopost/cron?dry=1`(고른 흐름만), `…/api/autopost/preview`(차트 PNG), `…/api/autopost/cron?force=1`(초안 실제 발송) — 모두 같은 Authorization 헤더

Cron은 Vercel 프로덕션 배포에서만 돈다(미리보기 배포 X). 로컬(`DATABASE_URL` 없음)에서는 시크릿 없이 `localhost:3000/api/autopost/cron?dry=1`·`/preview`로 확인.
