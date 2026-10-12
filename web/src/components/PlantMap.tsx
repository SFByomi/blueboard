"use client";

import * as echarts from "echarts";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { Spark } from "@/components/Spark";
import { pct, tone } from "@/lib/format";
import type { Plant } from "@/lib/queries";

export type FlowStat = { label: string; month: string | null; yoy3m: number | null; spark: number[]; money: boolean };

/** 분야별 색 — 지도 점·칩 공용 */
const CAT_COLOR: Record<string, string> = {
  "반도체 팹": "#f472b6", "첨단 패키징": "#c084fc", "조립·테스트": "#a78bfa", 반도체장비: "#818cf8",
  광통신: "#22d3ee", "서버·위탁생산": "#60a5fa", "변압기·배전": "#f59e0b", "전선·케이블": "#fbbf24",
  "발전·연료전지": "#f87171", "냉각·전력분배": "#38bdf8", "ESS·배터리": "#4ade80", "GPU 데이터센터": "#2dd4bf",
  전자부품: "#a3e635", "바이오 장비": "#94a3b8",
};
const STATUS = ["가동", "증설중", "계획", "중단"] as const;
const STATUS_STYLE: Record<string, string> = {
  가동: "bg-up/20 text-up", 증설중: "bg-amber-950 text-amber-300", 계획: "bg-panel2 text-muted", 중단: "bg-red-950 text-red-300",
};
// 상태별 점 모양: 가동=채운 원, 증설중=빈 원(굵은 테두리), 계획=빈 마름모, 중단=X 느낌의 핀
const STATUS_SYMBOL: Record<string, string> = { 가동: "circle", 증설중: "emptyCircle", 계획: "emptyDiamond", 중단: "pin" };

let registered = false;
function registerWorld() {
  if (registered) return;
  const topo = world as unknown as Topology<{ countries: GeometryCollection }>;
  echarts.registerMap("world", feature(topo, topo.objects.countries) as unknown as Parameters<typeof echarts.registerMap>[1]);
  registered = true;
}

const satUrl = (p: Plant) => `https://www.google.com/maps/@${p.lat},${p.lon},2500m/data=!3m1!1e3`;

/** 연결된 첫 무역 흐름의 최근 3개월 전년비 — '바쁜 공장' 정렬·목록 표시용 */
const busyOf = (p: Plant, stats: Record<string, FlowStat>) => (JSON.parse(p.flows) as string[]).map((f) => stats[f]?.yoy3m).find((v) => v != null) ?? null;

export function PlantMap({ plants, stats, initialQ = "" }: { plants: Plant[]; stats: Record<string, FlowStat>; initialQ?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const cats = useMemo(() => [...new Set(plants.map((p) => p.category))].sort((a, b) => plants.filter((p) => p.category === b).length - plants.filter((p) => p.category === a).length), [plants]);
  const [on, setOn] = useState<Set<string>>(() => new Set(cats));
  const [status, setStatus] = useState("");
  const [country, setCountry] = useState("");
  const [q, setQ] = useState(initialQ);
  const [sort, setSort] = useState<"cat" | "hot">("cat");

  const [sel, setSel] = useState<number | null>(null);
  const countries = useMemo(() => [...new Set(plants.map((p) => p.country ?? ""))].filter(Boolean).sort(), [plants]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return plants.filter((p) => on.has(p.category) && (!status || p.status === status) && (!country || p.country === country)
      && (!s || [p.company, p.ticker, p.site, p.city, p.product, p.country].some((v) => v?.toLowerCase().includes(s))))
      .sort((a, b) => sort === "hot" ? (busyOf(b, stats) ?? -9) - (busyOf(a, stats) ?? -9) : cats.indexOf(a.category) - cats.indexOf(b.category) || a.company.localeCompare(b.company, "ko"));
  }, [plants, on, status, country, q, sort, cats, stats]);
  const cur = plants.find((p) => p.id === sel) ?? null;

  useEffect(() => {
    registerWorld();
    chart.current = echarts.init(ref.current!, undefined, { renderer: "canvas" });
    chart.current.on("click", (e) => { const id = (e.data as { id?: number } | undefined)?.id; if (id) setSel(id); });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current!);
    return () => { ro.disconnect(); chart.current?.dispose(); };
  }, []);

  useEffect(() => {
    chart.current?.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "item", backgroundColor: "#1a1f3a", borderColor: "#2c3358", textStyle: { color: "#e6e8f2", fontSize: 12 },
        formatter: (p: { data?: { name?: string; sub?: string } }) => (p.data?.name ? `<b>${p.data.name}</b><br/>${p.data.sub ?? ""}` : "") },
      geo: {
        map: "world", roam: true, scaleLimit: { min: 1, max: 40 }, zoom: 1.15, center: [60, 25],
        itemStyle: { areaColor: "#141a33", borderColor: "#2c3358", borderWidth: 0.6 },
        emphasis: { disabled: true }, select: { disabled: true }, label: { show: false },
      },
      series: [{
        type: "scatter", coordinateSystem: "geo", symbolSize: (_: unknown, p: { data: { id: number } }) => (p.data.id === sel ? 16 : 9),
        data: shown.map((p) => ({
          id: p.id, value: [p.lon, p.lat], name: `${p.company} · ${p.site}`, sub: `${p.city ?? ""}, ${p.country ?? ""} · ${p.status ?? ""} · ${p.product ?? ""}`,
          symbol: STATUS_SYMBOL[p.status ?? "가동"] ?? "circle",
          itemStyle: { color: CAT_COLOR[p.category] ?? "#94a3b8", borderColor: p.id === sel ? "#ffffff" : CAT_COLOR[p.category] ?? "#94a3b8", borderWidth: p.id === sel ? 2 : 1.5, opacity: 0.95 },
        })),
      }],
    }, { notMerge: false, replaceMerge: ["series"] });
  }, [shown, sel]);

  // 선택한 공장으로 지도 이동
  useEffect(() => {
    if (cur) chart.current?.setOption({ geo: { center: [cur.lon, cur.lat], zoom: 6 } });
  }, [cur]);

  const toggle = (c: string) => setOn((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const reset = () => { chart.current?.setOption({ geo: { center: [60, 25], zoom: 1.15 } }); setSel(null); };
  const flows = cur ? (JSON.parse(cur.flows) as string[]) : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="card relative min-w-0 p-2">
        <div className="absolute right-4 top-3 z-10 text-right"><div className="font-mono text-2xl font-bold">{shown.length}</div><div className="text-xs text-muted">지도에 표시 중인 공장</div></div>
        <div ref={ref} className="h-[360px] w-full sm:h-[520px]" />
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1 text-xs text-muted">
          <span>드래그 이동 · 휠/핀치 확대 · 점 클릭</span>
          <button onClick={reset} className="rounded border border-line px-2 py-1 hover:text-fg">전체 보기</button>
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        <div className="card space-y-2">
          <div className="flex items-center justify-between"><b className="text-sm">분야</b>
            <button className="text-xs text-accent" onClick={() => setOn(on.size === cats.length ? new Set() : new Set(cats))}>{on.size === cats.length ? "전체 끄기" : "전체 켜기"}</button></div>
          <div className="flex flex-wrap gap-1.5">
            {cats.map((c) => (
              <button key={c} onClick={() => toggle(c)} className={`rounded-full border px-2.5 py-1 text-xs transition ${on.has(c) ? "border-transparent text-fg" : "border-line text-muted opacity-50"}`}
                style={on.has(c) ? { background: `${CAT_COLOR[c] ?? "#94a3b8"}33` } : undefined}>
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: CAT_COLOR[c] ?? "#94a3b8" }} />{c} <span className="text-muted">{plants.filter((p) => p.category === c).length}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            <span>● 가동</span><span>○ 증설중</span><span>◇ 계획</span><span>📍 중단</span>
          </div>
        </div>

        <div className="card space-y-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="회사·종목·도시·제품 검색" className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent" />
          <div className="grid grid-cols-2 gap-2">
            <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-lg border border-line bg-panel2 px-2 py-2 text-sm">
              <option value="">나라 전체</option>{countries.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-line bg-panel2 px-2 py-2 text-sm">
              <option value="">상태 전체</option>{STATUS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {cur && (
          <div className="card space-y-3" style={{ borderColor: CAT_COLOR[cur.category] }}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-lg font-bold">{cur.company} <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-normal ${STATUS_STYLE[cur.status ?? ""] ?? ""}`}>{cur.status}</span></div>
                <div className="text-sm" style={{ color: CAT_COLOR[cur.category] }}>{cur.category}{cur.ticker && <> · <Link href={`/stocks/${encodeURIComponent(cur.ticker)}`} className="text-accent">{cur.ticker} 종목 화면 →</Link></>}</div>
              </div>
              <button onClick={() => setSel(null)} className="text-xs text-muted hover:text-fg">닫기 ✕</button>
            </div>
            <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">위치</dt><dd>{cur.site}<div className="text-xs text-muted">{cur.city}, {cur.country}</div></dd>
              <dt className="text-muted">제품</dt><dd>{cur.product ?? "-"}</dd>
              {cur.note ? <><dt className="text-muted">증설·메모</dt><dd>{cur.note}</dd></> : null}
              <dt className="text-muted">기준</dt><dd>{cur.asof ?? "-"}</dd>
            </dl>
            <a href={satUrl(cur)} target="_blank" rel="noreferrer" className="inline-block rounded-lg border border-line px-3 py-1.5 text-xs hover:border-accent">위성 지도로 보기 (구글 지도) ↗</a>
            <div>
              <div className="mb-1 text-xs text-muted">연결된 무역 흐름 — 이 공장 출하·투입을 보는 세관 통계 (최근 3개월 전년비)</div>
              {flows.length === 0 && <div className="text-sm text-muted">공개 통계로 따로 잡히는 흐름 없음 (생산국 세관 데이터 미공개·내수 등)</div>}
              <ul className="space-y-1.5">
                {flows.map((f) => { const s = stats[f]; return s ? (
                  <li key={f} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0"><span className="block truncate">{s.label}</span><span className="text-xs text-muted">{s.month ?? "-"}</span></span>
                    <span className="flex shrink-0 items-center gap-2"><Spark values={s.spark} w={64} h={20} /><b className={`w-16 text-right font-mono ${tone(s.yoy3m)}`}>{pct(s.yoy3m, 0)}</b></span>
                  </li>
                ) : null; })}
              </ul>
            </div>
          </div>
        )}

        <div className="card">
          <div className="mb-2 flex items-center justify-between gap-2"><span className="text-sm font-bold">공장 목록 <span className="font-normal text-muted">{shown.length}</span></span>
            <select value={sort} onChange={(e) => setSort(e.target.value as "cat" | "hot")} className="rounded border border-line bg-panel2 px-2 py-1 text-xs">
              <option value="cat">분야순</option><option value="hot">바쁜 공장순 (연결 흐름 전년비)</option>
            </select></div>
          <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
            {shown.map((p) => {
              const y = busyOf(p, stats);
              return (
                <li key={p.id}>
                  <button onClick={() => setSel(p.id)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left hover:bg-panel2 ${p.id === sel ? "bg-panel2" : ""}`}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CAT_COLOR[p.category] ?? "#94a3b8" }} />
                      <span className="min-w-0"><span className="block truncate text-sm font-bold">{p.company}</span><span className="block truncate text-xs text-muted">{p.site} · {p.city} · {p.product}</span></span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {y != null && <span className={`font-mono text-xs ${tone(y)}`} title="연결된 첫 무역 흐름의 최근 3개월 전년비">{pct(y, 0)}</span>}
                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLE[p.status ?? ""] ?? ""}`}>{p.status}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
