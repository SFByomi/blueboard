"use client";

import { useMemo, useState } from "react";
import { axis, baseOption, EChart } from "@/components/EChart";
import { InfoTip } from "@/components/InfoTip";
import type { MacroObs } from "@/lib/queries";

const LAGS = [0, 12, 18, 24] as const;
const PERIODS = [["2012", "2012~", "2012-01"], ["2020", "2020~", "2020-01"], ["all", "전체", "2001-01"]] as const;
const C_HP = "#d95926", C_OER = "#3987e5";

type Pt = [string, number];
const ym = (d: string) => d.slice(0, 7);
/** 월별 지수 → 전년비 % (같은 달 12개월 전 값이 있을 때만) */
function yoy(rows: Pt[]): Pt[] {
  const m = new Map(rows.map(([d, v]) => [ym(d), v]));
  return rows.flatMap(([d, v]) => {
    const [y, mo] = ym(d).split("-");
    const p = m.get(`${+y - 1}-${mo}`);
    return p ? [[ym(d), (v / p - 1) * 100] as Pt] : [];
  });
}
const mom = (rows: Pt[]): Pt[] => rows.slice(1).map(([d, v], i) => [ym(d), (v / rows[i][1] - 1) * 100]);
const shift = (pts: Pt[], months: number): Pt[] => pts.map(([d, v]) => {
  const [y, m] = d.split("-").map(Number), t = y * 12 + (m - 1) + months;
  return [`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`, v];
});
function corr(a: Pt[], b: Pt[], from: string) {
  const mb = new Map(b);
  const xy = a.filter(([d]) => d >= from && mb.has(d)).map(([d, v]) => [v, mb.get(d)!]);
  if (xy.length < 24) return null;
  const n = xy.length, mx = xy.reduce((s, [x]) => s + x, 0) / n, my = xy.reduce((s, [, y]) => s + y, 0) / n;
  const sxy = xy.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0), sxx = xy.reduce((s, [x]) => s + (x - mx) ** 2, 0), syy = xy.reduce((s, [, y]) => s + (y - my) ** 2, 0);
  return sxy / Math.sqrt(sxx * syy);
}
const pct = (v: number | undefined, d = 2) => (v == null ? "-" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`);
const mlabel = (d: string) => `${d.slice(0, 4)}년 ${+d.slice(5, 7)}월`;

/** 집값(FHFA) 상승률을 N개월 앞당겨 CPI 자가주거비(OER) 상승률과 겹쳐 봄 + 최근 주거비·주담대 숫자 */
export function HousingSection({ rows }: { rows: MacroObs[] }) {
  const [lag, setLag] = useState<(typeof LAGS)[number]>(18);
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("2012");
  const s = useMemo(() => {
    const m: Record<string, Pt[]> = {};
    for (const r of rows) (m[r.series] ??= []).push([r.date, r.value]);
    return m;
  }, [rows]);
  const hp = useMemo(() => yoy(s.HPIPONM226S ?? []), [s]);
  const oer = useMemo(() => yoy(s.CUSR0000SEHC ?? []), [s]);
  const oerM = useMemo(() => mom(s.CUSR0000SEHC ?? []), [s]);
  const shM = useMemo(() => mom(s.CUSR0000SAH1 ?? []), [s]);
  const mort = s.MORTGAGE30US ?? [];
  const lead = useMemo(() => shift(hp, lag), [hp, lag]);
  const cors = useMemo(() => Object.fromEntries(LAGS.map((l) => [l, corr(shift(hp, l), oer, "2001-01")])), [hp, oer]);
  if (!hp.length || !oer.length) return <div className="card text-sm text-muted">수집 전입니다.</div>;

  const from = PERIODS.find((p) => p[0] === period)![2];
  const months = [...new Set([...lead.map(([d]) => d), ...oer.map(([d]) => d)])].filter((d) => d >= from).sort();
  const mo = new Map(oer), ml = new Map(lead);
  const lastOer = oer.at(-1)!, lastHp = hp.at(-1)!;
  const opt = {
    ...baseOption(),
    grid: { left: 44, right: 16, top: 16, bottom: 56 },
    tooltip: { ...baseOption().tooltip, valueFormatter: (v: unknown) => (v == null ? "-" : `${Number(v).toFixed(2)}%`) },
    xAxis: { type: "category" as const, data: months, ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true, formatter: (v: string) => v.slice(0, 4) } },
    yAxis: { type: "value" as const, ...axis, axisLabel: { ...axis.axisLabel, formatter: "{value}%" } },
    series: [
      { name: lag ? `집값 상승률 (FHFA, ${lag}개월 앞당김)` : "집값 상승률 (FHFA)", type: "line" as const, showSymbol: false, data: months.map((d) => ml.get(d) ?? null),
        lineStyle: { width: 2, color: C_HP }, itemStyle: { color: C_HP },
        markLine: { symbol: "none", silent: true, lineStyle: { color: "#8a90ad", type: "dashed" as const }, label: { color: "#8a90ad", fontSize: 10, formatter: "최근 관측" }, data: [{ xAxis: lastOer[0] }] } },
      { name: "OER 상승률 (CPI)", type: "line" as const, showSymbol: false, connectNulls: false, data: months.map((d) => mo.get(d) ?? null), lineStyle: { width: 2, color: C_OER }, itemStyle: { color: C_OER } },
    ],
  };
  const tiles: [string, string, string][] = [
    ["OER 전월비", pct(oerM.at(-1)?.[1]), `${mlabel(oerM.at(-1)![0])} · 직전 ${pct(oerM.at(-2)?.[1])}`],
    ["OER 전년비", pct(lastOer[1], 1), mlabel(lastOer[0])],
    ["주거 전체 전월비", pct(shM.at(-1)?.[1]), `${mlabel(shM.at(-1)![0])} · 직전 ${pct(shM.at(-2)?.[1])}`],
    ["집값 상승률 (FHFA)", pct(lastHp[1], 1), `전년비 · ${mlabel(lastHp[0])}`],
    ["30년 주담대", mort.length ? `${mort.at(-1)![1].toFixed(2)}%` : "-", mort.length ? `${mort.at(-1)![0].slice(5).replace("-", "/")} · 1년 ${Math.min(...mort.slice(-52).map((r) => r[1])).toFixed(1)}~${Math.max(...mort.slice(-52).map((r) => r[1])).toFixed(1)}%` : ""],
  ];
  const c = cors[lag];
  return (
    <div className="card min-w-0 space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([k, v, d]) => (
          <div key={k} className="rounded-lg bg-panel2 p-3">
            <div className="text-xs text-muted">{k}</div>
            <div className="font-mono text-lg font-bold">{v}</div>
            <div className="text-[11px] text-muted">{d}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-bold">집값 상승률 vs OER 상승률
          <InfoTip>전년비 %. 집값 = FHFA 구매 기준 주택가격지수(계절조정), OER = CPI 자가주거비(계절조정). &lsquo;앞당김&rsquo;은 집값 선을 N개월 오른쪽으로 옮긴 것 — 그 시점의 OER과 같은 칸에 놓임. 상관은 2001년 이후 월별 전년비끼리. 2025년 10월 CPI는 정부 셧다운으로 발표되지 않아 비어 있음. 출처 FHFA·BLS·Freddie Mac(FRED 경유)</InfoTip>
        </div>
        <div className="flex gap-1 rounded-lg bg-panel2 p-1 text-xs">
          {PERIODS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)} className={`rounded-md px-2.5 py-1 ${period === k ? "bg-panel font-bold text-fg shadow" : "text-muted hover:text-fg"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">집값 앞당김</span>
        <div className="flex gap-1 rounded-lg bg-panel2 p-1">
          {LAGS.map((l) => (
            <button key={l} type="button" onClick={() => setLag(l)} className={`rounded-md px-2.5 py-1 ${lag === l ? "bg-panel font-bold text-fg shadow" : "text-muted hover:text-fg"}`}>{l}개월</button>
          ))}
        </div>
        {c != null && <span className="font-mono text-muted">상관 {c.toFixed(2)}</span>}
      </div>
      <EChart option={opt} height={320} />
    </div>
  );
}
