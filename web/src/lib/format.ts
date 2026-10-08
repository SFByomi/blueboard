export const pct = (v: number | null | undefined, digits = 1) =>
  v == null || !isFinite(v) ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;

export function usd(v: number | null | undefined) {
  if (v == null) return "-";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/** 매출 등 통화 금액: USD는 $1.2B, KRW는 3.46조 / 6,020억 */
export function money(v: number | null | undefined, currency = "USD") {
  if (v == null) return "-";
  if (currency === "EUR") return usd(v).replace("$", "€");
  if (currency !== "KRW") return usd(v);
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}조원`;
  return `${Math.round(v / 1e8).toLocaleString()}억원`;
}

export const tone = (v: number | null | undefined) => (v == null ? "text-muted" : v >= 0 ? "text-up" : "text-down");

export const ROLE_STYLE: Record<string, string> = {
  생산출하: "bg-emerald-950 text-emerald-300",
  회사출하: "bg-sky-950 text-sky-300",
  생산투입: "bg-amber-950 text-amber-300",
  최종수요: "bg-violet-950 text-violet-300",
  가격벤치마크: "bg-pink-950 text-pink-300",
};
export const ROLES = Object.keys(ROLE_STYLE);
export const CONFIDENCES = ["높음", "중간", "낮음"];

/** 종목 목록 섹터 그룹 (표시 순서) — companies.grp */
export const GROUPS = ["메모리", "광통신", "서버·네트워크", "반도체", "전력·냉각", "AI 클라우드", "보안", "부품·소재", "바이오", "기타"];

/** 매핑 역할 → 공급망 단계 (종목 페이지에서 이 순서로 묶음) */
export const STAGES = [
  { key: "input", title: "① 부품 조달", desc: "생산에 들어가는 부품·소재 — 출하보다 먼저 움직임", roles: ["생산투입"] },
  { key: "make", title: "② 생산거점 출하", desc: "공장이 있는 지역의 수출", roles: ["생산출하"] },
  { key: "ship", title: "③ 고객향 반입", desc: "미국 등 최종 시장으로 들어오는 물량", roles: ["회사출하"] },
  { key: "demand", title: "④ 수요·업황", desc: "업계 전체 수요 — 회사 물량 아님", roles: ["최종수요"] },
  { key: "price", title: "⑤ 가격·경쟁사", desc: "단가 사이클·경쟁사 흐름", roles: ["가격벤치마크"] },
] as const;
export const stageOf = (role: string) => STAGES.find((st) => (st.roles as readonly string[]).includes(role))?.key ?? "demand";

export type Site = { name: string; country: string; what: string };
export function parseSites(json: string | null): Site[] {
  try { return json ? (JSON.parse(json) as Site[]) : []; } catch { return []; }
}

/** 종목 섹터 그룹 → 종목 페이지에 붙일 가격지수 그룹 (etl/indicators.py의 그룹명) */
export const INDEX_FOR_GROUP: Record<string, string[]> = {
  메모리: ["메모리 단가", "반도체"], 반도체: ["반도체"], 광통신: ["네트워크"], "서버·네트워크": ["서버·스토리지", "네트워크"],
  "전력·냉각": ["전력·냉각"], "AI 클라우드": ["서버·스토리지"], "부품·소재": ["부품 단가", "반도체"],
};

// Census 국가명 → 한국어 (없으면 영문 그대로)
const CTY_KO: Record<string, string> = {
  AUSTRALIA: "호주", AUSTRIA: "오스트리아", BELGIUM: "벨기에", BRAZIL: "브라질", BULGARIA: "불가리아", CANADA: "캐나다",
  CHINA: "중국", "COSTA RICA": "코스타리카", CROATIA: "크로아티아", "CZECH REPUBLIC": "체코", DENMARK: "덴마크", ESTONIA: "에스토니아",
  FINLAND: "핀란드", FRANCE: "프랑스", GERMANY: "독일", "HONG KONG": "홍콩", HUNGARY: "헝가리", INDIA: "인도", INDONESIA: "인도네시아",
  IRELAND: "아일랜드", ISRAEL: "이스라엘", ITALY: "이탈리아", JAPAN: "일본", "KOREA, SOUTH": "한국", MALAYSIA: "말레이시아",
  MEXICO: "멕시코", NETHERLANDS: "네덜란드", "NEW ZEALAND": "뉴질랜드", NORWAY: "노르웨이", PHILIPPINES: "필리핀", POLAND: "폴란드",
  PORTUGAL: "포르투갈", ROMANIA: "루마니아", "SAUDI ARABIA": "사우디아라비아", SINGAPORE: "싱가포르", SLOVAKIA: "슬로바키아",
  SLOVENIA: "슬로베니아", "SOUTH AFRICA": "남아프리카공화국", SPAIN: "스페인", SWEDEN: "스웨덴", SWITZERLAND: "스위스", TAIWAN: "대만",
  THAILAND: "태국", TURKEY: "튀르키예", "UNITED ARAB EMIRATES": "아랍에미리트", "UNITED KINGDOM": "영국", VIETNAM: "베트남",
  CAMBODIA: "캄보디아", CHILE: "칠레", COLOMBIA: "콜롬비아", ARGENTINA: "아르헨티나", PERU: "페루", EGYPT: "이집트", MOROCCO: "모로코",
  LITHUANIA: "리투아니아", LATVIA: "라트비아", LUXEMBOURG: "룩셈부르크", GREECE: "그리스", ICELAND: "아이슬란드", MALTA: "몰타",
  "SRI LANKA": "스리랑카", BANGLADESH: "방글라데시", PAKISTAN: "파키스탄", "DOMINICAN REPUBLIC": "도미니카공화국", "EL SALVADOR": "엘살바도르",
  HONDURAS: "온두라스", GUATEMALA: "과테말라", NICARAGUA: "니카라과", "TRINIDAD AND TOBAGO": "트리니다드토바고", QATAR: "카타르",
  KUWAIT: "쿠웨이트", OMAN: "오만", BAHRAIN: "바레인", JORDAN: "요르단", "UKRAINE": "우크라이나", KAZAKHSTAN: "카자흐스탄", RUSSIA: "러시아",
};
export const ctyKo = (name: string | null) => (name ? CTY_KO[name] ?? name : null);

export const estExtrap = (e: { flows: string }) => (JSON.parse(e.flows) as { extrap?: boolean }[]).some((f) => f.extrap);
/** 백테스트상 쓸 만한 추정인지: 오차 12% 이하, '직전 성장률 유지'보다 정확, 과거 범위 밖 외삽이 아닐 때 */
export const estReliable = (e: { mape: number | null; mape_naive: number | null; flows: string; reliable?: number | null; tier?: string | null }) =>
  e.tier ? e.tier === "신뢰" : e.reliable != null ? !!e.reliable : e.mape != null && e.mape <= 0.12 && (e.mape_naive == null || e.mape < e.mape_naive) && !estExtrap(e);
/** 등급: 신뢰(신뢰도 70%↑·경고 없음) / 보통(50%↑) / 참고 — ETL estimates.tier */
export const estTier = (e: { tier?: string | null; mape: number | null; mape_naive: number | null; flows: string; reliable?: number | null }) =>
  e.tier ?? (estReliable(e) ? "신뢰" : "참고");
export const TIER_STYLE: Record<string, string> = { 신뢰: "bg-up/20 text-up", 보통: "bg-amber-950 text-amber-300", 참고: "bg-panel2 text-muted", 발표됨: "bg-panel2 text-muted" };
/** 신뢰도 설명 (툴팁) */
export const confNote = (e: { conf?: number | null; hits?: number | null; bt_n: number; mape: number | null }) =>
  e.conf == null ? "" : `최근 ${e.bt_n}분기 백테스트 중 ${e.hits}분기에서 실제 매출이 추정 ±5% 안 (표본 보정 ${(e.conf * 100).toFixed(0)}%) · 평균 오차 ${e.mape == null ? "-" : (e.mape * 100).toFixed(1)}%`;
/** '참고'인 이유 (ETL estimates.reliability) */
export const estCaution = (e: { caution?: string | null }): string[] => (e.caution ? JSON.parse(e.caution) : []);
/** 추정 오차범위 (±, 추정 대비 비율) */
export const estRange = (e: { est: number; high: number }) => (e.est ? (e.high - e.est) / Math.abs(e.est) : null);
/** 추정 대상 분기가 이미 실적 발표됨 (SEC 공시 반영 전) — 야후 분기 말일은 달 말일로 찍혀 보름 여유 */
export function estReported(e: { q_end: string }, lastReported?: string | null): boolean {
  if (!lastReported) return false;
  const d = new Date(e.q_end); d.setDate(d.getDate() - 15);
  return lastReported >= d.toISOString().slice(0, 10);
}
/** 매수·매도 검토 트리거: 신뢰 추정 + 컨센 괴리 10% 이상(오차범위 밖) + 실적 발표 30일 이내 */
export function watchFlag(e: { q_end: string; mape: number | null; mape_naive: number | null; flows: string; reliable?: number | null; cons_gap: number | null; est: number; high: number }, next?: string | null, lastReported?: string | null) {
  const d = dday(next), r = estRange(e);
  return !estReported(e, lastReported) && estReliable(e) && e.cons_gap != null && Math.abs(e.cons_gap) >= 0.1 && (r == null || Math.abs(e.cons_gap) > r) && d != null && d >= 0 && d <= 30;
}
/** 실적 발표까지 남은 일수 */
export function dday(d: string | null | undefined, today = new Date()): number | null {
  if (!d) return null;
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.parse(d) - t) / 864e5);
}

/** 추정 모델 이름 (etl/estimates.py method: yoy | level | +bias | ens(a,b)) */
export function methodLabel(m: string): string {
  const one = (x: string) => (x.startsWith("level") ? "금액 회귀" : "전년비 회귀") + (x.endsWith("+bias") ? "+편향 보정" : "");
  const ens = m.match(/^ens\((.+),(.+)\)$/);
  return ens ? `앙상블 (${one(ens[1])} · ${one(ens[2])})` : one(m);
}

/** "2026-07" ± n개월 */
export function shiftMonth(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** 극단적 증가율(±200% 초과)에 붙일 기저효과 안내 — 없으면 undefined */
export const baseEffect = (v: number | null | undefined) =>
  v != null && Math.abs(v) > 2 ? "전년 같은 기간 금액이 작아 생긴 기저효과일 수 있음 — 금액 자체도 함께 보세요" : undefined;
