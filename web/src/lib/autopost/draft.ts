import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { FlowPick } from "./pick";

// 자동 게시 초안 2단계: TOP N 흐름 → Claude가 X(영어)·텔레그램 채널(한국어) 글을 쓴다.
// 넘겨준 숫자만 쓰게 하고, 결과를 코드로 다시 검사(모르는 숫자·필수 문구)해 경고를 붙인다.

export const SITE = "buywhenitgoesup.vercel.app";
export const DISCLAIMER_EN = "Not investment advice.";
export const DISCLAIMER_KO = "투자 권유 아님.";
const X_LIMIT = 280;

const Draft = z.object({
  en: z.string().describe("X post in English, at most 260 characters"),
  ko: z.string().describe("Telegram channel post in Korean, at most 600 characters"),
  labels: z.array(z.object({ key: z.string(), label_en: z.string().describe("Short English chart title for the flow, max 32 characters") })),
});
export type DraftOut = z.infer<typeof Draft> & { warnings: string[] };

const SYSTEM = `You write short social posts for "Investing Idea", a site that tracks AI and semiconductor supply chains through official customs trade data (US, Japan, Korea) and maps them to listed companies.

Rules — these are strict:
- Use ONLY numbers that appear in the JSON you are given, copied exactly as written (e.g. "+45%", "Aug 2026", "0.83"). Do not compute, round, convert or add any other number (no prices, targets, market caps, estimates, dates or counts that are not in the JSON).
- Do not guess causes, forecasts or company news. Describe what the trade data shows, and attribute it ("US imports of …", "exports from …").
- Each post must state the data source(s) given, the data month ("data through <month_en>"), and the disclaimer exactly: English "${DISCLAIMER_EN}", Korean "${DISCLAIMER_KO}".
- If an item has flags, say plainly that the figure needs caution (e.g. small base last year, short history, weak link to revenue). Never present a flagged figure as a clean signal.
- Plain, factual tone. No hype words, no emojis except at most one chart emoji, no hashtags except cashtags of the given tickers.
- English post: at most 260 characters including spaces. Korean post: natural Korean for Korean retail investors, at most 600 characters; tickers stay in Latin letters.
- Also give each item a short English chart title (label_en, max 32 chars) describing the flow, keyed by its "key".`;

/** 초안 작성 — 모델 거절·파싱 실패는 예외로 (크론이 텔레그램에 실패를 알림) */
export async function writeDraft(picks: FlowPick[]): Promise<DraftOut> {
  const input = picks.map((p) => ({
    key: p.key, tickers: p.tickers, companies: p.names, flow_korean_label: p.flow_ko, products: p.products, partner_country_korean: p.partner,
    source: p.sources.join(" + "), month_en: p.month_en, change_3m_vs_year_ago: p.yoy3m_txt, latest_month_vs_year_ago: p.last_yoy_txt,
    latest_month_value: p.last_value_txt, revenue_link_grade: p.grade, revenue_link_corr: p.corr_txt,
    flags: p.flags.map((f) => f.code),
  }));
  const client = new Anthropic();
  const res = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // 정책상 거절되면 서버가 기본 대체 모델로 다시 시도
    output_config: { effort: "medium", format: betaZodOutputFormat(Draft) },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `The ${picks.length} supply-chain flows with the largest recent change (3-month total vs the same 3 months a year earlier). Flag meanings: extreme = change above 200%, likely a small base last year; stale = data month is old; short = fewer than 8 comparable quarters against revenue; weak = trade flow not confirmed to move with company revenue.\n\n${JSON.stringify(input, null, 2)}`,
    }],
  });
  if (res.stop_reason === "refusal") throw new Error(`Claude 거절: ${res.stop_details?.category ?? "unknown"}`);
  const out = res.parsed_output;
  if (!out) throw new Error(`초안 파싱 실패 (stop_reason=${res.stop_reason})`);
  return finalize(out, picks);
}

/** 필수 문구 보충 + 숫자 검증 — 수정 답장에도 같은 검사를 씀 */
export function finalize(d: z.infer<typeof Draft>, picks: FlowPick[]): DraftOut {
  const warnings: string[] = [];
  const months = [...new Set(picks.map((p) => p.month_en))];
  let en = d.en.trim(), ko = d.ko.trim();
  if (!en.includes(DISCLAIMER_EN.replace(".", ""))) en += `${/[.!?)]$/.test(en) ? " " : ". "}${DISCLAIMER_EN}`;
  if (!ko.includes(DISCLAIMER_KO.replace(".", ""))) ko += `\n${DISCLAIMER_KO}`;
  if (!months.some((m) => en.includes(m))) warnings.push("영어 글에 기준월이 없음");
  if (!months.some((m) => ko.includes(m) || ko.includes(koMonth(m)))) warnings.push("한국어 글에 기준월이 없음");
  if (!/census|e-stat|customs|eurostat|eia|MOF/i.test(en)) warnings.push("영어 글에 출처가 없음");
  if (!/census|e-stat|customs|eurostat|eia|관세청|센서스|재무성|MOF/i.test(ko)) warnings.push("한국어 글에 출처가 없음");
  const bad = [...unknownNumbers(en, picks), ...unknownNumbers(ko, picks)];
  if (bad.length) warnings.push(`넘겨주지 않은 숫자: ${[...new Set(bad)].join(", ")}`);
  const len = xLength(en);
  if (len > X_LIMIT) warnings.push(`영어 글 ${len}자 — X 한도 ${X_LIMIT}자 초과`);
  return { en, ko, labels: d.labels, warnings };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const koMonth = (m: string) => `${m.slice(4)}년 ${MON.indexOf(m.slice(0, 3)) + 1}월`;

/** 글 속 숫자 중 입력에 없는 것 (티커·HS코드·기준월·연도·순위 숫자 1~3은 허용) */
function unknownNumbers(text: string, picks: FlowPick[]): string[] {
  const allowed = new Set<string>(["1", "2", "3", "12"]);
  const src = JSON.stringify(picks, (k, v) => (k === "spark" ? undefined : v)) + picks.map((p) => koMonth(p.month_en)).join(" ");
  for (const m of src.match(/\d+(?:\.\d+)?/g) ?? []) allowed.add(norm(m));
  return (text.replace(/https?:\/\/\S+|buywhenitgoesup\S*/g, "").match(/\d+(?:[.,]\d+)?/g) ?? []).map(norm).filter((m) => !allowed.has(m));
}
const norm = (s: string) => String(Number(s.replace(/,/g, "")));

/** X 글자 수: 한글·한자 등 넓은 문자와 이모지는 2, 링크는 23 */
export function xLength(t: string) {
  const urls = t.match(/https?:\/\/\S+/g) ?? [];
  let n = urls.length * 23;
  for (const ch of t.replace(/https?:\/\/\S+/g, "")) n += /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
  return n;
}
