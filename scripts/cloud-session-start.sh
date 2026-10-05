#!/usr/bin/env bash
# 클라우드 세션 시작 시 자동 실행 (SessionStart 훅). 로컬(윈도우 등)에서는 아무것도 안 함.
#   1) 의존성 설치 (.venv / web/node_modules 없을 때만)
#   2) 환경변수의 API 키 → .env 기록 (값은 출력하지 않음)
#   3) 데이터 소스 도메인 접속 점검
#   4) DB 없으면 빌드가 필요하다고 Claude에게 알림
# 결과는 JSON(systemMessage + additionalContext)으로 출력.
set -uo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || [ "${1:-}" = "--force" ] || exit 0
cd "$(dirname "$0")/.."

KEYS=(CENSUS_API_KEY ESTAT_APP_ID DATA_GO_KR_KEY DART_API_KEY)
DOMAINS=(api.census.gov api.e-stat.go.jp apis.data.go.kr www.data.go.kr opendart.fss.or.kr data.sec.gov www.sec.gov fred.stlouisfed.org)
notes=()

# 1) 의존성
if [ "${SKIP_INSTALL:-}" != "1" ]; then
  if [ ! -x .venv/bin/python ]; then
    python3 -m venv .venv >/dev/null 2>&1 && .venv/bin/pip install -q -r requirements.txt >/dev/null 2>&1 \
      && notes+=("Python 의존성 설치 완료") || notes+=("⚠ Python 의존성 설치 실패 (pypi.org 접근 확인)")
  fi
  if [ ! -d web/node_modules ]; then
    npm --prefix web install --silent >/dev/null 2>&1 \
      && notes+=("웹 의존성 설치 완료") || notes+=("⚠ npm install 실패 (registry.npmjs.org 접근 확인)")
  fi
fi

# 2) 키: 환경변수에 있으면 .env에 반영 (기존 .env 값보다 환경변수 우선)
missing=()
touch .env
for k in "${KEYS[@]}"; do
  v="${!k:-}"
  if [ -n "$v" ]; then
    grep -v "^$k=" .env > .env.tmp 2>/dev/null; mv .env.tmp .env
    echo "$k=$v" >> .env
  elif ! grep -q "^$k=." .env; then
    missing+=("$k")
  fi
done

# 3) 네트워크
blocked=()
for d in "${DOMAINS[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "https://$d/" 2>/dev/null) || code=000
  [ "$code" = "000" ] && blocked+=("$d")
done

# 4) DB
db_note=""
[ -f data/yomin.db ] || db_note="data/yomin.db 없음 → '.venv/bin/python -m etl.build' 실행 필요 (첫 실행 약 10분)."

status="클라우드 세팅: ${notes[*]:-의존성 OK}"
[ ${#missing[@]} -gt 0 ] && status+=" | ⚠ 키 없음: ${missing[*]}"
[ ${#blocked[@]} -gt 0 ] && status+=" | ⚠ 접속 차단: ${blocked[*]}"
[ -n "$db_note" ] && status+=" | DB 없음"

ctx="Yomin 클라우드 세션 점검 결과. 누락 키: ${missing[*]:-없음}. 접속 차단 도메인: ${blocked[*]:-없음}. ${db_note}"
[ ${#missing[@]} -gt 0 ] || [ ${#blocked[@]} -gt 0 ] && \
  ctx+=" 누락/차단이 있으면 사용자에게 claude.ai/code 환경 설정(환경변수·네트워크 허용 도메인)에서 추가하도록 안내할 것 — .claude/skills/cloud-setup/SKILL.md 참고."

PY=python3; "$PY" -c "" 2>/dev/null || PY=python; [ -x .venv/bin/python ] && PY=.venv/bin/python
"$PY" - "$status" "$ctx" <<'PY'
import json, sys
print(json.dumps({"systemMessage": sys.argv[1],
                  "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": sys.argv[2]}}, ensure_ascii=False))
PY
