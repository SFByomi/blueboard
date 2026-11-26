"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { axis, baseOption, EChart } from "@/components/EChart";
import { InfoTip } from "@/components/InfoTip";

export type PriceLine = { id: string; label: string; unit: string; color: string; data: [string, number][] };  // [YYYY-MM, 단가(3개월 이동)]
export type Pair = { id: string; title: string; ticker: string; name: string; prices: PriceLine[]; stock: [string, number][]; note: string };

const PERIODS = [["1y", "1년", 12], ["2y", "2년", 24], ["all", "전체", 60]] as const;
// 선 색은 역할로 고정 — 색상 계열이 확실히 다른 셋(주황·초록·파랑). 비슷한 색(보라·회색·흰색)을 한 차트에 같이 쓰지 않음
const C_MAIN = "#f59e0b", C_SUB = "#22c55e", C_STOCK = "#38bdf8";
const pct = (v: number | null) => (v == null ? "-" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`);
const money = (v: number, unit: string) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}K/${unit}` : `$${v.toFixed(2)}/${unit}`);
const monthsBetween = (a: string, b: string) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));

/** 출하 단가(월)와 주가 지수(주)를 '기간 고점 = 100'으로 겹쳐 봄 — 어느 쪽이 먼저 꺾였는지 */
export function MemoryPair({ pair }: { pair: Pair }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("2y");
  const v = useMemo(() => {
    const lastDay = pair.stock.at(-1)?.[0] ?? `${pair.prices[0]?.data.at(-1)?.[0] ?? "2026-01"}-28`;
    const n = PERIODS.find((p) => p[0] === period)![2];
    const d = new Date(lastDay);
    d.setMonth(d.getMonth() - n);
    const from = d.toISOString().slice(0, 10);
    const norm = (pts: [string, number][]) => {
      const peak = pts.reduce((a, p) => (p[1] > a[1] ? p : a), pts[0]);
      return { peak, idx: pts.map(([x, y]) => [x, +((y / peak[1]) * 100).toFixed(1)] as [string, number]) };
    };
    const stockPts = pair.stock.filter(([x]) => x >= from);
    const stock = stockPts.length > 1 ? norm(stockPts) : null;
    const prices = pair.prices.map((p) => {
      const pts = p.data.filter(([m]) => `${m}-28` >= from).map(([m, y]) => [`${m}-15`, y] as [string, number]);
      return pts.length > 1 ? { ...p, ...norm(pts), last: pts.at(-1)!, prev3: pts.at(-4)?.[1] ?? null } : null;
    }).filter((x): x is NonNullable<typeof x> => x != null);
    return { stock, prices };
  }, [pair, period]);

  const main = v.prices[0];
  if (!main) return null;
  const sLast = v.stock?.idx.at(-1)?.[1] ?? null;
  const lead = v.stock ? monthsBetween(v.stock.peak[0], main.peak[0]) : null;  // 양수 = 주가 고점이 먼저
  const opt = {
    ...baseOption(),
    grid: { left: 40, right: 14, top: 16, bottom: 86 },
    legend: { ...baseOption().legend, bottom: 30 },
    dataZoom: [
      { type: "inside" as const, preventDefaultMouseMove: false },  // 끌어서 이동, 두 손가락·휠로 확대
      { type: "slider" as const, height: 16, bottom: 6, borderColor: "#2c3358", fillerColor: "rgba(56,189,248,0.15)", handleStyle: { color: "#38bdf8" }, textStyle: { color: "#8a90ad", fontSize: 10 }, brushSelect: false },
    ],
    tooltip: { ...baseOption().tooltip, valueFormatter: (x: unknown) => (x == null ? "-" : `${Number(x).toFixed(0)}`) },
    xAxis: { type: "time" as const, ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: "value" as const, ...axis, max: 100, min: (m: { min: number }) => Math.max(0, Math.floor(m.min / 10) * 10) },
    series: [
      ...v.prices.map((p, i) => ({ name: `${p.label} 단가`, type: "line" as const, showSymbol: false, data: p.idx, lineStyle: { color: i ? C_SUB : C_MAIN, width: i ? 1.5 : 2.5, type: i ? ("dashed" as const) : ("solid" as const) }, itemStyle: { color: i ? C_SUB : C_MAIN } })),
      ...(v.stock ? [{ name: `${pair.name} 주가`, type: "line" as const, showSymbol: false, data: v.stock.idx, lineStyle: { color: C_STOCK, width: 2 }, itemStyle: { color: C_STOCK } }] : []),
    ],
  };
  const tiles: [string, string, string][] = [
    [`${main.label} 단가`, money(main.last[1], main.unit), `${main.last[0].slice(0, 7)} · 3개월 전 대비 ${pct(main.prev3 ? (main.last[1] / main.prev3 - 1) * 100 : null)}`],
    ["단가 · 고점 대비", main.idx.at(-1)![1] >= 99.5 ? "고점" : pct(main.idx.at(-1)![1] - 100), main.idx.at(-1)![1] >= 99.5 ? "이 기간 중 가장 높음" : `고점 ${main.peak[0].slice(0, 7)}`],
    [`${pair.name} 주가 · 고점 대비`, pct(sLast == null ? null : sLast - 100), v.stock ? `고점 ${v.stock.peak[0].slice(0, 7)} · ${v.stock.idx.at(-1)![0].slice(5).replace("-", "/")} 기준` : "주가 이력 없음"],
    ["고점 순서", lead == null ? "-" : lead > 0 ? `주가 ${lead}개월 먼저` : lead < 0 ? `단가 ${-lead}개월 먼저` : "같은 달", "이 기간 안에서의 고점 기준"],
  ];
  return (
    <section id={pair.id} className="card min-w-0 scroll-mt-28 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-x-1.5 font-bold">{pair.title}<InfoTip>{pair.note}</InfoTip></h2>
          <p className="text-xs text-muted">출하 단가(월, 3개월 이동) · 주가(주) — 둘 다 이 기간의 고점 = 100</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-panel2 p-1 text-xs">
          {PERIODS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)} className={`rounded-md px-2.5 py-1 ${period === k ? "bg-panel font-bold text-fg shadow" : "text-muted hover:text-fg"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(([k, val, sub]) => (
          <div key={k} className="rounded-lg bg-panel2 p-3">
            <div className="text-xs text-muted">{k}</div>
            <div className="font-mono text-base font-bold sm:text-lg">{val}</div>
            <div className="text-[11px] text-muted">{sub}</div>
          </div>
        ))}
      </div>
      <EChart option={opt} height={310} />
      <div className="text-right text-xs"><Link href={`/stocks/${pair.ticker}`} className="text-muted hover:text-accent">{pair.name} 종목 화면 →</Link></div>
    </section>
  );
}
