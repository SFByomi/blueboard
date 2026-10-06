import type { Fin } from "./queries";

/** 최근 3개월 합 / 전년 같은 3개월 합 − 1 (마지막 값이 있는 달 기준) */
export function yoy3m(values: (number | null)[]) {
  const i = values.findLastIndex((v) => v != null);
  if (i < 14) return { value: null, index: i };
  const win = (k: number) => [k - 2, k - 1, k].map((j) => values[j]);
  const now = win(i), prev = win(i - 12);
  if ([...now, ...prev].some((v) => v == null) || !prev.reduce((a, b) => a! + b!, 0)) return { value: null, index: i };
  return { value: now.reduce((a, b) => a! + b!, 0)! / prev.reduce((a, b) => a! + b!, 0)! - 1, index: i };
}

const midIn = (m: string, start: string, end: string) => {
  const d = new Date(`${m}-15`);
  return d >= new Date(start) && d <= new Date(end);
};

export type Estimate = {
  start: string; end: string; months: number;      // 진행 분기와 반영된 무역월 수
  value: number; low: number; high: number;         // 추정 매출과 ±1 표준오차 범위
  r2: number; n: number; lastActual: number;
};

/**
 * 무역(합산 흐름) → 분기 매출 단순 회귀로 진행 중인 분기 매출을 추정.
 * 완료 분기 6개 이상, R² 0.5 이상, 기울기 양수일 때만. 진행 분기는 반영된 달(2개월 이상)을 3개월로 환산.
 */
export function estimateNextQuarter(months: string[], total: (number | null)[], fin: Fin[]): Estimate | null {
  const last = fin.at(-1);
  if (!last) return null;
  const pts = fin.slice(-12).map((q) => {
    const vals = months.map((m, i) => (midIn(m, q.period_start, q.period_end) ? total[i] : undefined)).filter((v) => v !== undefined);
    return vals.length === 3 && vals.every((v) => v != null) ? { x: vals.reduce((a, b) => a! + b!, 0)!, y: q.revenue } : null;
  }).filter((p) => p != null);
  if (pts.length < 6) return null;
  const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0), sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  if (!sxx || sxy <= 0) return null;
  const b = sxy / sxx, a = my - b * mx;
  const ssr = pts.reduce((s, p) => s + (p.y - (a + b * p.x)) ** 2, 0), sst = pts.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const r2 = sst ? 1 - ssr / sst : 0;
  if (r2 < 0.5) return null;
  const se = Math.sqrt(ssr / Math.max(n - 2, 1));

  const s = new Date(last.period_end); s.setDate(s.getDate() + 1);
  const e = new Date(s); e.setMonth(e.getMonth() + 3); e.setDate(e.getDate() - 1);
  const start = s.toISOString().slice(0, 10), end = e.toISOString().slice(0, 10);
  const cur = months.map((m, i) => (midIn(m, start, end) ? total[i] : undefined)).filter((v): v is number => v != null);
  if (cur.length < 2) return null;
  const x = (cur.reduce((p, q) => p + q, 0) / cur.length) * 3;
  const value = a + b * x;
  return { start: start.slice(0, 7), end: end.slice(0, 7), months: cur.length, value, low: value - se, high: value + se, r2, n, lastActual: last.revenue };
}
