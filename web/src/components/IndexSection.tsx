import { pct, tone } from "@/lib/format";
import type { Indicator, PriceRow } from "@/lib/queries";
import { PriceChart } from "./ComputeCharts";

const COLORS = ["#60a5fa", "#22d3ee", "#f59e0b", "#f472b6", "#34d399", "#a78bfa"];
const BASE = "2021-01";
const CHART_FROM = "2019-01"; // 차트는 2019년부터 (표의 변화율은 전체 데이터 기준)

/** 가격지수 그룹: 2021.01=100으로 맞춘 추이 + 최근값·3개월·1년 변화 표 */
export function IndexSection({ grp, defs, rows, compact = false }: { grp: string; defs: Indicator[]; rows: PriceRow[]; compact?: boolean }) {
  const series = defs.map((d) => {
    const pts = rows.filter((r) => r.item === d.id).map((r) => [r.date.slice(0, 7), r.value] as [string, number]);
    const base = pts.find(([m]) => m === BASE)?.[1];
    const reb = base ? pts.map(([m, v]) => [m, (v / base) * 100] as [string, number]) : pts;
    const back = (k: number) => (pts.length > k ? pts.at(-1)![1] / pts[pts.length - 1 - k][1] - 1 : null);
    return { d, reb, last: reb.at(-1), m3: back(3), y1: back(12) };
  }).filter((x) => x.reb.length);
  if (!series.length) return null;
  return (
    <div className="card min-w-0 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold">{grp}</h3>
        <span className="text-xs text-muted">{BASE.replace("-", ".")}=100 · 월별 · 최근 {series[0].last?.[0]}</span>
      </div>
      {!compact && <PriceChart unit="지수" prefix="" height={260} lines={series.map((x, i) => ({ name: x.d.label, color: COLORS[i % COLORS.length], points: x.reb.filter(([m]) => m >= CHART_FROM).map(([m, v]) => [`${m}-01`, v]) }))} />}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] whitespace-nowrap text-sm">
          <thead className="text-xs text-muted"><tr className="border-b border-line">
            <th className="py-2 text-left">지수</th><th className="text-right">최근</th><th className="text-right">3개월</th><th className="text-right">1년</th>
          </tr></thead>
          <tbody className="font-mono">
            {series.map((x, i) => (
              <tr key={x.d.id} className="border-b border-line/50">
                <td className="py-2 font-sans" title={x.d.note ?? ""}><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />{x.d.label}</td>
                <td className="text-right">{x.last?.[1].toFixed(1)}</td>
                <td className={`text-right ${tone(x.m3)}`}>{pct(x.m3)}</td>
                <td className={`text-right ${tone(x.y1)}`}>{pct(x.y1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
