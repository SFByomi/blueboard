import { query } from "../db";
import { addDays, type Candidate, dayEn, type Flag, pctTxt, todayKst } from "./types";

// 주간 GPU 렌탈가 (월요일, 한국 시간): Nebius 공개 가격 API 하루 평균·최저 — 지난주 같은 날 대비.
// 최신 날짜는 하루가 덜 찼을 수 있어 그 전날을 기준일로 쓴다. Vast.ai 매물 중앙값은 최근 3일 안 값이 있을 때만.
const GPUS = ["H100", "H200", "B200", "B300"];
const SPIKE = 0.5; // 주간 ±50% 넘으면 확인 필요

export type PriceRow = { gpu: string; avg: number; avgPrev: number | null; min: number; spark: number[] };
export type PriceChart = { day: string; dayIso: string; rows: PriceRow[]; vast: { gpu: string; median: number }[] };

export async function priceCandidate(today = todayKst()): Promise<Candidate | null> {
  if (new Date(`${today}T12:00:00+09:00`).getUTCDay() !== 1) return null; // 월요일만
  const dates = await query<{ date: string }>("SELECT DISTINCT date FROM price_snapshots WHERE kind = 'nebius' ORDER BY date DESC LIMIT 2");
  const day = dates[1]?.date;
  if (!day || day < addDays(today, -3)) return null;
  const rows = await query<{ date: string; item: string; stat: string; value: number }>(
    "SELECT date, item, stat, value FROM price_snapshots WHERE kind = 'nebius' AND stat IN ('avg', 'min') AND date >= ? AND date <= ?", [addDays(day, -29), day],
  );
  const get = (g: string, st: string, d: string) => rows.find((r) => r.item === g && r.stat === st && r.date === d)?.value ?? null;
  const out: PriceRow[] = [];
  for (const g of GPUS) {
    const avg = get(g, "avg", day), min = get(g, "min", day);
    if (avg == null || min == null) continue;
    const spark = rows.filter((r) => r.item === g && r.stat === "avg").sort((a, b) => a.date.localeCompare(b.date)).map((r) => r.value);
    out.push({ gpu: g, avg, min, avgPrev: get(g, "avg", addDays(day, -7)), spark });
  }
  if (!out.length) return null;
  const vast = (await query<{ item: string; value: number }>(
    "SELECT item, value FROM price_snapshots WHERE kind = 'gpu' AND stat = 'median' AND date = (SELECT max(date) FROM price_snapshots WHERE kind = 'gpu') AND date >= ?", [addDays(today, -3)],
  )).filter((r) => GPUS.some((g) => r.item.startsWith(g))).map((r) => ({ gpu: r.item, median: r.value }));
  const usd = (v: number) => `$${v.toFixed(2)}/hr`;
  const flags: Flag[] = out.filter((r) => r.avgPrev && Math.abs(r.avg / r.avgPrev - 1) > SPIKE)
    .map((r) => ({ code: "spike", ko: `${r.gpu} 주간 ${pctTxt(r.avg / r.avgPrev! - 1)} — 매물·지역 구성이 바뀐 탓일 수 있음` }));
  const facts = {
    date: dayEn(day), source_nebius: "Nebius public GPU pricing (daily average and minimum across regions)",
    nebius: out.map((r) => ({ gpu: r.gpu, avg: usd(r.avg), min: usd(r.min), week_change_avg: r.avgPrev ? pctTxt(r.avg / r.avgPrev - 1) : null })),
    vast_ai_marketplace_median: vast.length ? vast.map((v) => ({ gpu: v.gpu, median: usd(v.median) })) : null, flags: flags.map((f) => f.code),
  };
  return {
    kind: "prices", sig: `prices:${day}`, title: `주간 GPU 렌탈가 (${day})`, facts,
    guide: "Post type: weekly AI compute price check. Summarize GPU rental prices and their week-over-week change. Highlight the biggest move. Prices are hourly rental prices, not hardware prices.",
    asof: [dayEn(day)], sources: ["Nebius pricing", ...(vast.length ? ["Vast.ai marketplace"] : [])], flags,
    brief: out.map((r) => `${r.gpu}: 평균 ${usd(r.avg)} · 최저 ${usd(r.min)}${r.avgPrev ? ` · 주간 ${pctTxt(r.avg / r.avgPrev - 1)}` : ""}`),
    data: { day: dayEn(day), dayIso: day, rows: out, vast } satisfies PriceChart,
  };
}
