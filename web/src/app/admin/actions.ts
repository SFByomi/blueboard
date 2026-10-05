"use server";

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exportCuration } from "@/lib/curation";
import { ADMIN_ENABLED, PROJECT_ROOT, sqlite } from "@/lib/db";

// 공개 사이트(Postgres)에서는 서버 액션도 직접 호출될 수 있으므로 매 액션마다 막는다
function db() {
  if (!ADMIN_ENABLED) throw new Error("관리 기능은 로컬 환경에서만 사용할 수 있습니다");
  return sqlite();
}

const s = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};

export async function saveCompany(f: FormData) {
  const ticker = s(f, "ticker")!.toUpperCase();
  db().prepare(
    `INSERT INTO companies (ticker, name, name_ko, market, sector, thesis, sec_ticker, fy_note, sort, dart_fs, dart_segment)
     VALUES (@ticker, @name, @name_ko, @market, @sector, @thesis, @sec_ticker, @fy_note, @sort, @dart_fs, @dart_segment)
     ON CONFLICT(ticker) DO UPDATE SET name=@name, name_ko=@name_ko, market=@market, sector=@sector,
       thesis=@thesis, sec_ticker=@sec_ticker, fy_note=@fy_note, sort=@sort, dart_fs=@dart_fs, dart_segment=@dart_segment`,
  ).run({
    ticker, name: s(f, "name") ?? ticker, name_ko: s(f, "name_ko"), market: s(f, "market"), sector: s(f, "sector"),
    thesis: s(f, "thesis"), sec_ticker: s(f, "sec_ticker"), fy_note: s(f, "fy_note"), sort: Number(s(f, "sort") ?? 100),
    dart_fs: s(f, "dart_fs")?.toUpperCase() ?? null,
    dart_segment: s(f, "dart_segment"),
  });
  exportCuration(); // data/curation.json 갱신 → git push로 공유
  revalidatePath("/", "layout");
  redirect(`/admin/stocks/${encodeURIComponent(ticker)}`);
}

export async function deleteCompany(f: FormData) {
  const t = s(f, "ticker")!;
  db().prepare("DELETE FROM mappings WHERE ticker=?").run(t);
  db().prepare("DELETE FROM companies WHERE ticker=?").run(t);
  exportCuration(); // data/curation.json 갱신 → git push로 공유
  revalidatePath("/", "layout");
  redirect("/admin");
}

export async function saveMapping(f: FormData) {
  const row = {
    ticker: s(f, "ticker"), series_id: s(f, "series_id"), role: s(f, "role"), confidence: s(f, "confidence"),
    rationale: s(f, "rationale"), caveat: s(f, "caveat"), include_in_total: f.get("include_in_total") ? 1 : 0,
    sort: Number(s(f, "sort") ?? 100),
  };
  db().prepare(
    `INSERT INTO mappings (ticker, series_id, role, confidence, rationale, caveat, include_in_total, sort)
     VALUES (@ticker, @series_id, @role, @confidence, @rationale, @caveat, @include_in_total, @sort)
     ON CONFLICT(ticker, series_id) DO UPDATE SET role=@role, confidence=@confidence, rationale=@rationale,
       caveat=@caveat, include_in_total=@include_in_total, sort=@sort`,
  ).run(row);
  exportCuration(); // data/curation.json 갱신 → git push로 공유
  revalidatePath("/", "layout");
}

export async function deleteMapping(f: FormData) {
  db().prepare("DELETE FROM mappings WHERE id=?").run(Number(f.get("mapping_id")));
  exportCuration(); // data/curation.json 갱신 → git push로 공유
  revalidatePath("/", "layout");
}

export async function saveSeries(f: FormData) {
  const spec = s(f, "spec")!;
  JSON.parse(spec); // 형식 검증 — 잘못되면 예외
  db().prepare(
    `INSERT INTO series (id, label, source, reporter, flow, region, hs, partner, spec)
     VALUES (@id, @label, @source, @reporter, @flow, @region, @hs, @partner, @spec)
     ON CONFLICT(id) DO UPDATE SET label=@label, source=@source, reporter=@reporter, flow=@flow,
       region=@region, hs=@hs, partner=@partner, spec=@spec`,
  ).run({
    id: s(f, "id"), label: s(f, "label"), source: s(f, "source"), reporter: s(f, "reporter"), flow: s(f, "flow"),
    region: s(f, "region"), hs: s(f, "hs"), partner: s(f, "partner"), spec,
  });
  exportCuration(); // data/curation.json 갱신 → git push로 공유
  revalidatePath("/admin");
}

export async function saveTag(f: FormData) {
  db().prepare("INSERT OR REPLACE INTO hs_tags (hs_prefix, ticker, note) VALUES (?,?,?)")
    .run(s(f, "hs_prefix"), s(f, "ticker"), s(f, "note"));
  exportCuration(); // data/curation.json 갱신 → git push로 공유
  revalidatePath("/", "layout");
}

export async function deleteTag(f: FormData) {
  db().prepare("DELETE FROM hs_tags WHERE hs_prefix=? AND ticker=?").run(s(f, "hs_prefix"), s(f, "ticker"));
  exportCuration(); // data/curation.json 갱신 → git push로 공유
  revalidatePath("/", "layout");
}

const LOG = path.join(PROJECT_ROOT, "data", "etl.log");

/** 로컬 전용: Python ETL을 백그라운드로 실행 (배포 환경에서는 스케줄러로 대체) */
export async function runEtl(f: FormData) {
  const py = process.platform === "win32"
    ? path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe")
    : path.join(PROJECT_ROOT, ".venv", "bin", "python"); // 리눅스(클라우드 세션)
  const args = ["-m", "etl.build", ...(f.get("skip_surge") ? ["--skip-surge"] : [])];
  const out = fs.openSync(LOG, "w");
  const p = spawn(py, args, { cwd: PROJECT_ROOT, detached: true, stdio: ["ignore", out, out], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  p.unref();
  revalidatePath("/admin");
}
