# Yomin

글로벌 세관 무역 데이터를 미국(·한국) 종목에 매핑해 실적을 먼저 읽는 사이트. 기획은 [PLAN.md](PLAN.md).

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
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
npm --prefix web install
cp .env.example .env   # 키 4개 채우기
```

## 실행

```bash
# 1) 데이터 갱신 (첫 실행 5~10분, 이후 캐시)
.venv/Scripts/python -m etl.build

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

## 배포 전 할 일
- 관리 페이지 인증 (현재 로컬 전용, 누구나 수정 가능)
- SQLite → Postgres(Supabase) 이전, ETL은 스케줄러(GitHub Actions 등)로
