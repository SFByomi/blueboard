"use client";

import type * as echarts from "echarts";
import { useMemo, useState } from "react";
import { axis, baseOption, EChart } from "@/components/EChart";
import { money } from "@/lib/format";
import type { CreditRow, FinraRow, MacroObs } from "@/lib/queries";

export type CreditCo = { ticker: string; name: string; grp: string | null };

const ebitda = (r?: CreditRow) => r?.ebitda_ttm ?? r?.ebit_ttm ?? null; // 감가상각이 없으면(한국 요약 현금흐름표) 영업이익으로 — 레버리지가 다소 높게 나옴
const lev = (r?: CreditRow) => { const e = ebitda(r); return r && r.net_debt != null && e && e > 0 ? r.net_debt / e : null; };
const cov = (r?: CreditRow) => (r && r.ebit_ttm != null && r.interest_ttm ? r.ebit_ttm / r.interest_ttm : null);
const dueCash = (r?: CreditRow) => (r && r.due_1y != null && r.cash ? r.due_1y / r.cash : null);
const de = (r?: CreditRow) => (r && r.equity && r.equity > 0 ? (r.currency === "KRW" ? (r.liabilities ?? 0) : (r.debt ?? 0)) / r.equity : null);

/** 주의·관찰·양호 — 레버리지·이자 감당·현금흐름·단기 만기 기준(장부, 단순 규칙) */
function risk(r?: CreditRow): ["주의" | "관찰" | "양호", string[]] {
  const why: string[] = [], l = lev(r), c = cov(r), d = dueCash(r);
  const e = ebitda(r), netCash = (r?.net_debt ?? 0) <= 0;
  let lvl = 0;
  if (netCash) {  // 순현금: 이자 부담은 기준이 아님 → 현금이 FCF 적자를 몇 년 버티나
    if (r?.fcf_ttm != null && r.fcf_ttm < 0) {
      const run = (r.cash ?? 0) / -r.fcf_ttm;
      lvl = run < 1.5 ? 2 : 1;
      why.push(`순현금이지만 FCF 적자 — 현금으로 ${run.toFixed(1)}년`);
    }
    return [(["양호", "관찰", "주의"] as const)[lvl], why];
  }
  if (e != null && e <= 0) { lvl = 2; why.push("EBITDA 적자인데 순부채"); }
  if (l != null && l > 4) { lvl = 2; why.push(`순부채/EBITDA ${l.toFixed(1)}배`); } else if (l != null && l > 2.5) { lvl = Math.max(lvl, 1); why.push(`순부채/EBITDA ${l.toFixed(1)}배`); }
  if (c != null && c < 2) { lvl = 2; why.push(`이자보상 ${c.toFixed(1)}배`); } else if (c != null && c < 5) { lvl = Math.max(lvl, 1); why.push(`이자보상 ${c.toFixed(1)}배`); }
  if (r?.fcf_ttm != null && r.fcf_ttm < 0) { lvl = Math.max(lvl, d != null && d > 1 ? 2 : 1); why.push(d != null && d > 1 ? "FCF 적자 + 1년 내 만기 > 현금" : "FCF 적자(차입·증자로 투자)"); }
  return [(["양호", "관찰", "주의"] as const)[lvl], why];
}
const RISK_STYLE = { 주의: "bg-red-950 text-red-300", 관찰: "bg-amber-950 text-amber-300", 양호: "bg-up/20 text-up" };
const x = (v: number | null, d = 1) => (v == null ? "-" : `${v.toFixed(d)}배`);

export function CreditSection({ rows, cos, ust, finra }: { rows: CreditRow[]; cos: CreditCo[]; ust: MacroObs[]; finra: FinraRow[] }) {
  const by = useMemo(() => {
    const m: Record<string, CreditRow[]> = {};
    for (const r of rows) (m[r.ticker] ??= []).push(r);
    return m;
  }, [rows]);
  const [sel, setSel] = useState<string | null>("CRWV");
  const groups = [...new Set(cos.filter((c) => by[c.ticker]).map((c) => c.grp ?? "기타"))];
  const order = { 주의: 0, 관찰: 1, 양호: 2 };
  const counts = { 주의: 0, 관찰: 0, 양호: 0 };
  for (const c of cos) if (by[c.ticker]) counts[risk(by[c.ticker].at(-1))[0]]++;

  return (
    <div className="space-y-6">
      <MarketPanel ust={ust} finra={finra} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">기업별 재무 신용 <span className="text-sm font-normal text-muted">최근 분기 장부 · 흐름은 최근 4분기 합</span></h2>
          <span className="text-xs"><span className={`rounded px-1.5 ${RISK_STYLE.주의}`}>주의 {counts.주의}</span> <span className={`rounded px-1.5 ${RISK_STYLE.관찰}`}>관찰 {counts.관찰}</span> <span className={`rounded px-1.5 ${RISK_STYLE.양호}`}>양호 {counts.양호}</span></span>
        </div>
        <div className="card min-w-0 overflow-x-auto">
          <table className="w-full min-w-[860px] whitespace-nowrap text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-line">
              <th className="py-2 text-left">회사</th><th className="text-left">판정</th><th className="text-right">순부채/EBITDA</th><th className="text-right">1년 전</th>
              <th className="text-right">이자보상</th><th className="text-right">총차입</th><th className="text-right">현금</th><th className="text-right">1년 내 만기÷현금</th>
              <th className="text-right">FCF(4분기)</th><th className="text-right">부채/자본</th><th className="text-right">기준</th>
            </tr></thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr><td colSpan={11} className="pt-3 pb-1 text-xs font-bold text-muted">{g}</td></tr>
                {cos.filter((c) => (c.grp ?? "기타") === g && by[c.ticker]).sort((a, b) => order[risk(by[a.ticker].at(-1))[0]] - order[risk(by[b.ticker].at(-1))[0]] || (lev(by[b.ticker].at(-1)) ?? -9) - (lev(by[a.ticker].at(-1)) ?? -9)).map((c) => {
                  const h = by[c.ticker], r = h.at(-1)!, y = h.at(-5), [lvl, why] = risk(r), l = lev(r), ly = lev(y);
                  return (
                    <tr key={c.ticker} onClick={() => setSel(c.ticker)} className={`cursor-pointer border-b border-line/50 font-mono hover:bg-panel2 ${sel === c.ticker ? "bg-panel2" : ""}`}>
                      <td className="py-1.5 font-sans"><b>{c.name}</b> <span className="text-xs text-muted">{c.ticker}</span></td>
                      <td className="font-sans" title={why.join(" · ")}><span className={`rounded px-1.5 text-xs ${RISK_STYLE[lvl]}`}>{lvl}</span></td>
                      <td className={`text-right ${l != null && l > 4 ? "text-down" : ""}`} title={r.ebitda_ttm == null && r.ebit_ttm != null ? "EBITDA 대신 영업이익 기준" : undefined}>
                        {(ebitda(r) ?? 1) <= 0 && (r.net_debt ?? 0) > 0 ? "적자" : (r.net_debt ?? 0) < 0 ? "순현금" : x(l)}{r.ebitda_ttm == null && r.ebit_ttm != null ? "*" : ""}</td>
                      <td className="text-right text-xs text-muted">{y ? ((y.net_debt ?? 0) < 0 ? "순현금" : x(ly)) : "-"}</td>
                      <td className={`text-right ${(cov(r) ?? 99) < 2 ? "text-down" : ""}`} title={r.interest_basis ?? undefined}>{x(cov(r))}</td>
                      <td className="text-right">{money(r.debt, r.currency)}</td><td className="text-right">{money(r.cash, r.currency)}</td>
                      <td className={`text-right ${(dueCash(r) ?? 0) > 1 ? "text-down" : ""}`}>{x(dueCash(r), 2)}</td>
                      <td className={`text-right ${(r.fcf_ttm ?? 0) < 0 ? "text-down" : ""}`}>{money(r.fcf_ttm, r.currency)}</td>
                      <td className="text-right">{x(de(r))}</td>
                      <td className="text-right text-xs text-muted">{r.q_end.slice(0, 7)}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
        {sel && by[sel] && <Detail co={cos.find((c) => c.ticker === sel)!} h={by[sel]} />}
        <p className="text-xs leading-relaxed text-muted">
          장부 기준(SEC XBRL·DART) — 시장 가격(회사채 스프레드)이 아니라 &lsquo;빚을 감당할 체력&rsquo;. 총차입 = 단·장기 차입금·사채 + 금융리스(운용리스 제외), 현금 = 현금성자산 + 단기 투자,
          이자보상 = 영업이익 ÷ 이자비용(최근 4분기, 이자비용 공시가 없으면 이자 지급액), 1년 내 만기 = 12개월 안 상환 원금(공시 시) 또는 유동성 차입금. 한국 종목은 회사 전체(두산은 별도) 기준이고 부채/자본은 부채총계 ÷ 자본, 감가상각이 요약 현금흐름표에 없어 * 표시는 EBITDA 대신 영업이익 기준(레버리지가 다소 높게 나옴).
          판정: 순부채 회사 — 주의 = 순부채/EBITDA 4배 초과·이자보상 2배 미만·EBITDA 적자·FCF 적자이면서 1년 내 만기가 현금보다 많음, 관찰 = 2.5배 초과·5배 미만·FCF 적자. 순현금 회사 — FCF 적자면 현금으로 버틸 햇수 1.5년 미만 주의, 그 외 관찰. 판정 칸에 마우스를 올리면 이유. 신용등급이 아닌 단순 규칙입니다.
        </p>
      </section>
    </div>
  );
}

function Detail({ co, h }: { co: CreditCo; h: CreditRow[] }) {
  const cur = h.at(-1)!.currency, unit = cur === "KRW" ? 1e12 : 1e9, u = cur === "KRW" ? "조원" : "$B";
  const q = h.map((r) => r.q_end.slice(2, 7).replace("-", "."));
  const v = (f: (r: CreditRow) => number | null | undefined) => h.map((r) => { const z = f(r); return z == null ? null : +(z / unit).toFixed(2); });
  const r2 = (f: (r: CreditRow) => number | null) => h.map((r) => { const z = f(r); return z == null ? null : +z.toFixed(2); });
  const o1: echarts.EChartsOption = { ...baseOption(), grid: { left: 52, right: 48, top: 28, bottom: 52 },
    xAxis: { type: "category", data: q, ...axis }, yAxis: [{ type: "value", name: u, ...axis }, { type: "value", name: "배", ...axis, splitLine: { show: false } }],
    series: [{ name: "총차입", type: "bar", data: v((r) => r.debt), itemStyle: { color: "#ef4444aa" } }, { name: "현금", type: "bar", data: v((r) => r.cash), itemStyle: { color: "#22c55eaa" } },
      { name: "순부채/EBITDA", type: "line", yAxisIndex: 1, data: r2(lev), lineStyle: { color: "#f59e0b", width: 2 }, itemStyle: { color: "#f59e0b" } }] };
  const o2: echarts.EChartsOption = { ...baseOption(), grid: { left: 52, right: 48, top: 28, bottom: 52 },
    xAxis: { type: "category", data: q, ...axis }, yAxis: [{ type: "value", name: u, ...axis }, { type: "value", name: "배", ...axis, splitLine: { show: false } }],
    series: [{ name: "영업현금흐름(4분기)", type: "bar", data: v((r) => r.ocf_ttm), itemStyle: { color: "#3b82f6aa" } }, { name: "설비투자(4분기)", type: "bar", data: v((r) => (r.capex_ttm == null ? null : -r.capex_ttm)), itemStyle: { color: "#a78bfaaa" } },
      { name: "FCF", type: "line", data: v((r) => r.fcf_ttm), lineStyle: { color: "#e6e8f2", width: 2 }, itemStyle: { color: "#e6e8f2" } },
      { name: "이자보상(배)", type: "line", yAxisIndex: 1, data: r2(cov), lineStyle: { color: "#f472b6", type: "dashed" }, itemStyle: { color: "#f472b6" } }] };
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="card min-w-0"><h3 className="font-bold">{co.name} · 차입금 vs 현금</h3><EChart option={o1} height={280} /></div>
      <div className="card min-w-0"><h3 className="font-bold">{co.name} · 현금흐름과 이자 감당</h3><EChart option={o2} height={280} /></div>
    </div>
  );
}

const TENORS = ["DGS3MO", "DGS6MO", "DGS1", "DGS2", "DGS3", "DGS5", "DGS7", "DGS10", "DGS20", "DGS30"];
const TLAB = ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];

function MarketPanel({ ust, finra }: { ust: MacroObs[]; finra: FinraRow[] }) {
  const s = useMemo(() => {
    const m: Record<string, [string, number][]> = {};
    for (const r of ust) (m[r.series] ??= []).push([r.date, r.value]);
    return m;
  }, [ust]);
  const last = s.DGS10?.at(-1)?.[0];
  const at = (sid: string, daysAgo: number) => {
    if (!last) return null;
    const t = Date.parse(last) - daysAgo * 864e5;
    return [...(s[sid] ?? [])].reverse().find(([d]) => Date.parse(d) <= t)?.[1] ?? null;
  };
  const curve: echarts.EChartsOption = { ...baseOption(), grid: { left: 44, right: 16, top: 24, bottom: 52 },
    xAxis: { type: "category", data: TLAB, ...axis }, yAxis: { type: "value", name: "%", scale: true, ...axis },
    series: ([[0, "오늘", "#e6e8f2"], [30, "1개월 전", "#3b82f6"], [365, "1년 전", "#8a90ad"]] as const).map(([d, n, c]) => ({ name: `${n}`, type: "line", data: TENORS.map((t) => at(t, d)), lineStyle: { color: c, width: d ? 1.5 : 2.5, type: d === 365 ? "dashed" : "solid" }, itemStyle: { color: c } })) };
  const d2 = new Map(s.DGS2 ?? []);
  const slope = (s.DGS10 ?? []).filter(([d]) => d2.has(d)).map(([d, v]) => [d, +(v - d2.get(d)!).toFixed(2)] as [string, number]);
  const sl: echarts.EChartsOption = { ...baseOption(), grid: { left: 44, right: 44, top: 24, bottom: 52 },
    xAxis: { type: "time", ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } }, yAxis: [{ type: "value", name: "%", scale: true, ...axis }, { type: "value", name: "%p", ...axis, splitLine: { show: false } }],
    series: [{ name: "10년물", type: "line", showSymbol: false, data: s.DGS10 ?? [], lineStyle: { color: "#3b82f6" }, itemStyle: { color: "#3b82f6" } },
      { name: "10년−2년", type: "line", yAxisIndex: 1, showSymbol: false, data: slope, lineStyle: { color: "#f59e0b" }, itemStyle: { color: "#f59e0b" }, areaStyle: { color: "#f59e0b22" } }] };

  const breadth = finra.filter((r) => r.dataset === "corporateMarketBreadth");
  const cats = [...new Set(breadth.map((r) => r.category))];
  const net = (cat: string) => {
    const by: Record<string, Record<string, number>> = {};
    for (const r of breadth) if (r.category === cat) (by[r.date] ??= {})[r.field] = r.value;
    const days = Object.keys(by).sort();
    const raw = days.map((d) => (by[d].advances ?? 0) - (by[d].declines ?? 0));
    return days.map((d, i) => [d, +(raw.slice(Math.max(0, i - 9), i + 1).reduce((a, b) => a + b, 0) / Math.min(10, i + 1)).toFixed(1)] as [string, number]);
  };
  const colors = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a78bfa"];
  const br: echarts.EChartsOption = { ...baseOption(), grid: { left: 52, right: 16, top: 24, bottom: 52 },
    xAxis: { type: "time", ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } }, yAxis: { type: "value", name: "종목 수", ...axis },
    series: cats.map((c, i) => ({ name: c, type: "line", showSymbol: false, data: net(c), lineStyle: { color: colors[i % 5], width: 1.5 }, itemStyle: { color: colors[i % 5] } })) };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">회사채 시장 <span className="text-sm font-normal text-muted">미 국채 곡선 · FINRA 회사채 상승/하락 종목 수</span></h2>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card min-w-0"><h3 className="font-bold">미 국채 수익률 곡선 <span className="text-xs font-normal text-muted">{last}</span></h3><EChart option={curve} height={260} /></div>
        <div className="card min-w-0"><h3 className="font-bold">10년물 · 장단기 금리차</h3><EChart option={sl} height={260} /></div>
        <div className="card min-w-0">
          <h3 className="font-bold">회사채 상승 − 하락 종목 수 <span className="text-xs font-normal text-muted">10일 평균, 분류별</span></h3>
          {cats.length ? <EChart option={br} height={260} /> : <p className="mt-6 text-sm text-muted">FINRA 데이터 수집 대기 — 다음 데이터 갱신(GitHub Actions)부터 채워집니다.</p>}
        </div>
      </div>
      <p className="text-xs text-muted">국채: 미 재무부(FRED DGS). 회사채 상승/하락: FINRA TRACE 시장 집계(Source: FINRA) — 가격이 오른 회사채(=수익률 하락)가 많으면 신용 시장이 편안, 내린 채권이 계속 많으면 스프레드 확대 신호. 종목별 회사채 스프레드는 무료 공개 API가 없어 넣지 못했습니다.</p>
    </section>
  );
}
