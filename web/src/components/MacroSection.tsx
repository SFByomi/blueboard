"use client";

import type * as echarts from "echarts";
import { useMemo, useState } from "react";
import { axis, baseOption, EChart } from "@/components/EChart";
import type { MacroObs } from "@/lib/queries";

const PERIODS = [["1y", "1년", 1], ["3y", "3년", 3], ["5y", "5년", 5], ["all", "전체", 99]] as const;
type S = Record<string, [string, number][]>;

const tl = (v: number) => `$${(v / 1e3).toFixed(2)}T`;
const line = (name: string, data: [string, number][], color: string, extra: object = {}) =>
  ({ name, type: "line" as const, data, showSymbol: false, lineStyle: { width: 2, color }, itemStyle: { color }, ...extra });

/** 최신값과 기준 시점(약 4주·1년 전) 대비 변화 */
const bn = (v: number) => `$${Math.round(v).toLocaleString()}B`;
function Tile({ label, s, fmt, sub, dfmt = bn }: { label: string; s: [string, number][]; fmt: (v: number) => string; sub: string; dfmt?: (v: number) => string }) {
  const last = s.at(-1);
  if (!last) return null;
  const ago = (days: number) => [...s].reverse().find(([d]) => Date.parse(last[0]) - Date.parse(d) >= days * 864e5)?.[1];
  const chg = (days: number) => { const a = ago(days); return a == null ? null : last[1] - a; };
  const c4 = chg(28), c52 = chg(365);
  const f = (v: number | null) => (v == null ? "-" : `${v >= 0 ? "+" : "−"}${dfmt(Math.abs(v))}`);
  return (
    <div className="rounded-lg bg-panel2 p-3">
      <div className="text-xs text-muted">{label} <span className="text-[10px]">{last[0]}</span></div>
      <div className="font-mono text-lg font-bold">{fmt(last[1])}</div>
      <div className="font-mono text-[11px] text-muted">4주 {f(c4)} · 1년 {f(c52)}</div>
      <div className="mt-0.5 text-[11px] text-muted">{sub}</div>
    </div>
  );
}

export function MacroSection({ rows }: { rows: MacroObs[] }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("3y");
  const all = useMemo(() => {
    const m: S = {};
    for (const r of rows) (m[r.series] ??= []).push([r.date, r.value]);
    return m;
  }, [rows]);
  const s = useMemo(() => {
    const yrs = PERIODS.find((p) => p[0] === period)![2];
    const last = rows.at(-1)?.date ?? "2026-01-01";
    const from = new Date(Date.parse(last) - yrs * 365.25 * 864e5).toISOString().slice(0, 10);
    return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.filter(([d]) => d >= from)])) as S;
  }, [all, rows, period]);
  const m2yoy = useMemo(() => {
    const m = all.M2SL ?? [];
    return m.map(([d, v], i) => [d, i >= 12 ? +((v / m[i - 12][1] - 1) * 100).toFixed(2) : null] as [string, number | null])
      .filter(([d, v]) => v != null && d >= (s.M2SL?.[0]?.[0] ?? "")) as [string, number][];
  }, [all, s]);

  const opt = (series: echarts.SeriesOption[], yName: string, y2?: string): echarts.EChartsOption => ({
    ...baseOption(),
    grid: { left: 52, right: y2 ? 52 : 16, top: 28, bottom: 52 },
    tooltip: { ...baseOption().tooltip as object, trigger: "axis",
      valueFormatter: (v) => (v == null ? "-" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })) },
    xAxis: { type: "time", ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: [{ type: "value", name: yName, nameTextStyle: { color: "#8a90ad", fontSize: 11 }, scale: true, ...axis },
      ...(y2 ? [{ type: "value" as const, name: y2, nameTextStyle: { color: "#8a90ad", fontSize: 11 }, scale: true, ...axis, splitLine: { show: false } }] : [])],
    series,
  });
  const T = (d: [string, number][]) => d.map(([x, v]) => [x, +(v / 1e3).toFixed(3)] as [string, number]);
  const charts = useMemo(() => [
    { title: "연준 총자산 · 순유동성", note: "순유동성 = 연준 총자산 − TGA − 역레포", option: opt([
      line("연준 총자산", T(s.WALCL ?? []), "#3b82f6"), line("순유동성", T(s.NETLIQ ?? []), "#22c55e")], "$조") },
    { title: "TGA · 역레포 · 지급준비금", note: "TGA가 늘면(국채 발행·세수) 시중 유동성이 빠짐", option: opt([
      line("TGA(재무부 계좌)", T(s.WTREGEN ?? []), "#f59e0b"), line("역레포", T(s.RRPONTSYD ?? []), "#a78bfa"), line("지급준비금", T(s.WRESBAL ?? []), "#38bdf8")], "$조") },
    { title: "M2 통화량", note: "막대 = 전년비(오른쪽 축)", option: opt([
      line("M2", T(s.M2SL ?? []), "#e6e8f2"),
      { name: "M2 전년비 %", type: "bar", yAxisIndex: 1, data: m2yoy, itemStyle: { color: "#3b82f680" }, barMaxWidth: 6 }], "$조", "%") },
    { title: "연방부채 ÷ M2 · ÷ GDP", note: "분기, 부채 = 연방정부 총부채(GFDEBTN)", option: opt([
      line("부채/M2 (배)", (s.DEBT_M2 ?? []).map(([d, v]) => [d, +v.toFixed(3)] as [string, number]), "#f472b6"),
      line("부채/GDP (%)", (s.DEBT_GDP ?? []).map(([d, v]) => [d, +(v * 100).toFixed(1)] as [string, number]), "#94a3b8", { yAxisIndex: 1, lineStyle: { width: 2, color: "#94a3b8", type: "dashed" } })], "배", "%") },
  ], [s, m2yoy]);

  if (!rows.length) return null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Tile label="연준 총자산" s={all.WALCL ?? []} fmt={tl} sub="QT면 감소" />
        <Tile label="순유동성" s={all.NETLIQ ?? []} fmt={tl} sub="총자산 − TGA − 역레포" />
        <Tile label="TGA" s={all.WTREGEN ?? []} fmt={(v) => `$${v.toFixed(0)}B`} sub="재무부 현금 계좌" />
        <Tile label="M2" s={all.M2SL ?? []} fmt={tl} sub="월간, 계절조정" />
        <Tile label="연방부채 ÷ M2" s={all.DEBT_M2 ?? []} fmt={(v) => `${v.toFixed(2)}배`} dfmt={(v) => `${v.toFixed(2)}배`} sub="분기" />
      </div>
      <div className="flex justify-end gap-1">
        {PERIODS.map(([v, l]) => (
          <button key={v} onClick={() => setPeriod(v)} className={`rounded-lg border px-3 py-1 text-sm ${period === v ? "border-accent bg-accent/15 text-fg" : "border-line text-muted hover:text-fg"}`}>{l}</button>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {charts.map((c) => (
          <div key={c.title} className="card min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-bold">{c.title}</h3><span className="text-xs text-muted">{c.note}</span></div>
            <EChart option={c.option} height={280} />
          </div>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted">
        출처 FRED: WALCL(연준 총자산, 주간 수요일)·WTREGEN(TGA, 주간)·RRPONTSYD(역레포, 일별 → 수요일 값)·WRESBAL(지급준비금)·M2SL(M2)·GFDEBTN(연방부채, 분기)·GDP(명목, 연율).
        순유동성은 시장 유동성의 흔한 근사(연준이 푼 돈 중 재무부 계좌·역레포에 묶이지 않은 몫)로, 위험자산 흐름과 자주 비교됩니다. 부채/M2는 분기 평균 M2 대비.
      </p>
    </div>
  );
}
