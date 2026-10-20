import type { AiArr } from "@/lib/queries";

export const LABS = [
  { id: "Anthropic", color: "#f97316" },
  { id: "OpenAI", color: "#7c86ff" },
];

/** 공개 수치 사이를 월별로 로그 보간(성장률 일정 가정) → {YYYY-MM: $B}. 첫·마지막 수치 밖은 비움 */
export function monthly(points: AiArr[]): Record<string, number> {
  const ps = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out: Record<string, number> = {};
  const t = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime();
  for (let i = 0; i + 1 < ps.length; i++) {
    const a = ps[i], b = ps[i + 1];
    const d = new Date(`${a.date.slice(0, 7)}-01T00:00:00Z`);
    while (d.getTime() <= t(b.date)) {
      const mid = d.getTime() + 14 * 864e5, f = Math.min(1, Math.max(0, (mid - t(a.date)) / (t(b.date) - t(a.date))));
      out[d.toISOString().slice(0, 7)] = a.usd_b * Math.pow(b.usd_b / a.usd_b, f);
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  }
  return out;
}

/** 두 랩 합산 (둘 다 값이 있는 달만) */
export function combined(arr: AiArr[]): Record<string, number> {
  const ms = LABS.map((l) => monthly(arr.filter((r) => r.lab === l.id)));
  const out: Record<string, number> = {};
  for (const m of Object.keys(ms[0])) if (ms.every((x) => x[m] != null)) out[m] = ms.reduce((a, x) => a + x[m], 0);
  return out;
}
