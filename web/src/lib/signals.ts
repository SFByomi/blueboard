import { yoy3m } from "./estimate";
import { sumSeries, toMonthly } from "./compute";
import { allFinancials, allMappingsLabeled, companies, observations, type Company } from "./queries";

export type Signal = {
  c: Company;
  flowLabel: string | null; flows: number; proxy: boolean; // proxy: 합산 대상이 없어 첫 흐름(업황)으로 대신
  month: string | null; yoy3m: number | null; spark: number[];
  revYoY: number | null; currency: string;
  // 매핑 트렌드 카드용: 최근 월 전년비·금액·전월비, 최근 3개월 중 전년비 플러스 개월 수, 흐름별 분해
  last: { yoy: number | null; value: number | null; mom: number | null }; up3: number | null; unit: string | null;
  parts: { label: string; share: number | null; yoy: number | null; spark: number[] }[];
};

/** 종목별 공급망 신호: 매출 합산 대상 흐름(없으면 첫 흐름)의 최근 3개월 YoY, 매출 YoY, 진행 분기 추정 */
export async function stockSignals(): Promise<Signal[]> {
  const [cos, maps, fins] = await Promise.all([companies(), allMappingsLabeled(), allFinancials()]);
  const obs = await observations([...new Set(maps.map((m) => m.series_id))]);
  return cos.map((c) => {
    const ms = maps.filter((m) => m.ticker === c.ticker);
    const inc = ms.filter((m) => m.include_in_total);
    const use = inc.length ? inc : ms.slice(0, 1);
    const ids = use.map((m) => m.series_id);
    const m = toMonthly(obs.filter((o) => ids.includes(o.series_id)), ids);
    const total = sumSeries(m, ids);
    const y = yoy3m(total);
    const fin = fins.filter((f) => f.ticker === c.ticker && f.period_end >= "2021-01-01");
    const r = fin.map((f) => f.revenue);
    const revYoY = r.length > 4 && r.at(-5) ? r.at(-1)! / r.at(-5)! - 1 : null;
    const i = y.index, at = (a: (number | null)[], k: number) => (k >= 0 ? a[k] ?? null : null);
    const yo = (a: (number | null)[], k: number) => { const v = at(a, k), p = at(a, k - 12); return v != null && p ? v / p - 1 : null; };
    const ups = [i, i - 1, i - 2].map((k) => yo(total, k)).filter((v) => v != null);
    return {
      last: { yoy: yo(total, i), value: at(total, i), mom: at(total, i) != null && at(total, i - 1) ? at(total, i)! / at(total, i - 1)! - 1 : null },
      up3: ups.length === 3 ? ups.filter((v) => v! > 0).length : null,
      unit: use[0]?.unit ?? null,
      parts: use.length > 1 ? use.map((u) => ({
        label: u.label, share: at(total, i) ? (at(m.value[u.series_id], i) ?? 0) / at(total, i)! : null, yoy: yo(m.value[u.series_id], i),
        spark: m.value[u.series_id].slice(-24).map((v) => v ?? 0),
      })).sort((a, b) => (b.share ?? 0) - (a.share ?? 0)) : [],
      c, flowLabel: use.length === 1 ? use[0].label : use.length ? `${use.length}개 흐름 합산` : null,
      flows: ms.length, proxy: !inc.length && ms.length > 0,
      month: y.index >= 0 ? m.months[y.index] : null, yoy3m: y.value,
      spark: total.slice(-24).map((v) => v ?? 0),
      revYoY, currency: fin.at(-1)?.currency ?? "USD",
    };
  });
}
