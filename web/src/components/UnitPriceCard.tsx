"use client";

import { useMemo } from "react";
import { axis, baseOption, EChart } from "@/components/EChart";
import { Card } from "@/components/ui";
import { UNIT_PRICE, type UnitSeries } from "@/lib/unitprice";


const BASE_MONTHS = 24;

/** 월별 수출입 금액 ÷ 수량 = 출하 단가. 한 달 값은 제품 구성에 따라 출렁여 3개월 합으로 나눔(3개월 이동 단가).
 *  단위가 시리즈마다 달라(개·kg) 24개월 전 = 100인 지수로 겹쳐 봄 */
export function UnitPriceCard({ series }: { series: UnitSeries[] }) {
  const data = useMemo(() => series.map((s) => {
    const rows = s.rows.filter((r) => r.qty > 0 && r.value > 0).sort((a, b) => a.month.localeCompare(b.month));
    const ma = rows.map((r, i) => {
      const w = rows.slice(Math.max(0, i - 2), i + 1);
      return [r.month, w.length < 3 ? null : w.reduce((a, x) => a + x.value, 0) / w.reduce((a, x) => a + x.qty, 0)] as [string, number | null];
    }).filter((p): p is [string, number] => p[1] != null);
    const tail = ma.slice(-BASE_MONTHS - 1);
    const base = tail[0]?.[1];
    const at = (k: number) => ma.at(-1 - k)?.[1];
    const last = at(0), prev3 = at(3), prev12 = at(12);
    return { ...s, cfg: UNIT_PRICE[s.id], idx: base ? tail.map(([m, v]) => [m, +((v / base) * 100).toFixed(1)] as [string, number]) : [],
      lastMonth: ma.at(-1)?.[0], last, q: last && prev3 ? last / prev3 - 1 : null, y: last && prev12 ? last / prev12 - 1 : null, baseMonth: tail[0]?.[0] };
  }).filter((s) => s.idx.length > 6), [series]);
  if (!data.length) return null;
  const pct = (v: number | null) => (v == null ? "-" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(0)}%`);
  const tone = (v: number | null) => (v == null ? "" : v >= 0 ? "text-up" : "text-down");
  const money = (v: number | null | undefined, unit: string) => (v == null ? "-" : v >= 1000 ? `$${(v / 1000).toFixed(1)}K/${unit}` : `$${v.toFixed(2)}/${unit}`);
  const opt = {
    ...baseOption(),
    grid: { left: 40, right: 16, top: 24, bottom: 56 },
    tooltip: { ...baseOption().tooltip, valueFormatter: (v: unknown) => (v == null ? "-" : `${Number(v).toFixed(0)}`) },
    xAxis: { type: "category" as const, data: [...new Set(data.flatMap((s) => s.idx.map(([m]) => m)))].sort(), ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: "value" as const, ...axis, scale: true },
    series: data.map((s) => {
      const m = new Map(s.idx);
      return { name: s.label, type: "line" as const, showSymbol: false, connectNulls: true, data: [...new Set(data.flatMap((x) => x.idx.map(([mm]) => mm)))].sort().map((mm) => m.get(mm) ?? null),
        lineStyle: { color: s.cfg.color, width: 2 }, itemStyle: { color: s.cfg.color } };
    }),
  };
  return (
    <Card title="출하 단가" sub={`수출입 금액 ÷ 수량, 3개월 이동 · ${data[0].baseMonth} = 100`}
      info={<p>세관 신고 금액을 수량(개수 또는 kg)으로 나눈 값 — 제품 가격 그 자체가 아니라 그달 출하된 물건의 평균 단가라, 고용량·HBM처럼 비싼 제품 비중이 늘어도 오릅니다. 한 달 값은 출렁여 3개월 합으로 나눴고, 단위가 시리즈마다 달라 지수로 겹쳤습니다. 계약가는 현물가를 몇 달 늦게 따라가므로, 현물가가 꺾이면 이 선이 꺾이는지가 실적에 닿는 첫 신호입니다.</p>}>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {data.map((s) => (
          <div key={s.id} className="rounded-lg bg-panel2 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted"><span className="inline-block h-2 w-2 rounded-full" style={{ background: s.cfg.color }} />{s.label}</div>
            <div className="font-mono text-base font-bold">{money(s.last, s.cfg.unit)}</div>
            <div className="text-[11px] text-muted">{s.lastMonth} · 3개월 전 대비 <span className={tone(s.q)}>{pct(s.q)}</span> · 전년비 <span className={tone(s.y)}>{pct(s.y)}</span></div>
          </div>
        ))}
      </div>
      <EChart option={opt} height={260} />
    </Card>
  );
}
