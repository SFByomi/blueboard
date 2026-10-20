import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { templateDraft } from "./template";
import type { Candidate } from "./types";

// 자동 게시 초안: 후보(types.Candidate)의 facts → Claude가 X(영어)·텔레그램 채널(한국어) 글을 쓴다.
// 넘겨준 숫자만 쓰게 하고, 결과를 코드로 다시 검사(모르는 숫자·필수 문구)해 경고를 붙인다.

export const DISCLAIMER_EN = "Not investment advice.";
export const DISCLAIMER_KO = "투자 권유 아님.";
const X_LIMIT = 280;

const Draft = z.object({
  en: z.string().describe("X post in English, at most 250 characters"),
  ko: z.string().describe("Telegram channel post in Korean, at most 600 characters"),
  labels: z.array(z.object({ key: z.string(), label_en: z.string().describe("Short English chart title, max 32 characters") })),
});
export type DraftOut = z.infer<typeof Draft> & { warnings: string[] };

const SYSTEM = `You write short social posts for "Investing Idea", an account that tracks AI and semiconductor supply chains with official customs trade data (US, Japan, Korea) and other public data, and maps them to listed companies. The English post is for X, read by global investors who follow semiconductors and AI.

Rules — these are strict:
- Use ONLY numbers that appear in the JSON you are given, copied exactly as written (e.g. "+45%", "Aug 2026", "$3.1B"). Do not compute, round, convert or add any other number (no prices, targets, market caps, dates or counts that are not in the JSON).
- Do not guess causes, forecasts or company news. Describe what the data shows and attribute it.
- Each post must name the data source(s) given, the as-of date or month, and end with the disclaimer exactly: English "${DISCLAIMER_EN}", Korean "${DISCLAIMER_KO}".
- If there are flags, say plainly that the figure needs caution. Never present a flagged figure as a clean signal.
- Open the English post with the most striking fact in the first line (that line decides whether people read on). Plain, factual tone. No hype words, at most one emoji, no hashtags except cashtags of the given tickers. No links.
- English post: at most 250 characters including spaces. Korean post: natural Korean for Korean retail investors, at most 600 characters; tickers stay in Latin letters.
- labels: only when the post type asks for chart titles; otherwise return an empty list.`;

/** 초안 작성 — ANTHROPIC_API_KEY가 없으면 정해진 문장 틀(template.ts, 무료). 모델 거절·파싱 실패는 예외로 (크론이 텔레그램에 실패를 알림) */
export async function writeDraft(c: Candidate): Promise<DraftOut> {
  if (!process.env.ANTHROPIC_API_KEY) return finalize(templateDraft(c), c);
  const client = new Anthropic();
  const res = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // 정책상 거절되면 서버가 기본 대체 모델로 다시 시도
    output_config: { effort: "medium", format: betaZodOutputFormat(Draft) },
    system: SYSTEM,
    messages: [{ role: "user", content: `${c.guide}\n\nSources to name: ${c.sources.join(", ")}\n\n${JSON.stringify(c.facts, null, 2)}` }],
  });
  if (res.stop_reason === "refusal") throw new Error(`Claude 거절: ${res.stop_details?.category ?? "unknown"}`);
  const out = res.parsed_output;
  if (!out) throw new Error(`초안 파싱 실패 (stop_reason=${res.stop_reason})`);
  return finalize(out, c);
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 'Jul 2026' → '2026년 7월', 'Oct 29' → '10월 29일' */
const koDate = (s: string) => {
  const [m, x] = s.split(" "), n = MON.indexOf(m) + 1;
  return Number(x) > 31 ? `${x}년 ${n}월` : `${n}월 ${x}일`;
};
const SOURCE_RE = /census|e-stat|customs|eurostat|eia|MOF|nebius|vast|filing|deliver|capex|disclosure|관세청|센서스|재무성|공시|인도/i;

/** 필수 문구 보충 + 숫자 검증 — 수정 답장에도 같은 검사를 씀 */
export function finalize(d: z.infer<typeof Draft>, c: Candidate): DraftOut {
  const warnings: string[] = [];
  let en = d.en.trim(), ko = d.ko.trim();
  if (!en.includes(DISCLAIMER_EN.replace(".", ""))) en += `${/[.!?)]$/.test(en) ? " " : ". "}${DISCLAIMER_EN}`;
  if (!ko.includes(DISCLAIMER_KO.replace(".", ""))) ko += `\n${DISCLAIMER_KO}`;
  if (c.asof.length && !c.asof.some((m) => en.includes(m))) warnings.push(`영어 글에 기준 시점(${c.asof.join(" / ")})이 없음`);
  if (c.asof.length && !c.asof.some((m) => ko.includes(m) || ko.includes(koDate(m)))) warnings.push("한국어 글에 기준 시점이 없음");
  if (!SOURCE_RE.test(en)) warnings.push("영어 글에 출처가 없음");
  if (!SOURCE_RE.test(ko)) warnings.push("한국어 글에 출처가 없음");
  const bad = [...unknownNumbers(en, c), ...unknownNumbers(ko, c)];
  if (bad.length) warnings.push(`넘겨주지 않은 숫자: ${[...new Set(bad)].join(", ")}`);
  const len = xLength(en);
  if (len > X_LIMIT) warnings.push(`영어 글 ${len}자 — X 한도 ${X_LIMIT}자 초과`);
  return { en, ko, labels: d.labels, warnings };
}

/** 글 속 숫자 중 입력에 없는 것 (순위·기간을 말하는 1~3·12는 허용) */
function unknownNumbers(text: string, c: Candidate): string[] {
  const allowed = new Set<string>(["1", "2", "3", "12"]);
  const src = JSON.stringify(c.facts) + c.asof.map(koDate).join(" ") + c.brief.join(" ");
  for (const m of src.match(/\d+(?:\.\d+)?/g) ?? []) allowed.add(norm(m));
  return (text.replace(/https?:\/\/\S+|buywhenitgoesup\S*/g, "").match(/\d+(?:[.,]\d+)?/g) ?? []).map(norm).filter((m) => !allowed.has(m));
}
const norm = (s: string) => String(Number(s.replace(/,/g, "")));

/** X 글자 수: 한글·한자 등 넓은 문자와 이모지는 2, 링크는 23 */
export function xLength(t: string) {
  const urls = t.match(/https?:\/\/\S+/g) ?? [];
  let n = urls.length * 23;
  for (const ch of t.replace(/https?:\/\/\S+/g, "")) n += /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︰-﹏＀-￯]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
  return n;
}
