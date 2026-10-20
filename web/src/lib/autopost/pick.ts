import { query } from "../db";
import { flowScores } from "../queries";
import { stockSignals } from "../signals";
import { type Candidate, type Flag, monthEn, pctTxt } from "./types";

// 자동 게시 초안 1단계: 사이트의 '공급망 모멘텀'(lib/signals.ts)과 같은 숫자에서 최근 변화가 큰 흐름 TOP N을 고르고
// 이상치를 '확인 필요'로 표시한다. 여기서 만든 문자열(…_txt)만 Claude에 넘기고, 초안에 그 밖의 숫자가 나오면 경고한다.

export const SOURCE_EN: Record<string, string> = {
  census: "US Census Bureau", estat: "Japan MOF trade stats (e-Stat)", kcs: "Korea Customs Service",
  comext: "Eurostat Comext", c30: "US Census Bureau (construction spending)", eia_planned: "US EIA", eia_retail: "US EIA",
  tsla_pd: "Tesla production & deliveries reports", capex: "company capex disclosures", ransomware: "public ransomware leak-site counts",
};
/** 통관(무역) 데이터 소스 — 이것만으로 만든 추정이어야 '통관 데이터 모델'이라고 부른다 */
export const TRADE_SOURCES = new Set(["census", "estat", "kcs", "comext"]);
const EXTREME = 2; // |YoY| > 200% — 사이트에서 * (format.baseEffect)
const STALE_MONTHS = 3; // 오늘(한국) 기준 이보다 오래된 기준월
const SOLID = 8; // etl/scores.SOLID_YOY — 비교 가능한 분기가 이보다 적으면 우연일 수 있음

export type FlowPick = {
  key: string; tickers: string[]; names: string[]; flow_ko: string; series: string[];
  sources: string[]; products: string[]; partner: string | null;
  month: string; month_en: string; yoy3m: number; yoy3m_txt: string; last_yoy_txt: string | null; last_value_txt: string | null;
  grade: string | null; corr_txt: string | null; n_yoy: number | null; flags: Flag[]; spark: number[];
};

const usdTxt = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${(v / 1e3).toFixed(0)}K`);
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

type SeriesMeta = { id: string; source: string; hs: string | null; partner: string | null };

/** 변화(|최근 3개월 전년비|)가 큰 회사 고유 흐름 TOP n — 업황 대리 흐름(proxy)은 여러 종목이 같은 걸 공유해 제외 */
export async function topFlows(n = 3, today = new Date()): Promise<FlowPick[]> {
  const [sig, scores] = await Promise.all([stockSignals(), flowScores()]);
  const ids = [...new Set(sig.flatMap((s) => s.ids))];
  const meta = ids.length
    ? await query<SeriesMeta>(`SELECT id, source, hs, partner FROM series WHERE id IN (${ids.map(() => "?").join(",")})`, ids) : [];
  const hs6 = [...new Set(meta.flatMap((m) => hsList(m.hs)).map((h) => h.slice(0, 6)))].filter((h) => h.length === 6);
  const names = hs6.length
    ? await query<{ hs: string; name_en: string | null }>(`SELECT hs, name_en FROM hs_names WHERE hs IN (${hs6.map(() => "?").join(",")})`, hs6).catch(() => [])
    : [];
  const nameOf = Object.fromEntries(names.map((r) => [r.hs, r.name_en]));
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(today).slice(0, 7);

  const byKey = new Map<string, FlowPick>();
  for (const s of sig) {
    if (s.proxy || s.yoy3m == null || !s.month) continue;
    const key = [...s.ids].sort().join("+");
    const prev = byKey.get(key);
    if (prev) { prev.tickers.push(s.c.ticker); prev.names.push(s.c.name); continue; } // 같은 흐름을 쓰는 종목(예: LITE·FN)은 하나로
    const ms = meta.filter((m) => s.ids.includes(m.id));
    // 흐름 여러 개를 합산한 종목은 그중 가장 약한 연관도·표본으로 판단 (보수적으로)
    const sc = scores.filter((r) => r.ticker === s.c.ticker && s.ids.includes(r.series_id));
    const order = { A: 0, B: 1, C: 2, D: 3 } as Record<string, number>;
    const worst = sc.length < s.ids.length ? null : sc.reduce<(typeof sc)[number] | null>((w, r) => (!w || (order[r.grade ?? ""] ?? 9) > (order[w.grade ?? ""] ?? 9) ? r : w), null);
    const nYoy = sc.length ? Math.min(...sc.map((r) => r.n_yoy)) : null;
    const flags: Flag[] = [];
    if (Math.abs(s.yoy3m) > EXTREME) flags.push({ code: "extreme", ko: `전년비 ${pctTxt(s.yoy3m)} — 전년 금액이 작아 생긴 기저효과일 수 있음(*)` });
    const lag = monthsBetween(s.month, now);
    if (lag > STALE_MONTHS) flags.push({ code: "stale", ko: `기준월 ${s.month} — ${lag}개월 전 데이터` });
    if (nYoy == null || nYoy < SOLID) flags.push({ code: "short", ko: `매출과 비교한 표본 ${nYoy ?? 0}분기 — ${SOLID}분기 미만(*)` });
    if (!worst?.grade || worst.grade === "C" || worst.grade === "D") flags.push({ code: "weak", ko: `매출 연관도 ${worst?.grade ?? "없음"} — 매출과 직접 연동이 확인되지 않음` });
    byKey.set(key, {
      key, tickers: [s.c.ticker], names: [s.c.name], flow_ko: s.parts.length ? s.parts.map((x) => x.label).join(" + ") : s.flowLabel ?? "", series: s.ids,
      sources: [...new Set(ms.map((m) => SOURCE_EN[m.source] ?? m.source))],
      products: [...new Set(ms.flatMap((m) => hsList(m.hs)).map((h) => h.slice(0, 6)))].map((h) => (nameOf[h] ? `HS ${h} ${nameOf[h]}` : `HS ${h}`)).slice(0, 4),
      partner: ms.find((m) => m.partner)?.partner ?? null,
      month: s.month, month_en: monthEn(s.month), yoy3m: s.yoy3m, yoy3m_txt: pctTxt(s.yoy3m),
      last_yoy_txt: s.last.yoy != null ? pctTxt(s.last.yoy) : null,
      last_value_txt: s.last.value != null && ms.every((m) => TRADE_SOURCES.has(m.source)) ? usdTxt(s.last.value) : null,
      grade: worst?.grade ?? null, corr_txt: worst?.best != null ? worst.best.toFixed(2) : null, n_yoy: nYoy, flags, spark: s.sparkAt,
    });
  }
  return [...byKey.values()].sort((a, b) => Math.abs(b.yoy3m) - Math.abs(a.yoy3m)).slice(0, n);
}

/** series.hs 표기(점·자릿수 혼재, + 로 여러 세번)를 숫자만 남긴 코드 목록으로 */
function hsList(hs: string | null): string[] {
  if (!hs) return [];
  return hs.split(/[+,\s/]+/).map((h) => h.replace(/\D/g, "")).filter(Boolean); // '8517.62.0090', '3818.00.009x'
}

/** 같은 TOP N·기준월이면 같은 서명 → 이미 초안을 만든 조합은 다시 보내지 않음 */
export const signature = (ps: FlowPick[]) => ps.map((p) => `${p.key}@${p.month}`).join("|");

const TRADE_GUIDE = `Post type: monthly customs-trade movers. The items are the supply-chain flows with the largest recent change (3-month total vs the same 3 months a year earlier). Flag meanings: extreme = change above 200%, likely a small base last year; stale = data month is old; short = fewer than 8 comparable quarters against revenue; weak = trade flow not confirmed to move with company revenue. Also give each item a short English chart title (label_en, max 32 chars) keyed by its "key".`;

/** 무역 TOP 3 후보 (월 1회꼴 — 기준월이 바뀌어야 서명이 바뀜) */
export async function tradeCandidate(): Promise<Candidate | null> {
  const picks = await topFlows(3);
  if (!picks.length) return null;
  return {
    kind: "trade", sig: signature(picks), title: "무역 흐름 TOP 3",
    facts: picks.map((p) => ({
      key: p.key, tickers: p.tickers, companies: p.names, flow_korean_label: p.flow_ko, products: p.products, partner_country_korean: p.partner,
      source: p.sources.join(" + "), month_en: p.month_en, change_3m_vs_year_ago: p.yoy3m_txt, latest_month_vs_year_ago: p.last_yoy_txt,
      latest_month_value: p.last_value_txt, revenue_link_grade: p.grade, revenue_link_corr: p.corr_txt, flags: p.flags.map((f) => f.code),
    })),
    guide: TRADE_GUIDE,
    asof: [...new Set(picks.map((p) => p.month_en))],
    sources: [...new Set(picks.flatMap((p) => p.sources))],
    flags: picks.flatMap((p) => p.flags.map((f) => ({ ...f, ko: `${p.tickers.join("·")}: ${f.ko}` }))),
    brief: picks.map((p, i) => `${i + 1}. ${p.tickers.join("·")} ${p.flow_ko}: 3개월 ${p.yoy3m_txt}${p.last_yoy_txt ? ` · 최근 월 ${p.last_yoy_txt}` : ""} (${p.month}, 연관도 ${p.grade ?? "-"}${p.corr_txt ? ` ${p.corr_txt}` : ""}, 표본 ${p.n_yoy ?? 0}분기)`),
    data: picks,
  };
}
