#!/usr/bin/env bash
# 새 환경(클라우드 세션·리눅스/맥) 세팅. 키는 .env 또는 환경변수로 제공.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
npm --prefix web install --silent

if [ ! -f .env ]; then
  # 클라우드 세션은 환경 설정의 환경변수로 키를 주입 → .env로 기록
  for k in CENSUS_API_KEY ESTAT_APP_ID DATA_GO_KR_KEY DART_API_KEY EIA_API_KEY; do
    echo "$k=${!k:-}" >> .env
  done
fi

echo "세팅 완료. 데이터: .venv/bin/python -m etl.build  /  사이트: npm --prefix web run dev"
