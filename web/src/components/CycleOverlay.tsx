"use client";

import { useMemo, useState } from "react";
import { axis, baseOption, EChart } from "@/components/EChart";
import { InfoTip } from "@/components/InfoTip";

type Pt = [string, number];  // [YYYY-MM-DD, 값]
export type CycleData = {
  stock: Pt[];        // 주 단위 주가 지수
  unit: Pt[];         // 월별 출하 단가 (날짜는 그 달 15일)
  rev: Pt[];          // 분기 매출 (분기 말일)
  revEst?: Pt | null; // 이번: 아직 발표 전인 진행 분기 추정 (분기 말일)
  stockPeak: string;  // 주가 고점 주
  unitPeak: string;   // 출하 단가 고점 달(15일)
  revPeak: string;    // 2018: 매출 고점 분기 말 · 이번: 가장 최근 분기 말
  revPrev: string;    // 2018: 고점 한 분기 전 분기 말
};
export type CycleRows = Record<string, [string, string]>;  // 항목 → [2018, 이번]

const DAY = 864e5, MONTH = 30.44 * DAY;
const C = { old: "#f59e0b", now: "#38bdf8" };  // 2018 주황 · 이번 파랑
const METRICS = [["stock", "주가"], ["unit", "출하 단가"], ["rev", "분기 매출"], ["all", "모두"]] as const;  // 한 번에 두 선(2018·이번)만 보는 게 기본, 모두는 선택
// 2018년에 일어난 일 (출처: 마이크론 실적 발표·SEC 공시, 현물가 고점은 DDR4 4Gb 기준으로 널리 인용되는 시점)
const EVENTS: [string, string][] = [
  ["2018-03-11", "현물가 고점"], ["2018-06-08", "주가 고점"], ["2018-08-30", "매출 고점 분기 말"], ["2018-09-20", "가이던스 첫 하향"],
  ["2018-10-15", "출하 단가 고점"], ["2018-12-18", "수요 약화 인정"], ["2018-12-21", "주가 저점"],
];
const EST = "이번 분기 매출 추정(발표 전)";
type Key = "stock" | "unit" | "rev";
const NAMES: Record<Key, string> = { stock: "주가", unit: "출하 단가", rev: "분기 매출" };
const KEYS: Key[] = ["stock", "unit", "rev"];
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const koDate = (d: string) => `${d.slice(0, 4)}년 ${+d.slice(5, 7)}월 ${+d.slice(8, 10) <= 10 ? "초" : +d.slice(8, 10) <= 20 ? "중순" : "말"}`;
const norm = (pts: Pt[]): Pt[] => { const m = Math.max(...pts.map((p) => p[1])); return pts.map(([d, v]) => [d, +((v / m) * 100).toFixed(1)]); };

/** 2018년 사이클 위에 이번 사이클을 겹침 — 맞추는 기준을 고르고, 직접 밀어 보고, 확대·이동 */
export function CycleOverlay({ old, now, rows, lastDay }: { old: CycleData; now: CycleData; rows: CycleRows; lastDay: string }) {
  // 겹치는 기준: 이번 사이클의 기준일을 2018년의 어느 날에 맞출지
  const cases = useMemo(() => {
    const d = (a: string, b: string) => Date.parse(a) - Date.parse(b);
    return [
      { id: "stock", label: "주가 고점끼리", desc: "두 사이클의 주가 고점을 같은 날로", shift: d(old.stockPeak, now.stockPeak) },
      { id: "unit", label: "출하 단가 고점끼리", desc: "출하 단가가 지금까지 가장 높았던 달을 2018년 단가 고점(10월)에", shift: d(old.unitPeak, now.unitPeak) },
      { id: "revpeak", label: "이번 분기가 매출 고점이라면", desc: "가장 최근 분기를 2018년 매출 고점 분기(8월 말)에", shift: d(old.revPeak, now.revPeak) },
      { id: "revnext", label: "매출 고점이 한 분기 뒤라면", desc: "가장 최근 분기를 2018년 고점 한 분기 전(5월 말)에 — 실적이 아직 꺾이지 않았다고 볼 때", shift: d(old.revPrev, now.revPeak) },
    ];
  }, [old, now]);
  const [caseId, setCaseId] = useState("revnext");
  const [nudge, setNudge] = useState(0);  // 추가로 미는 개월 수 (+ = 이번 사이클을 2018년의 더 뒤쪽으로)
  const [metric, setMetric] = useState<(typeof METRICS)[number][0]>("stock");
  const cur = cases.find((c) => c.id === caseId)!;
  const shift = cur.shift + nudge * MONTH;
  const mapped = ymd(Date.parse(lastDay) + shift);  // 지금이 2018년 달력으로 언제인지

  // 고점 가정: 이번 사이클의 '지금까지 고점'이 최종 고점의 몇 %인지 — 고점이 아직 정해지지 않았으므로.
  // 자동(null) = 2018년에 같은 시점까지 나왔던 최고치(그때 최종 고점 = 100). 2018년 고점을 지난 위치면 100
  const [adj, setAdj] = useState<Record<Key, number | null>>({ stock: null, unit: null, rev: null });
  const auto = useMemo(() => {
    const at = (o: Pt[], n: Pt[]) => {
      if (!n.length) return 100;
      const end = Date.parse(n.at(-1)![0]) + shift + 3 * DAY;
      const seen = norm(o).filter(([d]) => Date.parse(d) <= end).map((p) => p[1]);
      return seen.length ? Math.min(100, Math.max(30, Math.round(Math.max(...seen)))) : 100;
    };
    return { stock: at(old.stock, now.stock), unit: at(old.unit, now.unit), rev: at(old.rev, now.rev) };
  }, [old, now, shift]);
  const scales = useMemo(() => ({ stock: adj.stock ?? auto.stock, unit: adj.unit ?? auto.unit, rev: adj.rev ?? auto.rev }), [adj, auto]);
  const shown = KEYS.filter((k) => metric === "all" || metric === k);

  const option = useMemo(() => {
    const move = (pts: Pt[]): Pt[] => pts.map(([d, v]) => [ymd(Date.parse(d) + shift), v]);
    const fit = (pts: Pt[], k: Key): Pt[] => pts.map(([d, v]) => [d, +((v * scales[k]) / 100).toFixed(1)]);  // 고점 가정만큼 낮춤
    const defs = [
      { key: "stock", name: "주가", o: norm(old.stock), n: move(fit(norm(now.stock), "stock")), width: 2, type: "solid" as const, symbol: false },
      { key: "unit", name: "출하 단가", o: norm(old.unit), n: move(fit(norm(now.unit), "unit")), width: 2, type: "dashed" as const, symbol: false },
      { key: "rev", name: "분기 매출", o: norm(old.rev), n: move(fit(norm(now.rev), "rev")), width: 1.5, type: "dotted" as const, symbol: true },
    ].filter((x) => metric === "all" || x.key === metric);
    const mk = (name: string, data: Pt[], color: string, x: (typeof defs)[number]) => ({
      name, type: "line" as const, data, showSymbol: x.symbol, symbol: "circle", symbolSize: 6,
      lineStyle: { color, width: metric === "all" ? x.width : 2.5, type: metric === "all" ? x.type : ("solid" as const) }, itemStyle: { color },
    });
    // 진행 분기 추정: 발표된 마지막 분기에서 점선으로 이어 빈 점으로 — 발표된 매출과 같은 눈금이라 100을 넘을 수 있음
    const revMax = Math.max(...now.rev.map((p) => p[1]));
    const estLine: Pt[] = now.revEst && metric !== "stock" && metric !== "unit"
      ? move(fit([[now.rev.at(-1)![0], (now.rev.at(-1)![1] / revMax) * 100], [now.revEst[0], (now.revEst[1] / revMax) * 100]], "rev")) : [];
    const yMax = estLine.length ? Math.max(100, Math.ceil(estLine[1][1] / 10) * 10) : 100;
    return {
      ...baseOption(),
      grid: { left: 40, right: 16, top: 26, bottom: 96 },
      legend: { ...baseOption().legend, bottom: 34, data: [...defs.flatMap((x) => [`2018 ${x.name}`, `이번 ${x.name}`]), ...(estLine.length ? [EST] : [])] },
      tooltip: { ...baseOption().tooltip, valueFormatter: (x: unknown) => (x == null ? "-" : `${Number(x).toFixed(0)}`) },
      xAxis: { type: "time" as const, ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
      yAxis: { type: "value" as const, ...axis, max: yMax, min: 0 },
      dataZoom: [
        { type: "inside" as const, startValue: "2017-01-01", endValue: "2019-08-01", preventDefaultMouseMove: false },  // 드래그로 이동, 두 손가락·휠로 확대
        { type: "slider" as const, height: 18, bottom: 8, borderColor: "#2c3358", fillerColor: "rgba(56,189,248,0.15)", handleStyle: { color: "#38bdf8" }, textStyle: { color: "#8a90ad", fontSize: 10 }, brushSelect: false },
      ],
      series: [
        ...defs.flatMap((x) => [mk(`2018 ${x.name}`, x.o, C.old, x), mk(`이번 ${x.name}`, x.n, C.now, x)]),
        ...(estLine.length ? [{ name: EST, type: "line" as const, data: estLine, showSymbol: true, symbol: "emptyCircle", symbolSize: 9, lineStyle: { color: C.now, width: 1.5, type: "dashed" as const }, itemStyle: { color: C.now } }] : []),
        { name: "지금", type: "line" as const, data: [] as Pt[], markLine: { symbol: "none", silent: true, lineStyle: { color: "#e6e8f2", type: "dashed" as const, width: 1 }, label: { color: "#e6e8f2", fontSize: 10, formatter: "지금" }, data: [{ xAxis: mapped }] } },
      ],
    };
  }, [old, now, shift, metric, mapped, scales]);

  const near = EVENTS.map(([d, name]) => ({ name, months: (Date.parse(mapped) - Date.parse(d)) / MONTH }));
  const fmt = (m: number) => (Math.abs(m) < 0.5 ? "바로 그때" : m > 0 ? `${m.toFixed(0)}개월 뒤` : `${(-m).toFixed(0)}개월 전`);
  const chip = (on: boolean) => `rounded-md px-2.5 py-1 ${on ? "bg-panel font-bold text-fg shadow" : "text-muted hover:text-fg"}`;

  return (
    <section id="cycle" className="card min-w-0 scroll-mt-28 space-y-3">
      <div>
        <h2 className="flex flex-wrap items-center gap-x-1.5 font-bold">2018년 사이클과 겹쳐 보기 — DRAM·마이크론
          <InfoTip>2016~2018년 클라우드 서버 사이클(주황) 위에 이번 사이클(파랑)을 겹칩니다. 무엇을 기준으로 맞추느냐에 따라 &lsquo;지금&rsquo;이 2018년의 다른 시점이 되므로, 기준을 골라 보고 슬라이더로 직접 밀어 볼 수 있습니다. 가로축은 2018년 사이클의 달력, 값은 그 사이클 고점 = 100 — 이번 사이클은 고점이 아직 정해지지 않아 &lsquo;고점 가정&rsquo;으로 조절합니다. 주가 = 마이크론 주 단위 지수, 출하 단가 = 한국 DRAM 수출 금액 ÷ 중량(3개월 이동), 분기 매출 = 마이크론. 차트는 끌어서 옮기고 두 손가락(또는 휠)으로 확대, 아래 막대로 구간 조절. 사이클마다 길이와 깊이가 달라 과거 경로가 반복된다는 뜻이 아닙니다.</InfoTip>
        </h2>
        <p className="text-xs text-muted">가로 = 2018년 사이클의 달력 · 주황 2018(고점 = 100) · 파랑 이번(아래 &lsquo;고점 가정&rsquo;만큼)</p>
      </div>

      <div className="space-y-2 text-xs">
        <div className="text-muted">겹치는 기준</div>
        <div className="flex flex-wrap gap-1.5">
          {cases.map((c) => (
            <button key={c.id} type="button" onClick={() => { setCaseId(c.id); setNudge(0); }}
              className={`rounded-full border px-3 py-1.5 ${caseId === c.id ? "border-accent bg-accent/20 font-bold text-accent" : "border-line text-muted hover:text-fg"}`}>{c.label}</button>
          ))}
        </div>
        <p className="text-muted">{cur.desc}</p>
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-muted">직접 밀기</span>
          <input type="range" min={-12} max={12} step={1} value={nudge} onChange={(e) => setNudge(+e.target.value)} className="min-w-0 flex-1 accent-sky-400" aria-label="이번 사이클을 앞뒤로 밀기" />
          <span className="w-16 shrink-0 text-right font-mono">{nudge === 0 ? "0" : `${nudge > 0 ? "+" : "−"}${Math.abs(nudge)}개월`}</span>
        </label>
      </div>

      <div className="rounded-lg bg-panel2 p-3 text-sm">
        <div>이 기준이면 지금은 <b className="text-sky-300">{koDate(mapped)}</b>에 해당</div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {near.map((e) => <span key={e.name}>{e.name} <b className={`font-mono ${e.months >= 0 ? "text-fg" : "text-amber-300"}`}>{fmt(e.months)}</b></span>)}
        </div>
        <div className="mt-1 text-[11px] text-muted">노란색 = 2018년 기준으로 아직 오지 않은 일</div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex gap-1 rounded-lg bg-panel2 p-1">
          {METRICS.map(([k, l]) => <button key={k} type="button" onClick={() => setMetric(k)} className={chip(metric === k)}>{l}</button>)}
        </div>
        <span className="text-muted">끌어서 이동 · 두 손가락으로 확대</span>
      </div>
      <div className="space-y-2 rounded-lg bg-panel2 p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-muted">고점 가정
            <InfoTip>이번 사이클은 주가·매출의 최종 고점이 아직 정해지지 않았습니다. &lsquo;지금까지의 고점&rsquo;이 최종 고점의 몇 %인지 가정하면 파란 선이 그만큼 낮아집니다. &lsquo;2018년에 맞춤&rsquo;은 2018년에 같은 시점까지 나왔던 최고치(최종 고점 = 100)를 그대로 씁니다 — 겹친 위치가 2018년 고점보다 앞이면 100보다 낮고, 고점을 지난 위치면 100입니다. 막대를 움직이면 직접 정한 값으로 바뀝니다. 가정일 뿐 전망이 아닙니다.</InfoTip>
          </span>
          <span className="flex gap-1.5">
            <button type="button" onClick={() => setAdj({ stock: null, unit: null, rev: null })} className={`rounded-full border px-2.5 py-1 ${KEYS.every((k) => adj[k] == null) ? "border-accent bg-accent/20 font-bold text-accent" : "border-line text-muted hover:text-fg"}`}>2018년에 맞춤</button>
            <button type="button" onClick={() => setAdj({ stock: 100, unit: 100, rev: 100 })} className={`rounded-full border px-2.5 py-1 ${KEYS.every((k) => adj[k] === 100) ? "border-accent bg-accent/20 font-bold text-accent" : "border-line text-muted hover:text-fg"}`}>지금까지가 고점</button>
          </span>
        </div>
        {shown.map((k) => (
          <label key={k} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-muted">{NAMES[k]}</span>
            <input type="range" min={30} max={100} step={1} value={scales[k]} onChange={(e) => setAdj((a) => ({ ...a, [k]: +e.target.value }))} className="min-w-0 flex-1 accent-sky-400" aria-label={`${NAMES[k]} 고점 가정`} />
            <span className="w-28 shrink-0 text-right font-mono">{scales[k] >= 100 ? "지금까지가 고점" : `최종 고점의 ${scales[k]}%`}</span>
          </label>
        ))}
        <p className="text-[11px] text-muted">
          {shown.map((k) => (scales[k] >= 100 ? `${NAMES[k]}: 이미 고점을 봤다고 가정` : `${NAMES[k]}: 최종 고점이 지금까지의 고점보다 +${(10000 / scales[k] - 100).toFixed(0)}% 위라고 가정`)).join(" · ")}
        </p>
      </div>
      <EChart option={option} height={340} keepZoom />
      {metric === "all" && <p className="text-[11px] text-muted">실선 주가 · 긴 점선 출하 단가 · 점(●) 분기 매출</p>}
      {now.revEst && (metric === "rev" || metric === "all") && <p className="text-[11px] text-muted">빈 점(○) = 아직 발표 전인 진행 분기의 우리 추정</p>}

      <dl className="divide-y divide-line text-xs">
        {Object.entries(rows).map(([k, [a, b]]) => (
          <div key={k} className="grid gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[7rem_1fr_1fr]">
            <dt className="text-muted">{k}</dt>
            <dd><span className="mr-1 font-bold" style={{ color: C.old }}>2018</span>{a}</dd>
            <dd><span className="mr-1 font-bold" style={{ color: C.now }}>이번</span>{b}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
