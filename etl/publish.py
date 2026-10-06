"""로컬 SQLite(data/yomin.db) → 공개 사이트용 Postgres(Supabase) 게시.

실행 (프로젝트 루트): .venv/bin/python -m etl.publish
- DATABASE_URL 환경변수(.env 가능)의 Postgres에 같은 스키마를 만들고, 모든 테이블을 한 트랜잭션으로 통째로 교체
  → 게시 중에도 사이트는 이전 데이터를 보고, 커밋 순간 새 데이터로 바뀜
- 수집 로직은 SQLite 그대로 두고 결과만 복사 (데이터가 작아 전체 교체가 가장 단순·안전). 단 ACCUMULATE 테이블은 누적
- Supabase는 public 스키마를 REST API로 노출하므로 RLS를 켜서 API 접근을 막는다 (웹은 DB 직접 접속이라 영향 없음)
"""
import os
import re
import sys
from urllib.parse import quote, unquote

import psycopg
from dotenv import load_dotenv

from etl.db import MIGRATIONS, ROOT, SCHEMA, connect

load_dotenv(ROOT / ".env")


# 소스에 과거 이력이 없어 매일 쌓는 테이블: 테이블 → 기본키. Actions 캐시(SQLite)는 언제든 사라질 수 있으므로
# 이 테이블들은 통째 교체하지 않고 Postgres에 누적한다.
ACCUMULATE = {"price_snapshots": ("date", "kind", "item", "stat")}


def pg_type(sql: str) -> str:
    sql = re.sub(r"INTEGER PRIMARY KEY AUTOINCREMENT", "INTEGER PRIMARY KEY", sql)
    return re.sub(r"\bREAL\b", "DOUBLE PRECISION", sql)  # REAL은 Postgres에서 4바이트 → 정밀도 손실


def ensure_schema(pg):
    pg.execute(pg_type(SCHEMA))
    for table, col in MIGRATIONS:
        pg.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {pg_type(col)}")


def tables(lite) -> list[str]:
    return [t for (t,) in lite.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]


def normalize_url(url: str) -> str:
    """비밀번호의 @·# 등을 퍼센트 인코딩 — 사용자가 Supabase 비밀번호를 그대로 붙여 넣어도 동작하게.
    호스트에는 @가 없으므로 마지막 @를 사용자정보 경계로 본다. 이미 인코딩된 값은 그대로 유지."""
    m = re.match(r"^(postgres(?:ql)?://)(.*)@([^@]*)$", url)
    if not m:
        return url
    scheme, userinfo, rest = m.groups()
    user, sep, pw = userinfo.partition(":")
    return f"{scheme}{user}{sep}{quote(unquote(pw), safe='')}@{rest}"


def publish(url: str, log=print):
    lite = connect()
    for t in ("companies", "series", "observations"):  # 수집이 통째로 실패한 DB로 사이트를 비우지 않게
        if not lite.execute(f"SELECT count(*) FROM {t}").fetchone()[0]:
            sys.exit(f"{t} 테이블이 비어 있어 게시를 중단합니다 (etl.build 결과 확인)")
    with psycopg.connect(normalize_url(url), prepare_threshold=None) as pg:  # 풀러(트랜잭션 모드)와 호환되게 prepared statement 끔
        with pg.transaction():
            ensure_schema(pg)
            for t in tables(lite):
                cur = lite.execute(f"SELECT * FROM {t}")
                cols = [d[0] for d in cur.description]
                rows = cur.fetchall()
                target = t
                if t in ACCUMULATE:  # 이력은 Postgres가 원본 → 지우지 않고 같은 키만 갱신
                    target = f"_in_{t}"
                    pg.execute(f"CREATE TEMP TABLE {target} (LIKE {t}) ON COMMIT DROP")
                else:
                    pg.execute(f"DELETE FROM {t}")
                with pg.cursor().copy(f"COPY {target} ({', '.join(cols)}) FROM STDIN") as cp:
                    for r in rows:
                        cp.write_row(r)
                if t in ACCUMULATE:
                    keys, rest = ACCUMULATE[t], [c for c in cols if c not in ACCUMULATE[t]]
                    pg.execute(f"INSERT INTO {t} ({', '.join(cols)}) SELECT {', '.join(cols)} FROM {target} "
                               f"ON CONFLICT ({', '.join(keys)}) DO UPDATE SET {', '.join(f'{c}=excluded.{c}' for c in rest)}")
                pg.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
                log(f"  ✓ {t}: {len(rows)}행{' (누적)' if t in ACCUMULATE else ''}")
    lite.close()


if __name__ == "__main__":
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL이 없습니다 (.env 또는 환경변수에 Supabase 접속 주소 필요)")
    print("Postgres 게시")
    publish(url)
