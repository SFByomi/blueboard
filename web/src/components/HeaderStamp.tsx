import { connection } from "next/server";
import { parseBuilt } from "@/components/LastUpdated";
import { meta } from "@/lib/queries";

/** 상단 막대의 데이터 기준 시각 — 어느 화면에서든 '언제 데이터인지' 보이게 (meta.built_at, 한국 시간) */
export async function HeaderStamp() {
  await connection();  // 정적 페이지(소개 등)에서도 빌드 시각이 아닌 지금 DB 값
  const d = parseBuilt(await meta("built_at").catch(() => null));
  if (!d) return null;
  const k = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).reduce<Record<string, string>>((a, p) => ({ ...a, [p.type]: p.value }), {});
  return (
    <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted" title="마지막 데이터 갱신 (한국 시간) — 매일 아침 갱신">
      {k.month}/{k.day} {k.hour}:{k.minute}<span className="hidden font-sans sm:inline"> 기준</span>
    </span>
  );
}
