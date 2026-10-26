"use client";

import type * as echarts from "echarts";
import { useMemo, useState } from "react";
import { axis, baseOption, EChart } from "@/components/EChart";
import { InfoTip } from "@/components/InfoTip";
import type { PartnerFlow, PartnerKey } from "@/lib/queries";

const COLORS = ["#a855f7", "#ec4899", "#84cc16", "#f97316", "#14b8a6", "#38bdf8", "#e5e7eb", "#ea580c", "#facc15", "#6366f1"];
const OTHER = "기타";
const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`);
const axisUsd = (v: number) => (v === 0 ? "0" : v >= 1e9 ? `$${+(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${+(v / 1e6).toFixed(0)}M` : `$${+(v / 1e3).toFixed(0)}K`);

/** 상대국별 추이 — 품목의 나라별 월 금액 누적 막대 + 최근 월 비중 도넛. 나라 칩으로 빼고 넣기 */
export function PartnerMix({ keys, flows, initial }: { keys: PartnerKey[]; flows: PartnerFlow[]; initial?: string }) {
  const [sel, setSel] = useState(initial && keys.some((k) => k.key === initial) ? initial : keys[0]?.key);
  const k = keys.find((x) => x.key === sel)!;
  const rows = useMemo(() => flows.filter((f) => f.key === sel), [flows, sel]);
  const months = useMemo(() => [...new Set(rows.map((r) => r.month))].sort(), [rows]);
  // 나라 순서: 최근 24개월 합 큰 순, 기타는 맨 뒤
  const partners = useMemo(() => {
    const recent = new Set(months.slice(-24)), sum = new Map<string, number>();
    for (const r of rows) if (recent.has(r.month)) sum.set(r.partner, (sum.get(r.partner) ?? 0) + r.value_usd);
    return [...sum.keys()].sort((a, b) => (a === OTHER ? 1 : b === OTHER ? -1 : sum.get(b)! - sum.get(a)!));
  }, [rows, months]);
  const color = (p: string) => (p === OTHER ? "#64748b" : COLORS[partners.indexOf(p) % COLORS.length]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = partners.filter((p) => !hidden.has(p));
  const toggle = (p: string) => setHidden((h) => { const n = new Set(h); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const val = (m: string, p: string) => rows.find((r) => r.month === m && r.partner === p)?.value_usd ?? 0;
  const last = months.at(-1) ?? "";
  const lastRows = partners.map((p) => ({ p, v: val(last, p) })).filter((x) => x.v > 0);
  const lastTotal = lastRows.reduce((a, x) => a + x.v, 0);

  const bar: echarts.EChartsOption = {
    ...baseOption(),
    grid: { left: 52, right: 8, top: 12, bottom: 26 },
    legend: { show: false },
    tooltip: { ...baseOption().tooltip, valueFormatter: (v) => (v == null ? "-" : usd(Number(v))) },
    xAxis: { type: "category", data: months.map((m) => m.replace("-", ".")), ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => axisUsd(v) } },
    series: shown.map((p) => ({ type: "bar", stack: "a", name: p, data: months.map((m) => val(m, p) || null), itemStyle: { color: color(p) }, barMaxWidth: 14 })),
  };
  const pie: echarts.EChartsOption = {
    tooltip: { trigger: "item", backgroundColor: "#1a1f3a", borderColor: "#2c3358", textStyle: { color: "#e6e8f2", fontSize: 12 }, valueFormatter: (v) => usd(Number(v)) },
    series: [{
      type: "pie", radius: ["55%", "85%"], avoidLabelOverlap: true, label: { show: false },
      data: lastRows.filter((x) => !hidden.has(x.p)).map((x) => ({ name: x.p, value: x.v, itemStyle: { color: color(x.p) } })),
    }],
    graphic: [{ type: "text", left: "center", top: "42%", style: { text: usd(lastTotal), fill: "#e6e8f2", fontSize: 18, fontWeight: "bold" } },
      { type: "text", left: "center", top: "56%", style: { text: "합계", fill: "#8a90ad", fontSize: 11 } }],
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 font-bold">상대국별 추이
          <InfoTip>
            <p>이 종목 공급망 흐름과 같은 품목을 나라별로 나눈 월별 금액입니다. 미국은 Census(수입은 원산지, 수출은 목적지 · 흐름의 주·세관 조건 그대로), 한국은 관세청 품목별 국가별 통계(시군구 흐름도 전국 기준).</p>
            <p>최근 24개월 합 상위 10개국 + 나머지는 &lsquo;기타&rsquo;. 칩의 ×로 나라를 빼고, 빠진 나라는 &lsquo;+ 국가 추가&rsquo;로 다시 넣습니다.</p>
          </InfoTip>
        </h3>
        {keys.length > 1 && (
          <select value={sel} onChange={(e) => { setSel(e.target.value); setHidden(new Set()); }}
            className="min-w-0 max-w-full truncate rounded-lg border border-line bg-panel2 px-2 py-1 text-xs">
            {keys.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        )}
        {keys.length === 1 && <span className="text-xs text-muted">{k.label}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {shown.map((p) => (
          <span key={p} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel2 py-0.5 pl-2 pr-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color(p) }} />
            {p === OTHER && k.others ? `기타 ${k.others}` : p}
            <button type="button" onClick={() => toggle(p)} aria-label={`${p} 빼기`} className="rounded-full px-1 text-muted hover:text-fg">×</button>
          </span>
        ))}
        {hidden.size > 0 && (
          <select value="" onChange={(e) => e.target.value && toggle(e.target.value)} className="rounded-full border border-line bg-panel2 px-2 py-0.5">
            <option value="">+ 국가 추가</option>
            {partners.filter((p) => hidden.has(p)).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {hidden.size > 0 && <button type="button" onClick={() => setHidden(new Set())} className="text-muted underline hover:text-fg">초기화</button>}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <EChart option={bar} height={300} />
        <div className="min-w-0">
          <div className="text-center text-xs text-muted">{last.replace("-", ".")} 상대국 비중</div>
          <EChart option={pie} height={170} />
          <div className="mt-2 space-y-1 text-xs">
            {lastRows.sort((a, b) => b.v - a.v).map((x) => (
              <div key={x.p} className={`flex items-center gap-2 ${hidden.has(x.p) ? "opacity-40" : ""}`}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color(x.p) }} />
                <span className="min-w-0 flex-1 truncate">{x.p}</span>
                <span className="font-mono font-bold tnum">{((x.v / lastTotal) * 100).toFixed(1)}%</span>
                <span className="w-16 text-right font-mono text-muted tnum">{usd(x.v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
