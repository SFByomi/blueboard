"use client";

import type * as echarts from "echarts";
import { useMemo, useState } from "react";
import { axis, baseOption, EChart } from "@/components/EChart";
import { mini, Mini, refLine } from "@/components/MiniCard";
import { money } from "@/lib/format";
import type { CreditRow, FinraRow, MacroObs, MarketCredit } from "@/lib/queries";

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

const pdFmt = (p?: number | null) => (p == null ? "-" : p < 0.0005 ? "<0.1%" : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`);
const pdTone = (p?: number | null) => (p == null ? "" : p >= 0.2 ? "text-down font-bold" : p >= 0.05 ? "text-amber-300" : "");

export function CreditSection({ rows, cos, ust, finra, mkt }: { rows: CreditRow[]; cos: CreditCo[]; ust: MacroObs[]; finra: FinraRow[]; mkt: MarketCredit[] }) {
  const pdBy = useMemo(() => {
    const m: Record<string, MarketCredit[]> = {};
    for (const r of mkt) (m[r.ticker] ??= []).push(r);
    return m;
  }, [mkt]);
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
          <table className="w-full min-w-[1000px] whitespace-nowrap text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-line">
              <th className="py-2 text-left">회사</th><th className="text-left">판정</th><th className="text-right" title="주가·변동성·부채로 계산한 5년 누적 부도확률(Merton)">주가 내재 5년 부도</th><th className="text-right">3개월 전</th><th className="text-right">순부채/EBITDA</th><th className="text-right">1년 전</th>
              <th className="text-right">이자보상</th><th className="text-right">총차입</th><th className="text-right">현금</th><th className="text-right">1년 내 만기÷현금</th>
              <th className="text-right">FCF(4분기)</th><th className="text-right">부채/자본</th><th className="text-right">기준</th>
            </tr></thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr><td colSpan={13} className="pt-3 pb-1 text-xs font-bold text-muted">{g}</td></tr>
                {cos.filter((c) => (c.grp ?? "기타") === g && by[c.ticker]).sort((a, b) => order[risk(by[a.ticker].at(-1))[0]] - order[risk(by[b.ticker].at(-1))[0]] || (lev(by[b.ticker].at(-1)) ?? -9) - (lev(by[a.ticker].at(-1)) ?? -9)).map((c) => {
                  const h = by[c.ticker], r = h.at(-1)!, y = h.at(-5), [lvl, why] = risk(r), l = lev(r), ly = lev(y);
                  const pm = pdBy[c.ticker], pNow = pm?.at(-1)?.pd5, p3 = pm?.at(-14)?.pd5;
                  return (
                    <tr key={c.ticker} onClick={() => setSel(c.ticker)} className={`cursor-pointer border-b border-line/50 font-mono hover:bg-panel2 ${sel === c.ticker ? "bg-panel2" : ""}`}>
                      <td className="py-1.5 font-sans"><b>{c.name}</b> <span className="text-xs text-muted">{c.ticker}</span></td>
                      <td className="font-sans" title={why.join(" · ")}><span className={`rounded px-1.5 text-xs ${RISK_STYLE[lvl]}`}>{lvl}</span></td>
                      <td className={`text-right ${pdTone(pNow)}`}>{pm ? pdFmt(pNow) : "-"}</td>
                      <td className="text-right text-xs text-muted">{pm ? pdFmt(p3) : "-"}</td>
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
        {sel && by[sel] && <Detail co={cos.find((c) => c.ticker === sel)!} h={by[sel]} pd={pdBy[sel] ?? []} />}
        <p className="text-xs leading-relaxed text-muted">
          주가 내재 부도확률 = Merton 모형(KMV·Bharath-Shumway 단순판): 시가총액·1년 주가 변동성·부도 기준 부채(1년 내 만기 + 나머지 차입의 절반)로 1년 부도거리를 구하고 5년 누적으로 환산.
          회사채 스프레드와 같은 &lsquo;시장 신호&rsquo;지만 주가 변동이 큰 성장주는 과대, 투자등급 대형주는 과소로 나오는 경향 — 순위·추세 위주로 보세요(주가 원 데이터는 출처 약관상 표시하지 않음).
          나머지는 장부 기준(SEC XBRL·DART) — &lsquo;빚을 감당할 체력&rsquo;. 총차입 = 단·장기 차입금·사채 + 금융리스(운용리스 제외), 현금 = 현금성자산 + 단기 투자,
          이자보상 = 영업이익 ÷ 이자비용(최근 4분기, 이자비용 공시가 없으면 이자 지급액), 1년 내 만기 = 12개월 안 상환 원금(공시 시) 또는 유동성 차입금. 한국 종목은 회사 전체(두산은 별도) 기준이고 부채/자본은 부채총계 ÷ 자본, 감가상각이 요약 현금흐름표에 없어 * 표시는 EBITDA 대신 영업이익 기준(레버리지가 다소 높게 나옴).
          판정: 순부채 회사 — 주의 = 순부채/EBITDA 4배 초과·이자보상 2배 미만·EBITDA 적자·FCF 적자이면서 1년 내 만기가 현금보다 많음, 관찰 = 2.5배 초과·5배 미만·FCF 적자. 순현금 회사 — FCF 적자면 현금으로 버틸 햇수 1.5년 미만 주의, 그 외 관찰. 판정 칸에 마우스를 올리면 이유. 신용등급이 아닌 단순 규칙입니다.
        </p>
      </section>
    </div>
  );
}

const C = { debt: "#ef4444", cash: "#22c55e", warn: "#f59e0b", bad: "#ef4444", ok: "#3b82f6", ref: "#8a90ad" };
function Detail({ co, h: all, pd }: { co: CreditCo; h: CreditRow[]; pd: MarketCredit[] }) {
  const h = all.slice(-12), r = h.at(-1)!;  // 최근 3년 — 막대가 너무 가늘어지지 않게
  const cur = r.currency, unit = cur === "KRW" ? 1e12 : 1e9, u = cur === "KRW" ? "조원" : cur === "EUR" ? "€B" : "$B";
  const q = h.map((z) => z.q_end.slice(2, 7).replace("-", "."));
  const xAx = { type: "category" as const, data: q, ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } };
  const yAx = (name: string, extra: object = {}) => ({ type: "value" as const, name, nameTextStyle: { color: "#8a90ad", fontSize: 10 }, ...axis, ...extra });
  const amt = (v: number | null | undefined) => (v == null ? null : +(v / unit).toFixed(2));
  const fmt = (v: unknown) => (v == null ? "-" : money(Number(v) * unit, cur));
  const [lvl, why] = risk(r);

  // ① 시장이 보는 부도 위험
  const pNow = pd.at(-1)?.pd5, p3 = pd.at(-14)?.pd5;
  const oPd = pd.length ? mini({
    tooltip: { ...baseOption().tooltip, valueFormatter: (v) => `${Number(v).toFixed(1)}%` },
    xAxis: { type: "time", ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } }, yAxis: yAx("%", { min: 0, max: (e: { max: number }) => Math.max(10, Math.ceil((e.max * 1.1) / 10) * 10) }),
    series: [{ name: "5년 부도확률", type: "line", showSymbol: false, data: pd.map((z) => [z.date, +(z.pd5 * 100).toFixed(2)]), lineStyle: { color: C.bad, width: 2 }, itemStyle: { color: C.bad }, areaStyle: { color: "#ef444422" },
      markLine: { silent: true, symbol: "none", data: [refLine(5, "5% 주의", C.warn), refLine(20, "20% 위험", C.bad)] } }],
  }) : undefined;

  // ② 빚 vs 현금 (같은 단위 두 막대 → 축 하나)
  const nd = r.net_debt ?? 0;
  const oDebt = mini({
    tooltip: { ...baseOption().tooltip, valueFormatter: fmt },
    xAxis: xAx, yAxis: yAx(u),
    series: [{ name: "총차입", type: "bar", data: h.map((z) => amt(z.debt)), itemStyle: { color: C.debt, borderRadius: [3, 3, 0, 0] }, barGap: "10%" },
      { name: "현금", type: "bar", data: h.map((z) => amt(z.cash)), itemStyle: { color: C.cash, borderRadius: [3, 3, 0, 0] } }],
  }, true);

  // ③ 순부채/EBITDA — 순현금·EBITDA 적자 분기는 비움
  const levs = h.map((z) => { const l = (z.net_debt ?? 0) > 0 ? lev(z) : null; return l == null ? null : +l.toFixed(2); });
  const l = lev(r), eb = ebitda(r);
  const levTxt = nd <= 0 ? "순현금" : eb != null && eb <= 0 ? "EBITDA 적자" : x(l);
  const oLev = levs.some((v) => v != null) ? mini({
    tooltip: { ...baseOption().tooltip, valueFormatter: (v) => (v == null ? "순현금·적자" : `${Number(v).toFixed(1)}배`) },
    xAxis: xAx, yAxis: yAx("배", { min: 0, max: (e: { max: number }) => Math.max(5, Math.ceil(e.max * 1.15)) }),
    series: [{ name: "순부채/EBITDA", type: "line", data: levs, symbolSize: 7, connectNulls: false, lineStyle: { color: C.warn, width: 2 }, itemStyle: { color: C.warn },
      markLine: { silent: true, symbol: "none", data: [refLine(2.5, "2.5배 관찰", C.ref), refLine(4, "4배 주의", C.bad)] } }],
  }) : undefined;

  // ④ 이자보상배율 — 너무 큰 값은 ±30에서 자르고 툴팁엔 실제 값
  const CAP = 30, covs = h.map((z) => cov(z));
  const oCov = covs.some((v) => v != null) ? mini({
    tooltip: { ...baseOption().tooltip, formatter: (ps) => { const p = (Array.isArray(ps) ? ps : [ps])[0] as { name: string; data: { real: number | null } | null };
      return `${p.name}<br/>이자보상 <b>${p.data?.real == null ? "-" : `${p.data.real.toFixed(1)}배`}</b>`; } },
    xAxis: xAx, yAxis: yAx("배"),
    series: [{ name: "이자보상", type: "bar", data: covs.map((v) => v == null ? null : { value: Math.max(-CAP, Math.min(CAP, +v.toFixed(2))), real: v,
      itemStyle: { color: v < 2 ? C.bad : v < 5 ? C.warn : C.ok, borderRadius: v >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } }),
      markLine: { silent: true, symbol: "none", z: 10, data: [refLine(2, "2배 미만 위험", C.bad)] } }],
  }) : undefined;
  const c = cov(r);

  // ⑤ 잉여현금흐름 — 부호로 색
  const oFcf = mini({
    tooltip: { ...baseOption().tooltip, formatter: (ps) => { const p = (Array.isArray(ps) ? ps : [ps])[0] as { name: string; dataIndex: number }; const z = h[p.dataIndex];
      return `${p.name} (최근 4분기 합)<br/>영업현금흐름 ${fmt(amt(z.ocf_ttm))}<br/>설비투자 ${fmt(amt(z.capex_ttm == null ? null : -z.capex_ttm))}<br/>FCF <b>${fmt(amt(z.fcf_ttm))}</b>`; } },
    xAxis: xAx, yAxis: yAx(u),
    series: [{ name: "FCF", type: "bar", data: h.map((z) => { const v = amt(z.fcf_ttm); return v == null ? null : { value: v, itemStyle: { color: v >= 0 ? C.cash : C.bad, borderRadius: v >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } }; }) }],
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold">{co.name} <span className="text-xs font-normal text-muted">{co.ticker} · {r.q_end.slice(0, 7)} 분기 기준</span></h3>
        <span className={`rounded px-1.5 text-xs ${RISK_STYLE[lvl]}`}>{lvl}</span>
        <span className="text-xs text-muted">{why.length ? why.join(" · ") : "빚 부담·이자 감당·현금흐름 모두 기준 안"}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Mini title="① 시장이 보는 5년 내 부도 가능성" value={pd.length ? pdFmt(pNow) : "-"} tone={pdTone(pNow)} sub={pd.length ? `3개월 전 ${pdFmt(p3)}` : undefined}
          note="주가 흔들림과 빚 규모로 계산(머튼 모형). 5% 넘으면 주의, 20% 넘으면 시장이 부도를 꽤 걱정하는 수준." option={oPd} empty="빚이 시가총액의 1% 미만이거나 주가 이력이 짧아 계산하지 않음" />
        <Mini title="② 빚과 현금" value={nd > 0 ? `순부채 ${money(nd, cur)}` : `순현금 ${money(-nd, cur)}`} tone={nd > 0 ? "text-down" : "text-up"}
          note="빨간 막대(빚)가 초록 막대(현금)보다 높을수록 갚아야 할 돈이 많은 상태." option={oDebt} />
        <Mini title="③ 번 돈으로 빚 갚는 데 몇 년? (순부채/EBITDA)" value={levTxt} tone={nd > 0 && ((l ?? 9) > 4 || (eb ?? 1) <= 0) ? "text-down" : nd > 0 && (l ?? 0) > 2.5 ? "text-amber-300" : "text-up"}
          note="한 해 버는 현금성 이익(EBITDA)으로 순부채를 다 갚는 데 걸리는 햇수. 2.5배 넘으면 관찰, 4배 넘으면 부담." option={oLev}
          empty="계속 순현금(빚보다 현금이 많음)이라 해당 없음" />
        <Mini title="④ 이자를 벌어서 낼 수 있나? (이자보상배율)" value={x(c)} tone={c == null ? "" : c < 2 ? "text-down" : c < 5 ? "text-amber-300" : "text-up"}
          note="영업이익이 이자의 몇 배인지. 2배 미만이면 빠듯, 0 아래면 영업 적자로 이자를 못 벎. 30배 넘는 값은 30으로 잘라 표시." option={oCov} empty="이자비용 공시 없음(빚이 거의 없음)" />
        <Mini title="⑤ 현금을 벌고 있나? (잉여현금흐름, 최근 4분기)" value={money(r.fcf_ttm, cur)} tone={(r.fcf_ttm ?? 0) < 0 ? "text-down" : "text-up"}
          note="영업으로 번 현금 − 설비투자. 빨간 막대면 쓰는 돈이 더 많아 빚·증자로 메우는 중(막대에 올리면 내역)." option={oFcf} />
      </div>
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
  const CAT: Record<string, string> = { "investment grade": "투자등급", "high yield": "하이일드" };
  const cats = Object.keys(CAT).filter((c) => breadth.some((r) => r.category === c));
  const net = (cat: string) => {  // (상승 − 하락) ÷ 거래된 종목 수, 10일 평균 → 분류별 종목 수 차이와 무관하게 비교
    const by: Record<string, Record<string, number>> = {};
    for (const r of breadth) if (r.category === cat) (by[r.date] ??= {})[r.field] = r.value;
    const days = Object.keys(by).sort();
    const raw = days.map((d) => { const { advances: a = 0, declines: b = 0, unchanged: u = 0 } = by[d]; return a + b + u ? (100 * (a - b)) / (a + b + u) : 0; });
    return days.map((d, i) => [d, +(raw.slice(Math.max(0, i - 9), i + 1).reduce((a, b) => a + b, 0) / Math.min(10, i + 1)).toFixed(1)] as [string, number]);
  };
  const colors = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a78bfa"];
  const br: echarts.EChartsOption = { ...baseOption(), grid: { left: 52, right: 16, top: 24, bottom: 52 },
    xAxis: { type: "time", ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } }, yAxis: { type: "value", name: "%", ...axis },
    series: cats.map((c, i) => ({ name: CAT[c], type: "line", showSymbol: false, data: net(c), lineStyle: { color: colors[i % 5], width: 1.5 }, itemStyle: { color: colors[i % 5] } })) };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">회사채 시장 <span className="text-sm font-normal text-muted">미 국채 곡선 · FINRA 회사채 상승−하락 비율</span></h2>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card min-w-0"><h3 className="font-bold">미 국채 수익률 곡선 <span className="text-xs font-normal text-muted">{last}</span></h3><EChart option={curve} height={260} /></div>
        <div className="card min-w-0"><h3 className="font-bold">10년물 · 장단기 금리차</h3><EChart option={sl} height={260} /></div>
        <div className="card min-w-0">
          <h3 className="font-bold">회사채 상승 − 하락 비율 <span className="text-xs font-normal text-muted">10일 평균, 투자등급·하이일드</span></h3>
          {cats.length ? <EChart option={br} height={260} /> : <p className="mt-6 text-sm text-muted">FINRA 데이터 수집 대기 — 다음 데이터 갱신(GitHub Actions)부터 채워집니다.</p>}
        </div>
      </div>
      <p className="text-xs text-muted">국채: 미 재무부(FRED DGS). 회사채 상승−하락: FINRA TRACE 시장 집계(Source: FINRA) — 그날 거래된 회사채 중 (가격 오른 수 − 내린 수) ÷ 전체, 10일 평균. 0 위면 신용 시장이 편안, 하이일드가 계속 0 아래면 스프레드 확대 신호(금리 상승기엔 투자등급도 같이 내림). 종목별 회사채 스프레드는 무료 공개 API가 없고 FINRA 사이트 수집은 약관상 금지라, 아래 표의 “주가 내재 부도확률”로 대신합니다.</p>
    </section>
  );
}
