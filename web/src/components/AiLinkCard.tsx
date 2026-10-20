"use client";

import { axis, baseOption, EChart } from "@/components/EChart";
import { combined } from "@/lib/ailabs";
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">AI 랩 수요와의 연결 <span className="text-sm font-normal text-muted">OpenAI·Anthropic ARR이 {name} 매출로 이어지는 경로</span></h2>
        <span className={`rounded px-2 py-0.5 text-xs ${conf.length ? "bg-up/20 text-up" : direct.length ? "bg-amber-950 text-amber-300" : "bg-panel2 text-muted"}`}>
          {conf.length ? `직접 계약 ${conf.map((d) => d.counterparty).join("·")}` : direct.length ? "직접 계약 보도만 (미확인)" : "직접 계약 확인 안 됨 — 빅테크 경유"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-xs text-muted"><tr className="border-b border-line">
            <th className="py-1.5 text-left">상대</th><th className="text-left">시기</th><th className="text-left">규모</th><th className="text-left">연결</th><th className="text-left">상태</th>
          </tr></thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.sort} className="border-b border-line/50 align-top">
                <td className="py-1.5 font-bold">{d.url ? <a className="hover:text-accent" href={d.url} target="_blank" rel="noreferrer">{d.counterparty}</a> : d.counterparty}
                  {d.note && <div className="text-xs font-normal text-muted">{d.note}</div>}</td>
                <td className="whitespace-nowrap font-mono text-xs text-muted">{d.date}</td>
                <td className="text-xs">{d.value}</td>
                <td className="whitespace-nowrap text-xs text-muted">{d.link}</td>
                <td className="whitespace-nowrap"><span className={`rounded px-1.5 text-xs ${STATUS[d.status ?? ""] ?? "bg-panel2 text-muted"}`}>{d.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {share.length > 1 && (
        <div>
          <div className="text-xs text-muted">분기 매출 × 4 ÷ OpenAI·Anthropic 합산 ARR — 두 랩 매출이 커지는 만큼 이 회사 매출이 따라오는지 (최근 {share.at(-1)![1].toFixed(1)}%)</div>
          <EChart option={opt} height={170} />
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted">
        AI 랩 연환산 매출은 공개 수치가 띄엄띄엄이라(월 단위 보간) 분기 상관을 숫자로 내기엔 표본이 너무 적습니다 — 대신 계약 경로(직접 · 빅테크 경유)와 매출 비중 추이로 연결 강도를 봅니다.
        비중이 오르면 랩 매출 성장보다 이 회사 매출이 빨리 느는 것(점유 확대), 내려가면 랩 성장의 몫을 다른 곳이 가져가는 것.
      </p>
    </div>
  );
}
