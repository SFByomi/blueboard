"use client";

import type * as echarts from "echarts";
import { axis, baseOption, EChart } from "@/components/EChart";
import { InfoTip } from "@/components/InfoTip";
import type { MarketCredit } from "@/lib/queries";

// 회사채 체결가(TRACE)는 개인 키로 못 받아(약관상 화면 수집도 금지) — 주가·변동성·부채로 역산한 머튼 모형 스프레드를 대신 보여준다
export const SPREAD_SET: { ticker: string; name: string; color: string }[] = [
  { ticker: "CRWV", name: "코어위브", color: "#ef4444" },
  { ticker: "CORZ", name: "코어 사이언티픽", color: "#a855f7" },
  { ticker: "APLD", name: "어플라이드 디지털", color: "#3b82f6" },
  { ticker: "CIFR", name: "사이퍼", color: "#06b6d4" },
  { ticker: "WULF", name: "테라울프", color: "#eab308" },
  { ticker: "IREN", name: "아이렌", color: "#f97316" },
  { ticker: "NBIS", name: "네비우스", color: "#ec4899" },
  { ticker: "ORCL", name: "오라클", color: "#22c55e" },
  { ticker: "META", name: "메타", color: "#9ca3af" },
];

export function ImpliedSpread({ rows }: { rows: MarketCredit[] }) {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const series = SPREAD_SET.map((s) => {
    const m = new Map(rows.filter((r) => r.ticker === s.ticker && r.spread_bp != null).map((r) => [r.date, r.spread_bp!]));
    return { ...s, data: dates.map((d) => m.get(d) ?? null), last: [...m.values()].at(-1) ?? null };
  }).filter((s) => s.last != null).sort((a, b) => b.last! - a.last!);
  if (!series.length) return null;
  const opt: echarts.EChartsOption = {
    ...baseOption(),
    grid: { left: 48, right: 150, top: 16, bottom: 28 },
    legend: { show: false },
    tooltip: { ...baseOption().tooltip, valueFormatter: (v) => (v == null ? "-" : `${Math.round(Number(v)).toLocaleString()}bp`) },
    xAxis: { type: "category", data: dates.map((d) => d.slice(5).replace("-", "/")), ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: "{value}" } },
    series: series.map((s) => ({
      type: "line", name: s.name, data: s.data, showSymbol: false, connectNulls: true, smooth: false,
      lineStyle: { width: s.ticker === "CRWV" ? 3 : 2, color: s.color }, itemStyle: { color: s.color },
      endLabel: { show: true, color: s.color, fontSize: 11, fontWeight: "bold", formatter: () => `${s.name} ${Math.round(s.last!).toLocaleString()}bp` },
      labelLayout: { moveOverlap: "shiftY" },
    })),
  };
  return (
    <div className="card min-w-0">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 font-bold">AI 인프라 주가 내재 신용 스프레드
            <InfoTip wide>
              <p>회사채 체결가 대신 <b>주가·주가 변동성·부채</b>로 역산한 머튼 모형 값입니다 (만기 5년 가정, bp = 0.01%p). 실제 회사채 스프레드와 수준이 다르니 숫자보다 <b>추이와 회사 간 순서</b>를 보세요.</p>
              <p>자산 = 시가총액 + 부도 기준 부채(1년 내 만기 + 나머지 차입의 절반), 자산 변동성은 주가 변동성에서 추정. 부채는 분기 장부(SEC)라 공시 후에 반영되고, 주가가 급락하거나 변동성이 커지면 스프레드가 올라갑니다.</p>
              <p>머튼 모형은 부채가 적고 주가가 안정적인 투자등급 대기업(오라클·메타)의 스프레드를 0에 가깝게, 실제보다 크게 낮게 계산하는 한계가 있습니다 — 하이일드 성격의 네오클라우드·채굴 전환 기업 비교에 더 맞습니다.</p>
              <p>코어 사이언티픽·어플라이드 디지털·사이퍼·테라울프는 추적 종목이 아니라 이 차트에만 넣은 비교 대상입니다.</p>
            </InfoTip>
          </h3>
          <p className="mt-0.5 text-xs text-muted">주가로 역산한 모델값 · 실제 회사채 스프레드 아님 · 최근 6개월, 일별</p>
        </div>
      </div>
      <EChart option={opt} height={320} />
    </div>
  );
}
