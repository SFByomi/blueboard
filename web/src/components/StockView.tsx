"use client";

import type { EChartsOption } from "echarts";
import { useMemo, useState } from "react";
import { GradeBadge } from "@/components/FlowScores";
import { InfoTip } from "@/components/InfoTip";
import { SegTabs } from "@/components/SegTabs";
import { yoy3m } from "@/lib/estimate";
import { baseEffect, pct, ROLE_STYLE, shiftMonth, STAGES, stageOf, tone, usd, NON_USD } from "@/lib/format";
import { axis, baseOption, EChart } from "./EChart";

export type FlowData = {
  id: string; label: string; reporter: string | null; flow: string | null; region: string | null; hs: string | null;
  partner: string | null; role: string; confidence: string; rationale: string | null; caveat: string | null;
  include: boolean; unit: string | null; lastMonth: string | null;
  values: (number | null)[]; qty: (number | null)[];
  grade: string | null; best: number | null; bestLag: number | null; nYoy: number | null; recent: number | null; // etl/scores.py flow_scores
  alerts: { month: string; kind: string; detail: string }[];
};
export type QuarterRow = { end: string; revenue: number; revYoY: number | null; trade: number | null };

const COLORS = ["#3b82f6", "#10b981", "#a78bfa", "#f59e0b", "#f472b6", "#22d3ee"];
const M = (v: number | null) => (v == null ? null : +(v / 1e6).toFixed(2));
/** 금액이 아닌 시계열(랜섬웨어 '건', 발전 용량 'MW', 전력 판매 'MWh') — 차트·표에서 백만 달러로 나누지 않고 단위 그대로 */
const isCount = (x: { unit: string | null }) => NON_USD.has(x.unit ?? "");
const scaled = (x: FlowData) => (isCount(x) ? x.values : x.values.map(M));
const yoyArr = (a: (number | null)[]) => a.map((v, i) => (i >= 12 && v != null && a[i - 12] ? v / a[i - 12]! - 1 : null));
const P = (v: number | null) => (v == null ? null : +(v * 100).toFixed(1));
const SOLID = 8; // etl/scores.SOLID_YOY — 전년비 표본이 이보다 짧으면 등급 최대 C

/** 등급 한 줄 설명 — 왜 이 등급인지 (특히 '짧은 표본이라 C') */
export function gradeWhy(x: Pick<FlowData, "grade" | "best" | "bestLag" | "nYoy" | "recent">) {
  if (!x.grade) return "비교할 분기가 부족 (상장·실적 공시 이력이 짧음)";
  const lag = x.bestLag ? `${x.bestLag}분기 선행` : "같은 분기";
  const base = `매출 전년비와 ${lag} 상관 ${x.best?.toFixed(2) ?? "-"} · 표본 ${x.nYoy ?? "-"}분기`;
  const short = x.nYoy != null && x.nYoy < SOLID + 2 * (x.bestLag ?? 0) && (x.best ?? 0) >= 0.5;
  const weak = x.recent != null && x.best != null && x.recent < x.best - 0.4;
  return `${base}${short ? ` — 표본이 ${SOLID + 2 * (x.bestLag ?? 0)}분기 미만이라 상관이 높아도 최대 C` : ""}${weak ? ` · 최근 8분기 ${x.recent!.toFixed(2)}로 약해지는 중` : ""}`;
}

export function StockView({ flows, months, quarters, currency, initial = 0 }: { flows: FlowData[]; months: string[]; quarters: QuarterRow[]; currency: string; initial?: number }) {
  const [sel, setSel] = useState(initial);
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

  const opt = (o: EChartsOption): EChartsOption => ({ ...baseOption(), grid: { left: 52, right: 48, top: 20, bottom: 58 }, ...o });
  const main = opt({
    xAxis: { type: "category", data: months, ...axis, splitLine: { show: false } },
    yAxis: [
      { type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: shown.every(isCount) ? `{value}${shown[0].unit}` : "{value}M" } },
      { type: "value", ...axis, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, formatter: "{value}%" } },
    ],
    series: [
      ...shown.map((x) => ({
        name: x.label, type: "bar" as const, stack: "t", barMaxWidth: 12,
        itemStyle: { color: COLORS[flows.indexOf(x) % COLORS.length] }, data: scaled(x),
      })),
      { name: "합산 YoY", type: "line", yAxisIndex: 1, symbol: "none", lineStyle: { color: "#22d3ee", width: 2 }, itemStyle: { color: "#22d3ee" }, data: totalYoY.map(P) },
      { name: "매출 YoY", type: "line", yAxisIndex: 1, connectNulls: true, symbolSize: 7, lineStyle: { color: "#34d399", width: 2 }, itemStyle: { color: "#34d399" }, data: revByMonth },
    ],
  });

  const d = derived[sel];
  const hasQty = f.qty.some((v) => v);
  const detail1 = opt({
    xAxis: { type: "category", data: months, ...axis, splitLine: { show: false } },
    yAxis: [{ type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: isCount(f) ? `{value}${f.unit}` : "{value}M" } }, { type: "value", ...axis, splitLine: { show: false } }],
    series: [
      {
        name: isCount(f) ? `값 (${f.unit})` : "금액 (USD M)", type: "bar", barMaxWidth: 8, itemStyle: { color: COLORS[sel % COLORS.length] }, data: scaled(f),
        markLine: f.alerts.length ? {
          symbol: "none", lineStyle: { color: "#f59e0b", type: "dashed" }, label: { color: "#f59e0b", formatter: "단절?" },
          data: f.alerts.map((a) => ({ xAxis: a.month })),
        } : undefined,
      },
      ...(hasQty ? [{ name: `단가 (USD/${f.unit ?? "단위"})`, type: "line" as const, yAxisIndex: 1, symbol: "none", lineStyle: { color: "#f87171", width: 2 }, itemStyle: { color: "#f87171" }, data: d.price.map((v) => (v == null ? null : +v.toFixed(4))) }] : []),
    ],
  });
  const detail2 = opt({
    xAxis: { type: "category", data: months, ...axis, splitLine: { show: false } },
    yAxis: { type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: "{value}%" } },
    series: [
      { name: "금액 YoY", type: "line", symbol: "none", lineStyle: { color: "#22d3ee", width: 2 }, itemStyle: { color: "#22d3ee" }, data: d.yoy.map(P) },
      ...(hasQty ? [
        { name: "수량 YoY", type: "bar" as const, barMaxWidth: 8, itemStyle: { color: "#a16207" }, data: d.qtyYoY.map(P) },
        { name: "단가 YoY", type: "line" as const, symbol: "none", lineStyle: { color: "#fb7185", width: 2 }, itemStyle: { color: "#fb7185" }, data: d.priceYoY.map(P) },
      ] : []),
    ],
  });
  const quarterly: EChartsOption | null = quarters.length ? opt({
    xAxis: { type: "category", data: quarters.map((q) => q.end.slice(0, 7)), ...axis, splitLine: { show: false } },
    yAxis: [{ type: "value", ...axis }, { type: "value", ...axis, splitLine: { show: false } }],
    series: [
      {
        name: currency === "KRW" ? "분기 매출 (억원)" : "분기 매출 (USD M)", type: "bar", barMaxWidth: 18, itemStyle: { color: "#3b82f6" },
        data: quarters.map((q) => (currency === "KRW" ? Math.round(q.revenue / 1e8) : M(q.revenue))),
      },
      { name: "같은 분기 흐름 합산 (USD M)", type: "line", yAxisIndex: 1, symbolSize: 6, lineStyle: { color: "#22d3ee", width: 2 }, itemStyle: { color: "#22d3ee" }, data: quarters.map((q) => M(q.trade)) },
    ],
  }) : null;

  const last12 = months.map((m, i) => ({ m, i })).slice(-12).reverse();
  const used = STAGES.map((s2, k) => (flows.some((x) => stageOf(x.role) === s2.key) ? k : -1)).filter((k) => k >= 0);

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {STAGES.map((st, si) => {
          const idx = flows.map((x, i) => (stageOf(x.role) === st.key ? i : -1)).filter((i) => i >= 0);
          if (!idx.length) // 앞뒤 단계 사이에 비는 단계는 번호가 건너뛰어 보이지 않게 '추적 흐름 없음'으로 표시
            return used.length && si > Math.min(...used) && si < Math.max(...used) ? (
              <div key={st.key} className="flex flex-wrap items-baseline gap-2 text-muted"><b className="text-sm">{st.title}</b>
                <span className="text-xs">공개 통계로 추적할 수 있는 흐름 없음</span></div>
            ) : null;
          return (
            <div key={st.key}>
              <div className="mb-2 flex flex-wrap items-baseline gap-2"><b className="text-sm">{st.title}</b><span className="text-xs text-muted">{st.desc}</span></div>
              <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {idx.map((i) => {
                  const x = flows[i];
                  const v3 = yoy3m(x.values), q3 = yoy3m(x.qty.map((q, k) => (q && x.values[k] != null ? q : null)));
                  const p3 = v3.value != null && q3.value != null ? (1 + v3.value) / (1 + q3.value) - 1 : null;
                  // 최근 15개월 안에 수량 단위 변경·재분류가 있으면 전년비 물량·단가 분해는 비교 불가
                  const recentBreak = x.alerts.some((a) => (a.kind === "unit_change" || a.kind === "price_break") && a.month >= (x.lastMonth ? shiftMonth(x.lastMonth, -14) : ""));
                  return (
                    <button key={x.id} onClick={() => setSel(i)}
                      className={`min-w-0 rounded-xl border bg-panel2 p-3 text-left transition ${i === sel ? "border-accent ring-1 ring-accent" : "border-line hover:border-[#3d4575]"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-sm font-bold leading-snug">{x.label}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${ROLE_STYLE[x.role] ?? "bg-panel text-muted"}`}>{x.role}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted">{x.reporter} {x.flow} · {x.region} · HS <span className="font-mono">{x.hs}</span>{x.partner ? ` · ${x.partner}` : ""}</div>
                      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
                        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted" title={gradeWhy(x)}>
                          연관도 <GradeBadge grade={x.grade} />
                          {!x.include && <span>합산 제외</span>}
                          {x.alerts.length > 0 && <span className="rounded-full bg-amber-950 px-1.5 text-[11px] text-amber-300" title={x.alerts.map((a) => `${a.month} ${a.detail}`).join(" / ")}>⚠ 단절</span>}
                        </span>
                        <span className="ml-auto text-right font-mono">
                          <span className={`text-base font-bold ${tone(v3.value)}`} title={baseEffect(v3.value)}>{pct(v3.value)}{baseEffect(v3.value) ? <sup className="text-amber-300">*</sup> : null}</span>
                          {q3.value != null && !recentBreak && <span className="block text-[11px] text-muted">물량 <span className={tone(q3.value)}>{pct(q3.value, 0)}</span> · 단가 <span className={tone(p3)}>{pct(p3, 0)}</span></span>}
                          {q3.value != null && recentBreak && <span className="block text-[11px] text-amber-300">단위 변경 — 분해 생략</span>}
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

      <div className="rounded-xl bg-panel2 p-3.5 text-sm leading-relaxed">
        <div className="flex flex-wrap items-center gap-2"><b>{f.label}</b><GradeBadge grade={f.grade} /><span className="text-xs text-muted">{gradeWhy(f)}</span></div>
        {f.rationale && <p className="mt-1.5 text-[#c9cde3]">{f.rationale}</p>}
        {f.caveat && <p className="mt-1.5 text-xs text-amber-400">⚠ {f.caveat}</p>}
        {f.alerts.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-xs text-amber-300">
            {f.alerts.slice(0, 2).map((a) => <li key={a.month + a.kind}>자동 감지 · <span className="font-mono">{a.month}</span> {a.detail}</li>)}
            {f.alerts.length > 2 && <li className="text-muted" title={f.alerts.slice(2).map((a) => `${a.month} ${a.detail}`).join(" / ")}>그 밖에 {f.alerts.length - 2}건 (같은 종류)</li>}
          </ul>
        )}
      </div>

      <SegTabs size="xs" tabs={[
        { key: "sum", label: "흐름 합산 vs 매출", content: <><p className="mb-1 text-xs text-muted">막대 = 흐름별 월 {shown.every(isCount) ? `값(${shown[0].unit})` : "금액(USD M)"} ({inc.length ? "합산 대상" : "업황 지표"}) · 선 = 합산 전년비, 분기 매출 전년비</p><EChart option={main} height={320} /></> },
        { key: "price", label: "금액·단가", content: <><p className="mb-1 text-xs text-muted">선택한 흐름: {f.label}</p><EChart option={detail1} height={300} /></> },
        { key: "yoy", label: hasQty ? "물량·단가 분해" : "전년비", content: <><p className="mb-1 text-xs text-muted">금액 전년비{hasQty ? " = 수량 × 단가로 나눠 보기" : ""} · {f.label}</p><EChart option={detail2} height={300} /></> },
        ...(quarterly ? [{ key: "q", label: "분기 매출 비교", content: <><p className="mb-1 text-xs text-muted">회계분기 기간에 월 중순이 들어가는 3개월 합산</p><EChart option={quarterly} height={300} /></> }] : []),
        { key: "table", label: "데이터", content: (
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-xs tnum">
              <thead className="text-muted"><tr className="border-b border-line">
                <th className="py-2 text-left">월</th><th className="text-right">금액</th><th className="hidden text-right sm:table-cell">수량{f.unit && !isCount(f) ? ` (${f.unit})` : ""}</th>
                <th className="hidden text-right sm:table-cell">단가</th><th className="text-right">금액 YoY</th><th className="text-right">수량 YoY</th><th className="text-right">단가 YoY</th>
              </tr></thead>
              <tbody>
                {last12.map(({ m, i }) => (
                  <tr key={m} className="border-b border-line/50">
                    <td className="py-1.5 pr-2">{m}</td>
                    <td className="text-right">{isCount(f) ? (f.values[i] == null ? "-" : `${Math.round(f.values[i]!).toLocaleString()}${f.unit}`) : usd(f.values[i])}</td>
                    <td className="hidden text-right sm:table-cell">{f.qty[i]?.toLocaleString() ?? "-"}</td>
                    <td className="hidden text-right sm:table-cell">{d.price[i]?.toFixed(3) ?? "-"}</td>
                    <td className={`text-right ${tone(d.yoy[i])}`}>{pct(d.yoy[i], 0)}</td>
                    <td className={`text-right ${tone(d.qtyYoY[i])}`}>{pct(d.qtyYoY[i], 0)}</td>
                    <td className={`text-right ${tone(d.priceYoY[i])}`}>{pct(d.priceYoY[i], 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-muted">선택한 흐름: {f.label} · 최근 12개월</p>
          </div>
        ) },
      ]} />
      <p className="flex items-center gap-1 text-xs text-muted">카드를 누르면 아래 근거·차트가 그 흐름으로 바뀝니다
        <InfoTip>숫자는 최근 3개월 합의 전년비. 물량·단가는 수량이 함께 공표되는 흐름만 나눠 봅니다(금액 = 물량 × 단가). 연관도 A·B는 분기 매출 전년비와 0~2분기 시차로 함께 움직인 흐름이고, 그중 &lsquo;합산 대상&rsquo;이 매출 추정의 재료입니다. ⚠ 단절은 HS 세번 분할·신고 단위 변경 등으로 시계열이 끊긴 달.</InfoTip>
      </p>
    </div>
  );
}
