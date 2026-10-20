"use client";

import { axis, baseOption, EChart } from "@/components/EChart";
import { combined, LABS } from "@/lib/ailabs";
import type { AiArr } from "@/lib/queries";

const ESTIMATE = (k: string | null) => (k ?? "").startsWith("추정");

/** AI 랩 연환산 매출(ARR): 회사 발표·보도 수치(점) + 그 사이 로그 보간(선) + 두 랩 합산 */
export function AiLabsSection({ arr }: { arr: AiArr[] }) {
  const comb = combined(arr);
  const months = Object.keys(comb).sort();
  const last = (lab: string) => arr.filter((r) => r.lab === lab && !ESTIMATE(r.kind)).at(-1);
  const opt = {
    ...baseOption(),
    grid: { left: 48, right: 16, top: 24, bottom: 48 },
    tooltip: { ...baseOption().tooltip, valueFormatter: (v: unknown) => (v == null ? "-" : `$${Number(v).toFixed(1)}B`) },
    xAxis: { type: "time" as const, ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: "#8a90ad", fontSize: 10 }, ...axis },
    series: [
      ...LABS.map((l) => ({
        name: l.id, type: "line" as const, data: arr.filter((r) => r.lab === l.id).map((r) => ({
          value: [r.date, r.usd_b], symbol: ESTIMATE(r.kind) ? "emptyCircle" : "circle", symbolSize: ESTIMATE(r.kind) ? 9 : 7,
        })), lineStyle: { color: l.color, width: 2 }, itemStyle: { color: l.color },
      })),
      { name: "합산(보간)", type: "line" as const, showSymbol: false, data: months.map((m) => [`${m}-15`, +comb[m].toFixed(1)]),
        lineStyle: { color: "#8a90ad", width: 1.5, type: "dashed" as const }, itemStyle: { color: "#8a90ad" } },
    ],
  };
  const a = last("Anthropic"), o = last("OpenAI");
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">AI 랩 매출 규모 <span className="text-sm font-normal text-muted">연환산 매출(ARR) · 회사 발표·보도 수치</span></h2>
        <span className="text-xs text-muted">네오클라우드·GPU 수요의 최종 지불자</span>
      </div>
      <div className="card min-w-0 space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-sm">
          {a && <span><span className="font-sans text-xs text-muted">Anthropic </span><b>${a.usd_b}B</b> <span className="text-xs text-muted">{a.date.slice(0, 7)} · {a.kind}</span></span>}
          {o && <span><span className="font-sans text-xs text-muted">OpenAI </span><b>${o.usd_b}B</b> <span className="text-xs text-muted">{o.date.slice(0, 7)} · {o.kind}</span></span>}
          {months.length > 0 && <span><span className="font-sans text-xs text-muted">합산 </span><b>${comb[months.at(-1)!].toFixed(0)}B</b> <span className="text-xs text-muted">{months.at(-1)} (보간)</span></span>}
        </div>
        <EChart option={opt} height={280} />
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">수치·출처 {arr.length}건</summary>
          <ul className="mt-1 space-y-0.5">
            {arr.map((r) => (
              <li key={`${r.lab}${r.date}`}>{r.date.slice(0, 7)} · {r.lab} <b className="font-mono text-fg">${r.usd_b}B</b> · {r.kind} — {r.note} {r.url && <a className="text-accent" href={r.url} target="_blank" rel="noreferrer">출처</a>}</li>
            ))}
          </ul>
        </details>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        두 회사 모두 정기 공시가 없어 발표·보도 시점이 들쭉날쭉합니다 — 점은 실제 공개된 값, 선은 그 사이를 일정한 성장률로 이은 것(빈 원은 애널리스트 추정).
        연환산 매출은 그달 매출 × 12라 이미 번 돈이 아닙니다. OpenAI는 집계 기준(파트너 매출 포함 여부)에 따라 $50B~$70B로 갈립니다 — 여기선 회사가 투자자에게 밝힌 낮은 쪽.
      </p>
    </section>
  );
}
