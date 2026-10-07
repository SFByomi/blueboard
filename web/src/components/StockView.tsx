"use client";

import { T } from "@/components/Names";
import type { EChartsOption } from "echarts";
import { useMemo, useState } from "react";
import { yoy3m } from "@/lib/estimate";
import { baseEffect, pct, ROLE_STYLE, shiftMonth, STAGES, stageOf, tone, usd } from "@/lib/format";
import { axis, baseOption, EChart } from "./EChart";

export type FlowData = {
  id: string; label: string; reporter: string | null; flow: string | null; region: string | null; hs: string | null;
  partner: string | null; role: string; confidence: string; rationale: string | null; caveat: string | null;
  include: boolean; unit: string | null; lastMonth: string | null;
  values: (number | null)[]; qty: (number | null)[]; corrYoY: number | null; corrLead: number | null;
  alerts: { month: string; kind: string; detail: string }[];
};
export type QuarterRow = { end: string; revenue: number; revYoY: number | null; trade: number | null };

const COLORS = ["#3b82f6", "#10b981", "#a78bfa", "#f59e0b", "#f472b6", "#22d3ee"];
const M = (v: number | null) => (v == null ? null : +(v / 1e6).toFixed(2));
const yoyArr = (a: (number | null)[]) => a.map((v, i) => (i >= 12 && v != null && a[i - 12] ? v / a[i - 12]! - 1 : null));
const P = (v: number | null) => (v == null ? null : +(v * 100).toFixed(1));

export function StockView({ flows, months, quarters, currency }: { flows: FlowData[]; months: string[]; quarters: QuarterRow[]; currency: string }) {
  const [sel, setSel] = useState(0);
  const f = flows[sel];
  const inc = flows.filter((x) => x.include);
  const shown = inc.length ? inc : flows.slice(0, 1);

  const derived = useMemo(() => flows.map((x) => {
    const price = x.values.map((v, i) => (v != null && x.qty[i] ? v / x.qty[i]! : null));
    return { yoy: yoyArr(x.values), price, priceYoY: yoyArr(price), qtyYoY: yoyArr(x.qty) };
  }), [flows]);

  const totalYoY = useMemo(() => {
    const t = months.map((_, i) => shown.reduce<number | null>((s, x) => (s == null || x.values[i] == null ? null : s + x.values[i]!), 0));
    return yoyArr(t);
  }, [months, shown]);

  const revByMonth = useMemo(() => {
    const map = new Map(quarters.map((q) => [q.end.slice(0, 7), q.revYoY]));
    return months.map((m) => P(map.get(m) ?? null));
  }, [months, quarters]);

  const main: EChartsOption = {
    ...baseOption(),
    xAxis: { type: "category", data: months, ...axis, splitLine: { show: false } },
    yAxis: [
      { type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: "{value}M" } },
      { type: "value", ...axis, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, formatter: "{value}%" } },
    ],
    series: [
      ...shown.map((x) => ({
        name: x.label, type: "bar" as const, stack: "t", barMaxWidth: 12,
        itemStyle: { color: COLORS[flows.indexOf(x) % COLORS.length] }, data: x.values.map(M),
      })),
      { name: "합산 YoY", type: "line", yAxisIndex: 1, symbol: "none", lineStyle: { color: "#22d3ee", width: 2 }, itemStyle: { color: "#22d3ee" }, data: totalYoY.map(P) },
      { name: "매출 YoY", type: "line", yAxisIndex: 1, connectNulls: true, symbolSize: 7, lineStyle: { color: "#34d399", width: 2 }, itemStyle: { color: "#34d399" }, data: revByMonth },
    ],
  };

  const d = derived[sel];
  const hasQty = f.qty.some((v) => v);
  const detail1: EChartsOption = {
    ...baseOption(),
    xAxis: { type: "category", data: months, ...axis, splitLine: { show: false } },
    yAxis: [{ type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: "{value}M" } }, { type: "value", ...axis, splitLine: { show: false } }],
    series: [
      {
        name: "금액 (USD M)", type: "bar", barMaxWidth: 8, itemStyle: { color: COLORS[sel % COLORS.length] }, data: f.values.map(M),
        markLine: f.alerts.length ? {
          symbol: "none", lineStyle: { color: "#f59e0b", type: "dashed" }, label: { color: "#f59e0b", formatter: "단절?" },
          data: f.alerts.map((a) => ({ xAxis: a.month })),
        } : undefined,
      },
      ...(hasQty ? [{ name: `단가 (USD/${f.unit ?? "단위"})`, type: "line" as const, yAxisIndex: 1, symbol: "none", lineStyle: { color: "#f87171", width: 2 }, itemStyle: { color: "#f87171" }, data: d.price.map((v) => (v == null ? null : +v.toFixed(4))) }] : []),
    ],
  };
  const detail2: EChartsOption = {
    ...baseOption(),
    xAxis: { type: "category", data: months, ...axis, splitLine: { show: false } },
    yAxis: { type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: "{value}%" } },
    series: [
      { name: "금액 YoY", type: "line", symbol: "none", lineStyle: { color: "#22d3ee", width: 2 }, itemStyle: { color: "#22d3ee" }, data: d.yoy.map(P) },
      ...(hasQty ? [
        { name: "수량 YoY", type: "bar" as const, barMaxWidth: 8, itemStyle: { color: "#a16207" }, data: d.qtyYoY.map(P) },
        { name: "단가 YoY", type: "line" as const, symbol: "none", lineStyle: { color: "#fb7185", width: 2 }, itemStyle: { color: "#fb7185" }, data: d.priceYoY.map(P) },
      ] : []),
    ],
  };
  const quarterly: EChartsOption | null = quarters.length ? {
    ...baseOption(),
    xAxis: { type: "category", data: quarters.map((q) => q.end), ...axis, splitLine: { show: false } },
    yAxis: [{ type: "value", name: "매출", ...axis }, { type: "value", name: "무역", ...axis, splitLine: { show: false } }],
    series: [
      {
        name: currency === "KRW" ? "분기 매출 (억원)" : "분기 매출 (USD M)", type: "bar", barMaxWidth: 18, itemStyle: { color: "#3b82f6" },
        data: quarters.map((q) => (currency === "KRW" ? Math.round(q.revenue / 1e8) : M(q.revenue))),
      },
      { name: "같은 분기 무역 합산 (USD M)", type: "line", yAxisIndex: 1, symbolSize: 6, lineStyle: { color: "#22d3ee", width: 2 }, itemStyle: { color: "#22d3ee" }, data: quarters.map((q) => M(q.trade)) },
    ],
  } : null;

  const last12 = months.map((m, i) => ({ m, i })).slice(-12).reverse();

  return (
    <>
      <div className="card">
        <h2 className="font-bold"><T ko="공급망 추적" en="Supply chain tracking" /></h2>
        <p className="mb-3 text-xs text-muted">부품 조달 → 생산거점 출하 → 고객향 반입 순 · 숫자는 최근 3개월 전년비(물량·단가 분해) · 카드를 누르면 아래 상세가 바뀝니다</p>
        <div className="space-y-4">
          {STAGES.map((st) => {
            const idx = flows.map((x, i) => (stageOf(x.role) === st.key ? i : -1)).filter((i) => i >= 0);
            if (!idx.length) return null;
            return (
              <div key={st.key}>
                <div className="mb-2 flex flex-wrap items-baseline gap-2"><b className="text-sm">{st.title}</b><span className="text-xs text-muted">{st.desc}</span></div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {idx.map((i) => {
                    const x = flows[i];
                    const v3 = yoy3m(x.values), q3 = yoy3m(x.qty.map((q, k) => (q && x.values[k] != null ? q : null)));
                    const p3 = v3.value != null && q3.value != null ? (1 + v3.value) / (1 + q3.value) - 1 : null;
                    // 최근 15개월 안에 수량 단위 변경·재분류가 있으면 전년비 물량·단가 분해는 비교 불가
                    const recentBreak = x.alerts.some((a) => (a.kind === "unit_change" || a.kind === "price_break") && a.month >= (x.lastMonth ? shiftMonth(x.lastMonth, -14) : ""));
                    return (
                      <button key={x.id} onClick={() => setSel(i)}
                        className={`min-w-0 rounded-xl border bg-panel2 p-3 text-left transition ${i === sel ? "border-accent ring-1 ring-accent" : "border-line hover:border-[#3d4575]"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold">{x.reporter} {x.flow}</span>
                          <span className="flex items-center gap-1">
                            {x.alerts.length > 0 && <span title={x.alerts.map((a) => `${a.month} ${a.detail}`).join(" / ")} className="rounded-full bg-amber-950 px-2 py-0.5 text-[11px] text-amber-300">⚠ 단절 {x.alerts.length}</span>}
                            <span className={`rounded-full px-2 py-0.5 text-[11px] ${ROLE_STYLE[x.role] ?? "bg-panel text-muted"}`}>{x.role}</span>
                          </span>
                        </div>
                        <div className="mt-1 text-sm">{x.label}</div>
                        <div className="mt-1 text-xs leading-relaxed text-muted">
                          지역 <span className="text-fg">{x.region}</span> · HS <span className="font-mono text-fg">{x.hs}</span> · 상대국 <span className="text-fg">{x.partner}</span>
                        </div>
                        <div className="mt-2 flex items-end justify-between gap-2 text-xs">
                          <span className="text-muted">신뢰도 {x.confidence}{x.include ? "" : " · 합산 제외"}{x.corrYoY != null ? ` · 상관 ${x.corrYoY.toFixed(2)}` : ""}</span>
                          <span className="text-right font-mono">
                            <span className={`text-sm font-bold ${tone(v3.value)}`} title={baseEffect(v3.value)}>{pct(v3.value)}{baseEffect(v3.value) ? <sup className="text-amber-300">*</sup> : null}</span>
                            {q3.value != null && !recentBreak && <span className="block text-[11px] text-muted">물량 <span className={tone(q3.value)}>{pct(q3.value)}</span> · 단가 <span className={tone(p3)}>{pct(p3)}</span></span>}
                            {q3.value != null && recentBreak && <span className="block text-[11px] text-amber-300">수량 단위 변경 — 물량·단가 분해 생략</span>}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-xl bg-panel2 p-4 text-sm leading-relaxed">
          <b>근거 — {f.label}</b>
          <p className="mt-1 text-[#c9cde3]">{f.rationale}</p>
          {f.caveat && <p className="mt-2 text-xs text-amber-400">⚠ {f.caveat}</p>}
          {f.alerts.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-amber-300">
              {f.alerts.map((a) => <li key={a.month + a.kind}>자동 감지 · <span className="font-mono">{a.month}</span> {a.detail}</li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold"><T ko="추적 흐름 합산 vs 매출" en="Tracked flows vs revenue" /></h2>
        <p className="text-xs text-muted">막대 = 흐름별 월 금액(USD M, {inc.length ? "합산 대상" : "업황 프록시"}) · 선 = 합산 YoY, 분기 매출 YoY(분기 종료월)</p>
        <EChart option={main} height={380} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card"><h2 className="font-bold"><T ko="금액 / 단가" en="Value / unit price" /> — {f.label}</h2><EChart option={detail1} height={320} /></div>
        <div className="card"><h2 className="font-bold">YoY 분해 {hasQty ? "(금액 = 수량 × 단가)" : ""}</h2><EChart option={detail2} height={320} /></div>
      </div>

      {quarterly && <div className="card"><h2 className="font-bold">회계분기 매출 vs 같은 기간 무역</h2><p className="text-xs text-muted">회계분기 기간에 월 중순이 들어가는 3개월 합산</p><EChart option={quarterly} height={320} /></div>}

      <div className="card overflow-x-auto">
        <h2 className="mb-3 font-bold">데이터 테이블 — {f.label}</h2>
        <table className="w-full font-mono text-xs">
          <thead className="text-muted"><tr className="border-b border-line">
            <th className="py-2 text-left"><T ko="월" en="Month" /></th><th className="text-right"><T ko="금액" en="Value" /></th><th className="text-right">수량{f.unit ? ` (${f.unit})` : ""}</th>
            <th className="text-right"><T ko="단가" en="Unit price" /></th><th className="text-right"><T ko="금액" en="Value" /> YoY</th><th className="text-right"><T ko="수량 YoY" en="Qty YoY" /></th><th className="text-right"><T ko="단가" en="Unit price" /> YoY</th>
          </tr></thead>
          <tbody>
            {last12.map(({ m, i }) => (
              <tr key={m} className="border-b border-line/50">
                <td className="py-2">{m}</td>
                <td className="text-right">{usd(f.values[i])}</td>
                <td className="text-right">{f.qty[i]?.toLocaleString() ?? "-"}</td>
                <td className="text-right">{d.price[i]?.toFixed(3) ?? "-"}</td>
                <td className={`text-right ${tone(d.yoy[i])}`}>{pct(d.yoy[i])}</td>
                <td className={`text-right ${tone(d.qtyYoY[i])}`}>{pct(d.qtyYoY[i])}</td>
                <td className={`text-right ${tone(d.priceYoY[i])}`}>{pct(d.priceYoY[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
