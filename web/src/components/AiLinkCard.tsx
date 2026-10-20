"use client";

import { axis, baseOption, EChart } from "@/components/EChart";
import { combined } from "@/lib/ailabs";
import { InfoTip } from "@/components/InfoTip";
import type { AiArr, AiDeal } from "@/lib/queries";

const STATUS: Record<string, string> = { "회사 발표": "bg-up/20 text-up", "회사 공시": "bg-up/20 text-up", "보도(미확인)": "bg-amber-950 text-amber-300" };

/** 네오클라우드 종목: AI 랩·빅테크 계약 관계 + 회사 매출이 AI 랩 합산 ARR의 몇 %인지 */
export function AiLinkCard({ name, deals, arr, rev }: { name: string; deals: AiDeal[]; arr: AiArr[]; rev: { end: string; revenue: number }[] }) {
  const comb = combined(arr);
  const share = rev.flatMap((q) => { const c = comb[q.end.slice(0, 7)]; return c ? [[q.end, +((q.revenue * 4) / 1e9 / c * 100).toFixed(2)] as [string, number]] : []; });
  const direct = deals.filter((d) => /OpenAI|Anthropic/.test(d.counterparty));
  const conf = direct.filter((d) => !(d.status ?? "").includes("보도"));
  const opt = {
    ...baseOption(), grid: { left: 44, right: 12, top: 18, bottom: 24 }, legend: { show: false },
    tooltip: { ...baseOption().tooltip, valueFormatter: (v: unknown) => `${Number(v).toFixed(1)}%` },
    xAxis: { type: "category" as const, data: share.map((s) => s[0].slice(2, 7).replace("-", ".")), ...axis },
    yAxis: { type: "value" as const, name: "%", nameTextStyle: { color: "#8a90ad", fontSize: 10 }, ...axis },
    series: [{ name: "AI 랩 합산 ARR 대비", type: "bar" as const, data: share.map((s) => s[1]), itemStyle: { color: "#7c86ff", borderRadius: [3, 3, 0, 0] } }],
  };
  return (
    <div className="card min-w-0 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 font-bold">AI 랩 수요와의 연결
            <InfoTip>AI 랩 연환산 매출은 공개 수치가 띄엄띄엄이라(월 단위 보간) 분기 상관을 숫자로 내기엔 표본이 너무 적습니다 — 대신 계약 경로(직접 · 빅테크 경유)와 매출 비중 추이로 연결 강도를 봅니다. 비중이 오르면 랩 매출 성장보다 이 회사 매출이 빨리 느는 것(점유 확대), 내려가면 랩 성장의 몫을 다른 곳이 가져가는 것.</InfoTip></h2>
          <p className="mt-0.5 text-xs text-muted">OpenAI·Anthropic 매출이 {name} 매출로 이어지는 경로</p>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs ${conf.length ? "bg-up/20 text-up" : direct.length ? "bg-amber-950 text-amber-300" : "bg-panel2 text-muted"}`}>
          {conf.length ? `직접 계약 ${conf.map((d) => d.counterparty).join("·")}` : direct.length ? "직접 계약 보도만 (미확인)" : "직접 계약 확인 안 됨 — 빅테크 경유"}
        </span>
      </div>
      <ul className="divide-y divide-line/60">
        {deals.map((d) => (
          <li key={d.sort} className="py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold">{d.url ? <a className="hover:text-accent" href={d.url} target="_blank" rel="noreferrer">{d.counterparty}</a> : d.counterparty}</span>
              <span className={`rounded px-1.5 text-[11px] ${STATUS[d.status ?? ""] ?? "bg-panel2 text-muted"}`}>{d.status}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted"><span className="font-mono">{d.date}</span> · <span className="text-fg">{d.value}</span> · {d.link}</div>
            {d.note && <div className="mt-0.5 text-xs text-muted">{d.note}</div>}
          </li>
        ))}
      </ul>
      {share.length > 1 && (
        <div>
          <div className="text-xs text-muted">분기 매출 × 4 ÷ OpenAI·Anthropic 합산 연환산 매출 (최근 {share.at(-1)![1].toFixed(1)}%)</div>
          <EChart option={opt} height={170} />
        </div>
      )}
    </div>
  );
}
