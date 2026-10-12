// 공장 지도 공용: 공장 목록 + 연결된 흐름별 최근 3개월 전년비·스파크라인 (서버에서 계산)
import type { FlowStat } from "@/components/PlantMap";
import { yoy3m } from "@/lib/estimate";
import { NON_USD } from "@/lib/format";
import { allSeries, observations, plants, type Plant } from "@/lib/queries";

export async function plantData(): Promise<{ list: Plant[]; stats: Record<string, FlowStat> }> {
  const [list, series] = await Promise.all([plants(), allSeries()]);
  const ids = [...new Set(list.flatMap((p) => JSON.parse(p.flows) as string[]))];
  const obs = ids.length ? await observations(ids) : [];
  const label = Object.fromEntries(series.map((s) => [s.id, s.label]));
  const unit = Object.fromEntries(series.map((s) => [s.id, s.unit]));
  const stats: Record<string, FlowStat> = {};
  for (const id of ids) {
    const rows = obs.filter((o) => o.series_id === id);
    const vals = rows.map((o) => o.value_usd);
    const y = yoy3m(vals);
    stats[id] = { label: label[id] ?? id, month: y.index >= 0 ? rows[y.index]?.month ?? null : null, yoy3m: y.value,
      spark: vals.slice(-24).map((v) => v ?? 0), money: !NON_USD.has(unit[id] ?? "") };
  }
  return { list, stats };
}

/** 연결된 첫 흐름의 최근 3개월 전년비 — '바쁜 공장' 정렬 기준 */
export const busyOf = (p: Plant, stats: Record<string, FlowStat>) =>
  (JSON.parse(p.flows) as string[]).map((f) => stats[f]?.yoy3m).find((v) => v != null) ?? null;
