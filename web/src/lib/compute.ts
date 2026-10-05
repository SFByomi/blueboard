import type { Fin, Obs } from "./queries";

export type Monthly = { months: string[]; value: Record<string, (number | null)[]>; qty: Record<string, (number | null)[]> };

export function toMonthly(obs: Obs[], ids: string[]): Monthly {
  const months = [...new Set(obs.map((o) => o.month))].sort();
  const idx = new Map(months.map((m, i) => [m, i]));
  const value: Monthly["value"] = {}, qty: Monthly["qty"] = {};
  for (const id of ids) {
    value[id] = months.map(() => null);
    qty[id] = months.map(() => null);
  }
  for (const o of obs) {
    const i = idx.get(o.month)!;
    value[o.series_id][i] = o.value_usd;
    qty[o.series_id][i] = o.qty;
  }
  return { months, value, qty };
}

export const yoy = (a: (number | null)[]) =>
  a.map((v, i) => (i >= 12 && v != null && a[i - 12] ? v / a[i - 12]! - 1 : null));

/** 포함 시리즈 합계. 해당 월에 데이터가 하나라도 빠지면 null (최신월 부분합 방지) */
export function sumSeries(m: Monthly, ids: string[]) {
  return m.months.map((_, i) => {
    let s = 0;
    for (const id of ids) {
      const v = m.value[id][i];
      if (v == null) return null;
      s += v;
    }
    return ids.length ? s : null;
  });
}

/** 회계분기 [start, end]에 월 중순이 들어가면 합산. 3개월이 다 있어야 값, 아니면 partial로 표시 */
export function quarterize(months: string[], values: (number | null)[], fin: Pick<Fin, "period_start" | "period_end">[]) {
  return fin.map((q) => {
    const inQ = months
      .map((m, i) => ({ mid: new Date(`${m}-15`), v: values[i] }))
      .filter(({ mid }) => mid >= new Date(q.period_start) && mid <= new Date(q.period_end));
    const vals = inQ.map((x) => x.v).filter((v): v is number => v != null);
    return { end: q.period_end, months: vals.length, value: vals.length === 3 ? vals.reduce((a, b) => a + b, 0) : null };
  });
}

/** 상관계수 (null 쌍 제외) */
export function corr(a: (number | null)[], b: (number | null)[]) {
  const p = a.map((x, i) => [x, b[i]]).filter((x): x is [number, number] => x[0] != null && x[1] != null && isFinite(x[0]) && isFinite(x[1]));
  if (p.length < 4) return null;
  const n = p.length, ma = p.reduce((s, x) => s + x[0], 0) / n, mb = p.reduce((s, x) => s + x[1], 0) / n;
  let num = 0, da = 0, db = 0;
  for (const [x, y] of p) { num += (x - ma) * (y - mb); da += (x - ma) ** 2; db += (y - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : null;
}
