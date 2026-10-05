import fs from "node:fs";
import path from "node:path";
import { db, PROJECT_ROOT } from "./db";

// etl/curation.py 와 같은 형식: 큐레이션 테이블 → data/curation.json (git에 올려 PC·클라우드 간 공유)
const TABLES: Record<string, { order: string; skip: string[] }> = {
  companies: { order: "sort, ticker", skip: [] },
  series: { order: "id", skip: ["unit", "last_month", "updated_at"] },
  mappings: { order: "ticker, sort, series_id", skip: ["id"] },
  hs_tags: { order: "hs_prefix, ticker", skip: [] },
};

export function exportCuration() {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const [t, { order, skip }] of Object.entries(TABLES)) {
    const rows = db().prepare(`SELECT * FROM ${t} ORDER BY ${order}`).all() as Record<string, unknown>[];
    out[t] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !skip.includes(k))));
  }
  fs.writeFileSync(path.join(PROJECT_ROOT, "data", "curation.json"), JSON.stringify(out, null, 1) + "\n", "utf-8");
}
