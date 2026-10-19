"use client";

import { axis, baseOption } from "@/components/EChart";
import { mini, Mini, refLine } from "@/components/MiniCard";
import type { PeerRevenue, Valuation } from "@/lib/queries";

const PEERS = [
  { id: "EMC", label: "EMC", color: "#3b82f6" },  // 台光電 Elite Material
  { id: "TUC", label: "TUC", color: "#f59e0b" },  // 台燿 Taiwan Union Technology
  { id: "ITEQ", label: "ITEQ", color: "#a78bfa" },  // 聯茂
];
const OWN = "#22c55e";
const FROM = "2022-01";
const p0 = (v: number | null | undefined) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`);
const yAx = (name: string, extra: object = {}) => ({ type: "value" as const, name, nameTextStyle: { color: "#8a90ad", fontSize: 10 }, ...axis, ...extra });
const tAx = { type: "time" as const, ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } };
const line = (name: string, color: string, data: [string, number | null][]) =>
  ({ name, type: "line" as const, showSymbol: false, data, lineStyle: { color, width: 2 }, itemStyle: { color } });

/** 월매출 전년비(최근 3개월 합 vs 1년 전 3개월 합) — 월별 들쭉날쭉을 눌러 업황 방향만 */
function yoy3(rows: PeerRevenue[]): [string, number | null][] {
  const by = new Map(rows.map((r) => [r.month, r.revenue]));
  const shift = (m: string, k: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); };
  const sum = (m: string, k: number) => [0, 1, 2].reduce((a, j) => a + (by.get(shift(m, k + j)) ?? NaN), 0);
  return rows.filter((r) => r.month >= FROM).map((r) => { const v = sum(r.month, 0) / sum(r.month, 12) - 1; return [`${r.month}-15`, Number.isFinite(v) ? +v.toFixed(4) : null]; });
}

/** 두산 피어 비교: 대만 CCL 3사 업황·밸류에이션 + 두산 지분가치 할인율 */
export function PeerSection({ rev, val, own }: { rev: PeerRevenue[]; val: Valuation[]; own: { month: string; yoy: number }[] }) {
  // ① 업황: 대만 3사 월매출 전년비 + 두산 전자BG 분기 전년비(점)
  const ys = PEERS.map((p) => ({ ...p, d: yoy3(rev.filter((r) => r.ticker === p.id)) }));
  const lastMonth = rev.at(-1)?.month;
  const ownPts = own.filter((o) => o.month >= FROM);
  const o1 = mini({
    tooltip: { ...baseOption().tooltip, valueFormatter: (v) => (v == null ? "-" : p0(Number(v))) },
    xAxis: tAx, yAxis: yAx("%", { axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${Math.round(v * 100)}` } }),
    series: [...ys.map((p) => line(p.label, p.color, p.d)),
      { name: "두산 전자BG", type: "scatter", symbolSize: 9, data: ownPts.map((o) => [`${o.month}-15`, +o.yoy.toFixed(4)]), itemStyle: { color: OWN, borderColor: "#151a33", borderWidth: 2 },
        markLine: { silent: true, symbol: "none", data: [refLine(0, "0 = 작년과 같음", "#8a90ad")] } }],
  }, true);

  // ② 밸류에이션: 대만 3사 EV/EBITDA
  const evs = PEERS.map((p) => ({ ...p, d: val.filter((v) => v.ticker === p.id && v.metric === "ev_ebitda" && v.date >= `${FROM}-01`).map((v) => [v.date, +v.value.toFixed(1)] as [string, number]) }));
  const o2 = mini({
    tooltip: { ...baseOption().tooltip, valueFormatter: (v) => (v == null ? "-" : `${Number(v).toFixed(1)}배`) },
    xAxis: tAx, yAxis: yAx("배", { min: 0 }),
    series: evs.map((p) => line(p.label, p.color, p.d)),
  }, true);

  // ③ 두산 지분가치 할인율 — 대신증권 'NAV 대비 할인율'과 같은 모양(자체사업 가치는 빼고 보수적으로)
  const disc = val.filter((v) => v.ticker === "000150.KS" && v.metric === "stake_discount");
  const dv = disc.map((v) => v.value);
  const avg = dv.length ? dv.reduce((a, b) => a + b, 0) / dv.length : null, mx = dv.length ? Math.max(...dv) : null, mn = dv.length ? Math.min(...dv) : null;
  const ownMult = val.filter((v) => v.ticker === "000150.KS" && v.metric === "own_ev_ebitda").at(-1)?.value;
  const now = disc.at(-1)?.value;
  const o3 = disc.length ? mini({
    tooltip: { ...baseOption().tooltip, valueFormatter: (v) => (v == null ? "-" : `${Number(v).toFixed(0)}%`) },
    xAxis: tAx, yAxis: yAx("%", { max: 100 }),
    series: [{ ...line("지분가치 할인율", OWN, disc.map((v) => [v.date, +(v.value * 100).toFixed(1)])), areaStyle: { color: "#22c55e18" },
      markLine: { silent: true, symbol: "none", data: [refLine(+(avg! * 100).toFixed(0), `평균 ${(avg! * 100).toFixed(0)}%`, "#ef4444"),
        refLine(+(mx! * 100).toFixed(0), `최대 ${(mx! * 100).toFixed(0)}%`, "#8a90ad"), refLine(+(mn! * 100).toFixed(0), `최소 ${(mn! * 100).toFixed(0)}%`, "#8a90ad")] } }],
  }) : undefined;

  const evNow = evs.map((p) => p.d.at(-1)?.[1]);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">피어 비교 · 지주사 할인 <span className="text-sm font-normal text-muted">대만 CCL 경쟁사 3곳 vs 두산</span></h2>
        <span className="text-xs text-muted">대만 공시(MOPS, FinMind) · DART 타법인출자현황 · 주가는 계산에만 사용</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Mini title={`① CCL 업황 — 경쟁사 매출이 늘고 있나?${lastMonth ? ` (${lastMonth})` : ""}`}
          value={<span className="text-lg">{ys.map((p, i) => <span key={p.id} className={i ? "ml-3" : ""}><span className="text-xs font-normal text-muted">{p.id} </span>{p0(p.d.at(-1)?.[1])}</span>)}</span>}
          note="대만 CCL 3사(EMC 台光電·TUC 台燿·ITEQ 聯茂) 월매출 전년비, 최근 3개월 합. 초록 점은 두산 전자BG 분기 매출 전년비 — 같이 오르면 업계 호황, 두산만 처지면 점유율 문제." option={o1} />
        <Mini title="② 경쟁사는 얼마에 거래되나? (EV/EBITDA)"
          value={<span className="text-lg">{evs.map((p, i) => <span key={p.id} className={i ? "ml-3" : ""}><span className="text-xs font-normal text-muted">{p.id} </span>{evNow[i] == null ? "-" : `${evNow[i]}배`}</span>)}</span>}
          note="(시가총액 + 순차입금) ÷ 최근 4분기 EBITDA. 같은 CCL 사업에 시장이 매기는 값. 두산은 지주사라 회사 전체 배수로는 비교가 안 돼 ③처럼 지분가치로 나눠 봄." option={o2} />
        <Mini title="③ 두산 지주사 할인 — 보유 지분가치 대비 시총" value={now == null ? "-" : `${(now * 100).toFixed(0)}% 할인`} tone={now != null && now < 0.2 ? "text-amber-300" : "text-up"}
          sub={avg != null ? `평균 ${(avg * 100).toFixed(0)}% · ${(mn! * 100).toFixed(0)}~${(mx! * 100).toFixed(0)}%` : undefined}
          note={`1 − 시총 ÷ (에너빌리티·로보틱스·오리콤 지분 시가 + 비상장 지분 장부가 − 별도 순차입금). 낮을수록 할인 해소.${ownMult != null && ownMult < 0 ? " 지금은 지분가치만으로 시총을 넘어 전자BG 등 자체사업은 사실상 0원 취급." : ""} 증권사 NAV는 자체사업 가치까지 더해 할인율이 더 높게 나옴.`}
          option={o3} empty="계산 데이터 없음" />
      </div>
    </section>
  );
}
