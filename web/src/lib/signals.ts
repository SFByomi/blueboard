import { estimateNextQuarter, yoy3m } from "./estimate";
import { sumSeries, toMonthly } from "./compute";
import { allFinancials, allMappingsLabeled, companies, observations, type Company } from "./queries";

export type Signal = {
  c: Company;
  flowLabel: string | null; flows: number; proxy: boolean; // proxy: 합산 대상이 없어 첫 흐름(업황)으로 대신
  month: string | null; yoy3m: number | null; spark: number[];
  revYoY: number | null; currency: string; est: ReturnType<typeof estimateNextQuarter>;
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
    return {
      c, flowLabel: use.length === 1 ? use[0].label : use.length ? `${use.length}개 흐름 합산` : null,
      flows: ms.length, proxy: !inc.length && ms.length > 0,
      month: y.index >= 0 ? m.months[y.index] : null, yoy3m: y.value,
      spark: total.slice(-24).map((v) => v ?? 0),
      revYoY, currency: fin.at(-1)?.currency ?? "USD",
      est: inc.length ? estimateNextQuarter(m.months, total, fin) : null,
    };
  });
}
