"""큐레이션(종목·시리즈·매핑·HS태그)을 data/curation.json으로 git에 보관.

- DB는 재생성 가능한 캐시, curation.json이 원본 (여러 PC·클라우드 세션 간 공유)
- 관리 페이지 수정 → 웹이 같은 형식으로 curation.json 자동 저장 → git commit/push
- build.py는 curation.json이 있으면 그걸로 DB 큐레이션 테이블을 맞추고, 없으면 seed.py로 초기화 후 내보냄
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "curation.json"

TABLES = {  # 테이블: (정렬 키, 제외 컬럼)
    "companies": ("sort, ticker", ()),
    "series": ("id", ("unit", "last_month", "updated_at")),  # ETL이 채우는 값은 제외
    "mappings": ("ticker, sort, series_id", ("id",)),
    "hs_tags": ("hs_prefix, ticker", ()),
}


def export(con) -> dict:
    out = {}
    for t, (order, skip) in TABLES.items():
        cur = con.execute(f"SELECT * FROM {t} ORDER BY {order}")
        cols = [d[0] for d in cur.description]
        out[t] = [{c: v for c, v in zip(cols, r) if c not in skip} for r in cur.fetchall()]
    with open(PATH, "w", encoding="utf-8", newline="\n") as f:  # 웹(Node)과 같은 LF — PC마다 diff 안 생기게
        f.write(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    return out


def load(con) -> bool:
    if not PATH.exists():
        return False
    data = json.loads(PATH.read_text(encoding="utf-8"))
    for t in TABLES:
        rows = data.get(t, [])
        if t == "series":  # ETL 상태 컬럼(last_month 등)은 유지하며 갱신
            keep = {r[0] for r in con.execute("SELECT id FROM series")}
            con.execute(f"DELETE FROM series WHERE id NOT IN ({','.join('?' * len(rows)) or 'NULL'})", [r["id"] for r in rows])
            for r in rows:
                cols = list(r)
                if r["id"] in keep:
                    con.execute(f"UPDATE series SET {', '.join(f'{c}=?' for c in cols)} WHERE id=?", [r[c] for c in cols] + [r["id"]])
                else:
                    con.execute(f"INSERT INTO series ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", [r[c] for c in cols])
            continue
        con.execute(f"DELETE FROM {t}")
        for r in rows:
            cols = list(r)
            con.execute(f"INSERT INTO {t} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", [r[c] for c in cols])
    con.commit()
    return True
