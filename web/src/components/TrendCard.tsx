import Link from "next/link";
import { GradeBadge } from "@/components/FlowScores";
import { Spark } from "@/components/Spark";
import { baseEffect, pct, tone, usd } from "@/lib/format";
import type { FlowScore } from "@/lib/queries";
import type { Signal } from "@/lib/signals";

const NON_USD = new Set(["건", "MW", "MWh"]); // 그 밖의 unit은 수량 단위(NO·KG 등)라 금액은 달러
const amount = (v: number | null, unit: string | null) => (v == null ? "-" : NON_USD.has(unit ?? "") ? `${Math.round(v).toLocaleString()}${unit}` : usd(v));

/** 매핑 트렌드 카드: 순위 · 최근 월 전년비 · 3개월·전월비 · 최근 3개월 방향 · 매출 전년비 · 흐름별 분해 */
export function TrendCard({ s, rank, score }: { s: Signal; rank: number; score?: FlowScore }) {
  const lag = score?.best_lag ? `${score.best_lag}분기 선행` : "동행";
  return (
    <Link href={`/stocks/${encodeURIComponent(s.c.ticker)}`} className="card block min-w-0 space-y-3 transition hover:border-accent">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${rank <= 3 ? "bg-amber-400 text-black" : "bg-panel2 text-muted"}`}>{rank}</span>
          <div className="min-w-0">
            <div className="truncate font-bold">{s.c.name_ko ?? s.c.name}</div>
            <div className="truncate text-xs text-muted">{s.c.ticker} · {s.proxy ? "업황 · " : ""}{s.flowLabel}</div>
          </div>
        </div>
        {score?.grade && <span className="shrink-0 text-xs text-muted" title="매출과 가장 잘 맞는 흐름의 전년비 상관">{lag} r={score.best?.toFixed(2)} <GradeBadge grade={score.grade} /></span>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className={`font-mono text-3xl font-bold ${tone(s.last.yoy)}`} title={baseEffect(s.last.yoy)}>{pct(s.last.yoy)}{baseEffect(s.last.yoy) && <sup>*</sup>}</div>
          <div className="text-xs text-muted">전년비 · {s.month}</div>
          <div className="font-mono text-sm">{amount(s.last.value, s.unit)}</div>
        </div>
        <Spark values={s.spark} w={130} h={44} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs">
        <span className="flex items-center gap-3">
          <span>3M <b className={tone(s.yoy3m)}>{pct(s.yoy3m, 0)}</b></span>
          <span>전월비 <b className={tone(s.last.mom)}>{pct(s.last.mom, 0)}</b></span>
          {s.up3 != null && (
            <span className="flex items-center gap-0.5" title="최근 3개월 중 전년비가 플러스인 달">
              {[0, 1, 2].map((k) => <span key={k} className={`h-3 w-1.5 rounded-sm ${k < s.up3! ? "bg-up" : "bg-down"}`} />)}<span className="ml-1 text-muted">{s.up3}/3</span>
            </span>
          )}
        </span>
        {s.revYoY != null && <span className="text-muted">매출 <b className={tone(s.revYoY)}>{pct(s.revYoY, 0)}</b></span>}
      </div>
      {s.parts.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted">흐름 분해</div>
          {s.parts.slice(0, 4).map((p) => (
            <div key={p.label} className="flex items-center gap-2 text-xs">
              <span className="h-1.5 w-12 shrink-0 rounded bg-panel2"><span className="block h-1.5 rounded bg-accent" style={{ width: `${Math.max(2, (p.share ?? 0) * 100)}%` }} /></span>
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              <span className="shrink-0 text-muted">{p.share == null ? "-" : `${(p.share * 100).toFixed(0)}%`}</span>
              <span className={`w-14 shrink-0 text-right font-mono ${tone(p.yoy)}`}>{pct(p.yoy, 0)}</span>
              <Spark values={p.spark} w={44} h={14} />
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}
