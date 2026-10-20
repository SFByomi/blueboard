import Link from "next/link";
import { InfoTip } from "@/components/InfoTip";

/** 카드 머리: 제목 · ⓘ(정의·방법론) · 한 줄 부제 · 오른쪽 링크/배지 — 모든 카드가 같은 모양이 되도록 */
export function CardHead({ title, sub, info, right, as: H = "h2" }: { title: React.ReactNode; sub?: React.ReactNode; info?: React.ReactNode; right?: React.ReactNode; as?: "h2" | "h3" }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <H className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-bold">{title}{info && <InfoTip>{info}</InfoTip>}</H>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {right && <div className="shrink-0 text-xs text-muted">{right}</div>}
    </div>
  );
}

export function Card({ id, title, sub, info, right, children, className = "" }: { id?: string; title?: React.ReactNode; sub?: React.ReactNode; info?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`card min-w-0 ${className}`}>
      {title && <CardHead title={title} sub={sub} info={info} right={right} />}
      {children}
    </section>
  );
}

/** 카드 오른쪽 위 '더 보기' 링크 */
export function MoreLink({ href, children = "전체 보기" }: { href: string; children?: React.ReactNode }) {
  return <Link href={href} className="whitespace-nowrap text-xs text-muted hover:text-accent">{children} →</Link>;
}

/** 큰 숫자 하나 (요약 타일) */
export function Stat({ label, value, sub, tone = "", info, href }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: string; info?: React.ReactNode; href?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-xs text-muted">{label}{info && <InfoTip>{info}</InfoTip>}</div>
      <div className={`mt-1 truncate font-mono text-xl font-bold ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs leading-snug text-muted">{sub}</div>}
    </>
  );
  const cls = "min-w-0 rounded-xl bg-panel2 px-3.5 py-3";
  return href ? <Link href={href} className={`${cls} block transition hover:ring-1 hover:ring-accent`}>{body}</Link> : <div className={cls}>{body}</div>;
}

const BADGE: Record<string, string> = {
  up: "bg-up/15 text-up", down: "bg-down/15 text-down", accent: "bg-accent/20 text-accent", warn: "bg-amber-950 text-amber-300",
  muted: "bg-panel2 text-muted", danger: "bg-red-950 text-red-300", info: "bg-sky-950 text-sky-300",
};
export function Badge({ children, tone = "muted", title, className = "" }: { children: React.ReactNode; tone?: keyof typeof BADGE | string; title?: string; className?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${BADGE[tone] ?? tone} ${className}`}>{children}</span>;
}

/** 펼쳐 보기 (네이티브 details — JS 없이) */
export function Fold({ summary, children, className = "" }: { summary: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <details className={`group ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <span className="transition group-open:rotate-90">▸</span>{summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/** 페이지 제목 + 한 줄 설명 + ⓘ */
export function PageHead({ title, sub, info, right }: { title: React.ReactNode; sub?: React.ReactNode; info?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-bold">{title}{info && <InfoTip wide>{info}</InfoTip>}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** 정의 목록 (ⓘ 안에서 용어 → 설명) */
export function Defs({ items }: { items: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="space-y-1">
      {items.map(([k, v], i) => (
        <div key={i}><dt className="inline font-bold text-fg">{k}</dt> <dd className="inline">{v}</dd></div>
      ))}
    </dl>
  );
}

/** 페이지 안 큰 섹션 머리 (카드 여러 장을 묶는 단위) */
export function SectionHead({ title, sub, info, right }: { title: React.ReactNode; sub?: React.ReactNode; info?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <h2 className="flex flex-wrap items-center gap-x-1.5 text-lg font-bold">{title}{info && <InfoTip wide>{info}</InfoTip>}</h2>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
      {right && <div className="text-xs text-muted">{right}</div>}
    </div>
  );
}
