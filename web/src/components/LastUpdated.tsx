/** 마지막 데이터 갱신 시각(한국 시간) + 경과 시간. 30시간 넘게 갱신이 없으면 경고 — meta.built_at (etl/build.py, UTC ISO) */
const STALE_H = 30;

export function parseBuilt(v: string | null | undefined): Date | null {
  if (!v) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v.replace(" ", "T")}Z`; // 시간대 없는 옛 값 = Actions 러너 UTC
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function LastUpdated({ builtAt, now = new Date() }: { builtAt: string | null | undefined; now?: Date }) {
  const d = parseBuilt(builtAt);
  if (!d) return <span>마지막 갱신 -</span>;
  const kst = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).reduce<Record<string, string>>((a, p) => ({ ...a, [p.type]: p.value }), {});
  const h = (now.getTime() - d.getTime()) / 36e5;
  const ago = h < 1 ? "1시간 이내" : h < 48 ? `${Math.floor(h)}시간 전` : `${Math.floor(h / 24)}일 전`;
  const stale = h > STALE_H;
  return (
    <span className="whitespace-nowrap">
      마지막 갱신 {kst.year}-{kst.month}-{kst.day} {kst.hour}:{kst.minute} KST <span className={stale ? "font-bold text-down" : ""}>({ago}{stale ? " · 갱신 지연" : ""})</span>
    </span>
  );
}
