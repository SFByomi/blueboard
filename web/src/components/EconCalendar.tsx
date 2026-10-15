"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { EconEvent } from "@/lib/queries";

export const CAT_STYLE: Record<string, string> = {
  물가: "bg-sky-950 text-sky-300", 고용: "bg-teal-950 text-teal-300", 성장: "bg-indigo-950 text-indigo-300",
  무역: "bg-emerald-950 text-emerald-300", 금리: "bg-rose-950 text-rose-300", 실적: "bg-amber-950 text-amber-300",
};
const CATS = ["물가", "고용", "성장", "금리", "무역", "실적"];
const WD = ["일", "월", "화", "수", "목", "금", "토"];
/** 좁은 화면 달력 칸용 짧은 이름 */
const SHORT: [RegExp, string][] = [[/CPI/, "CPI"], [/PPI/, "PPI"], [/고용/, "고용"], [/PCE/, "PCE"], [/GDP/, "GDP"], [/FOMC/, "FOMC"],
  [/무역수지/, "무역"], [/속보/, "속보"], [/수출입 동향/, "수출입"], [/1~10일/, "10일"], [/1~20일/, "20일"]];
const short = (e: EconEvent) => e.ticker ? (e.ticker.includes(".") ? e.title.replace(/ 실적$/, "").replace(/\s*\(.*\)/, "").slice(0, 3) : e.ticker)
  : SHORT.find(([r]) => r.test(e.title))?.[1] ?? e.title.slice(0, 4);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function EventRow({ e, showDate = false }: { e: EconEvent; showDate?: boolean }) {
  const body = (
    <>
      <span className="w-12 shrink-0 font-mono text-xs text-muted">{showDate ? e.date.slice(5).replace("-", "/") : e.time_kst ?? "—"}</span>
      <span className={`shrink-0 rounded px-1.5 text-[11px] ${CAT_STYLE[e.cat ?? ""] ?? "bg-panel2 text-muted"}`}>{e.cat}</span>
      <span className="min-w-0 flex-1 truncate">{e.approx ? "~ " : ""}{e.title}</span>
      <span className="hidden shrink-0 text-xs text-muted sm:inline">{showDate && e.time_kst ? `${e.time_kst} · ` : ""}{e.country}</span>
    </>
  );
  const cls = "flex items-center gap-2 rounded px-1 py-1 text-sm";
  return e.ticker ? <Link href={`/stocks/${encodeURIComponent(e.ticker)}`} className={`${cls} hover:bg-panel2`} title={e.note ?? undefined}>{body}</Link>
    : <div className={cls} title={[e.source, e.note].filter(Boolean).join(" · ")}>{body}</div>;
}

/** 월간 달력 + 선택한 날 목록. today = 서버가 계산한 한국 날짜(YYYY-MM-DD) */
export function EconCalendar({ events, today }: { events: EconEvent[]; today: string }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [sel, setSel] = useState(today);
  const [off, setOff] = useState<Set<string>>(new Set());
  const shown = useMemo(() => events.filter((e) => !off.has(e.cat ?? "")), [events, off]);
  const byDay = useMemo(() => {
    const m: Record<string, EconEvent[]> = {};
    for (const e of shown) (m[e.date] ??= []).push(e);
    return m;
  }, [shown]);
  const [y, mo] = month.split("-").map(Number);
  const first = new Date(y, mo - 1, 1);
  const cells = Array.from({ length: 42 }, (_, i) => new Date(y, mo - 1, 1 - first.getDay() + i));
  const weeks = cells.slice(35).every((d) => d.getMonth() !== mo - 1) ? 5 : 6;
  const shift = (k: number) => { const d = new Date(y, mo - 1 + k, 1); setMonth(ymd(d).slice(0, 7)); };
  const months = [...new Set(events.map((e) => e.date.slice(0, 7)))];

  return (
    <div className="space-y-4">
      <div className="card min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <button onClick={() => shift(-1)} disabled={month <= months[0]} className="rounded px-2 text-lg text-muted hover:text-fg disabled:opacity-30">‹</button>
            <h2 className="text-lg font-bold">{y}년 {mo}월</h2>
            <button onClick={() => shift(1)} disabled={month >= months.at(-1)!} className="rounded px-2 text-lg text-muted hover:text-fg disabled:opacity-30">›</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {CATS.map((c) => (
              <button key={c} onClick={() => setOff((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; })}
                className={`rounded px-2 py-0.5 text-xs ${off.has(c) ? "bg-panel2 text-muted line-through" : CAT_STYLE[c]}`}>{c}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-xs text-muted">{WD.map((w, i) => <div key={w} className={`py-1 ${i === 0 ? "text-down" : ""}`}>{w}</div>)}</div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-line/40">
          {cells.slice(0, weeks * 7).map((d) => {
            const k = ymd(d), ev = byDay[k] ?? [], inMonth = d.getMonth() === mo - 1;
            return (
              <button key={k} onClick={() => setSel(k)}
                className={`flex min-h-[64px] flex-col items-stretch gap-0.5 bg-bg p-1 text-left sm:min-h-[96px] ${sel === k ? "ring-1 ring-inset ring-accent" : ""} ${inMonth ? "" : "opacity-40"}`}>
                <span className={`text-xs ${k === today ? "rounded bg-accent px-1 font-bold text-white" : d.getDay() === 0 ? "text-down" : "text-muted"} self-start`}>{d.getDate()}</span>
                {ev.slice(0, 3).map((e, i) => (
                  <span key={i} className={`truncate rounded px-1 text-[10px] leading-4 sm:text-[11px] ${CAT_STYLE[e.cat ?? ""] ?? ""}`}>
                    <span className="sm:hidden">{short(e)}</span><span className="hidden sm:inline">{e.title.replace(/^미국 |^한국 /, "")}</span></span>
                ))}
                {ev.length > 3 && <span className="px-1 text-[10px] text-muted">+{ev.length - 3}건</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="card min-w-0">
        <h3 className="mb-2 font-bold">{Number(sel.slice(5, 7))}월 {Number(sel.slice(8))}일 <span className="text-sm font-normal text-muted">{WD[new Date(sel).getDay()]}요일 · 한국 시간</span></h3>
        {(byDay[sel] ?? []).length ? (byDay[sel] ?? []).map((e, i) => <EventRow key={i} e={e} />) : <p className="text-sm text-muted">일정 없음</p>}
      </div>
    </div>
  );
}
