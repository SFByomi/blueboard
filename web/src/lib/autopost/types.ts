// 자동 게시 후보 — 종류마다(무역 TOP 3·실적 프리뷰·실적 결과·주간 GPU 가격) 같은 모양으로 만들어
// 초안 작성(draft.ts)·차트(chart.tsx)·승인 흐름(flow.ts)이 종류를 몰라도 되게 한다.

export type Flag = { code: string; ko: string };

export type Kind = "trade" | "preview" | "result" | "prices";

export type Candidate = {
  kind: Kind;
  sig: string; // 같은 서명이면 다시 보내지 않음
  title: string; // 나에게 보이는 한 줄 (한국어)
  facts: unknown; // Claude에 넘기는 JSON — 글에 쓸 숫자는 전부 여기 문자열로
  guide: string; // 종류별 작성 지시 (영어)
  asof: string[]; // 영어 글에 이 중 하나는 꼭 들어가야 함 (기준월·분기·날짜)
  sources: string[];
  flags: Flag[];
  brief: string[]; // 나에게 보이는 근거 줄
  data: unknown; // 차트용
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthEn = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const dayEn = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
export const pctTxt = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`;
export const todayKst = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

/** 금액: USD $1.2B·$350M, KRW ₩12.3T·₩850B (영어권 표기) */
export function moneyTxt(v: number, cur = "USD") {
  const s = cur === "KRW" ? "₩" : cur === "EUR" ? "€" : "$";
  const a = Math.abs(v);
  const t = a >= 1e12 ? `${(v / 1e12).toFixed(1)}T` : a >= 1e9 ? `${(v / 1e9).toFixed(a >= 1e11 ? 0 : a >= 1e10 ? 1 : 2)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : `${(v / 1e3).toFixed(0)}K`;
  return `${s}${t}`;
}
