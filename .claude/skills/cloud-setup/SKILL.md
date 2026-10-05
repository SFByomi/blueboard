---
name: cloud-setup
description: Yomin 클라우드 세션(claude.ai/code) 환경을 점검·복구한다. 의존성 설치, API 키(.env) 반영, 데이터 소스 도메인 접속 확인, DB 빌드까지. "클라우드 세팅", "환경 점검", "키가 없대", "접속이 안 돼", 세션 시작 경고가 떴을 때 사용.
---

# 클라우드 환경 점검·복구

세션 시작 훅(`.claude/settings.json` → `scripts/cloud-session-start.sh`)이 자동으로 세팅하지만,
경고가 떴거나 사용자가 요청하면 이 순서로 처리한다.

## 1. 점검 실행
```bash
bash scripts/cloud-session-start.sh --force
```
출력의 `누락 키`, `접속 차단`, `DB 없음`을 확인한다.

## 2. 자동으로 고칠 수 있는 것 — 바로 처리
- 의존성 누락: `bash scripts/setup.sh`
- DB 없음: `.venv/bin/python -m etl.build` (첫 실행 ~10분 → 백그라운드로 실행). 급등 탐지 없이 빠르게: `--skip-surge`

## 3. 사용자만 할 수 있는 것 — 정확히 안내
키와 네트워크 허용은 **claude.ai/code 환경 설정 화면**에서만 바꿀 수 있다 (저장소에 키를 넣으면 안 됨).
누락된 항목만 골라 아래 형식 그대로 복사해 붙일 수 있게 보여준다.

**환경변수** (환경 설정 → Environment variables, `.env` 형식):
```
CENSUS_API_KEY=
ESTAT_APP_ID=
DATA_GO_KR_KEY=
DART_API_KEY=
```
값은 사용자의 로컬 `.env`에 있다. 값을 대화에 출력하지 말 것.

**네트워크 접근** (환경 설정 → Network access → 허용 도메인 추가, 또는 Full):
```
api.census.gov
api.e-stat.go.jp
apis.data.go.kr
www.data.go.kr
opendart.fss.or.kr
data.sec.gov
www.sec.gov
fred.stlouisfed.org
```
의존성 설치용 pypi.org / registry.npmjs.org 는 기본 허용 목록에 보통 포함.

환경 설정 변경은 **새 세션부터** 적용된다고 안내한다.

## 4. 확인
수정 후 1번을 다시 실행해 경고가 없는지 확인하고 결과를 짧게 보고한다.
