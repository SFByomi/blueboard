import { xLength } from "./draft";
import type { EarnChart } from "./earnings";
import type { FlowPick } from "./pick";
import type { PriceChart } from "./prices";
import { type Candidate, monthEn, pctTxt } from "./types";

// Claude 없이(ANTHROPIC_API_KEY가 없을 때) 쓰는 정해진 문장 틀 — 비용 0, 후보의 숫자 문자열만 그대로 들어가 지어낼 일이 없다.
// 글맛은 Claude보다 덜하니 필요하면 텔레그램 [수정]으로 다듬는다.

const EN_MAX = 250; // 텔레그램 '복사' 버튼 한도(256자) 안
const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const koMonth = (d: string) => `${d.slice(0, 4)}년 ${Number(d.slice(5, 7))}월`;
const koDay = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
const tag = (t: string) => (/^\d/.test(t) ? t : `$${t}`); // 한국 종목 코드는 캐시태그가 안 됨

type F = Record<string, string | null>;
const COUNTRY: Record<string, string> = { "US Census Bureau": "US", "Japan MOF trade stats (e-Stat)": "Japan", "Korea Customs Service": "Korea", "Eurostat Comext": "EU" };
export type Template = { en: string; ko: string; labels: { key: string; label_en: string }[] };

export function templateDraft(c: Candidate): Template {
  const src = c.sources.join(", ");
  if (c.kind === "trade") {
    const ps = c.data as FlowPick[];
    const star = ps.some((p) => p.flags.length);
    const latest = ps.map((p) => p.month).sort().at(-1)!;
    const data = c.sources.every((x) => COUNTRY[x]) ? `Customs data (${c.sources.map((x) => COUNTRY[x]).join(", ")})` : `Data: ${src},`;
    const tail = `${data} to ${monthEn(latest)}.${star ? " *Small base, read with care." : ""} Not investment advice.`;
    let en = "";
    for (const n of [48, 40, 34, 28, 22, 16]) { // 줄마다 흐름 이름을 줄여 가며 X 한도 안에 맞춤
      const lines = ps.map((p) => `${p.tickers.map(tag).join(" ")} ${fit(p.names_en[0] + (p.names_en.length > 1 ? " +" : ""), n)} ${p.yoy3m_txt}${p.flags.length ? "*" : ""}${p.month !== latest ? ` (${p.month_en.slice(0, 3)})` : ""}`);
      en = ["Biggest moves, 3M YoY:", ...lines, tail].join("\n");
      if (xLength(en) <= EN_MAX) break;
    }
    const ko = ["📦 세관 데이터 급변 TOP 3 (최근 3개월, 전년 같은 기간 대비)",
      ...ps.map((p) => `· ${p.tickers.join("·")} ${p.flow_ko} ${p.yoy3m_txt}${p.flags.length ? "*" : ""} (${koMonth(p.month)}까지)`),
      ...(star ? ["* 전년 금액이 작았거나 표본이 짧아 확인 필요"] : []), `출처: ${src}`, "투자 권유 아님."].join("\n");
    return { en, ko, labels: ps.map((p) => ({ key: p.key, label_en: fit(p.names_en[0] ?? "", 32) })) };
  }

  const f = c.facts as F;
  if (c.kind === "preview" || c.kind === "result") {
    const d = c.data as EarnChart;
    const who = /^\d/.test(d.ticker) ? `${d.name} (${d.ticker})` : `$${d.ticker}`;
    const q = monthEn(d.qEnd).slice(0, 3);
    const hits = (f.backtest ?? "").match(/in (\d+) of (\d+)/);
    if (c.kind === "preview") {
      const en = `${who} reports ${f.report_date}. Our model: ${q}-qtr revenue ${f.our_revenue_estimate} (${f.estimate_range})`
        + `${f.vs_year_ago_quarter ? `, ${f.vs_year_ago_quarter} YoY` : ""}${f.vs_consensus ? `, ${f.vs_consensus}` : ""}.`
        + `${hits ? `\nBacktest: within ±5% in ${hits[1]} of ${hits[2]} quarters.` : ""}\nData: ${src}. Not investment advice.`;
      const ko = [`${d.ticker} ${d.name} — ${koDay(String(f.report_iso))} 실적 발표`,
        `우리 모델 ${koMonth(d.qEnd)} 분기 매출 추정 ${f.our_revenue_estimate} (${f.estimate_range})`,
        [f.vs_year_ago_quarter && `전년 대비 ${f.vs_year_ago_quarter}`, f.cons_gap && `컨센서스 대비 ${f.cons_gap}`].filter(Boolean).join(" · "),
        hits ? `과거 적중: ±5% 안 ${hits[1]}/${hits[2]}분기` : "", `출처: ${src}`, "투자 권유 아님."].filter(Boolean).join("\n");
      return { en, ko, labels: [] };
    }
    const inside = f.actual_within_our_range === "yes";
    const en = `${who} ${q}-qtr revenue: ${f.actual_revenue}. Our pre-report estimate (${f.estimate_date}): ${f.our_estimate_before_report}, error ${f.our_error}`
      + `${f.consensus_error ? ` vs consensus error ${f.consensus_error}` : ""}. ${inside ? "Inside" : "Outside"} our range.\nData: ${src}. Not investment advice.`;
    const ko = [`${d.ticker} ${d.name} ${koMonth(d.qEnd)} 분기 실적 — 발표 전 추정과 비교`,
      `실제 매출 ${f.actual_revenue} · 우리 추정 ${f.our_estimate_before_report} → 오차 ${f.our_error}${f.consensus_error ? ` (컨센서스 오차 ${f.consensus_error})` : ""}`,
      `추정 범위 안: ${inside ? "예" : "아니오"}`, `출처: ${src}`, "투자 권유 아님."].join("\n");
    return { en, ko, labels: [] };
  }

  const d = c.data as PriceChart;
  const row = (r: PriceChart["rows"][number]) => `${r.gpu} $${r.avg.toFixed(2)}${r.avgPrev ? ` (${pctTxt(r.avg / r.avgPrev - 1)})` : ""}`;
  const en = `GPU rental prices, avg per hour on ${d.day}, change vs a week earlier:\n${d.rows.map(row).join(" · ")}`
    + `${c.flags.length ? "\nBig weekly swings can reflect regional mix." : ""}\nSource: ${src}. Not investment advice.`;
  const ko = [`GPU 렌탈가 — ${koDay(d.dayIso)} 시간당 평균, 지난주 대비`, ...d.rows.map((r) => `· ${row(r)}`),
    ...(c.flags.length ? ["주간 변동이 크면 지역별 매물 구성이 바뀐 탓일 수 있음"] : []), `출처: ${src}`, "투자 권유 아님."].join("\n");
  return { en, ko, labels: [] };
}
