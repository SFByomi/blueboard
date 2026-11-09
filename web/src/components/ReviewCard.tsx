import { Badge, Card, Fold } from "@/components/ui";
import type { ScoreRow } from "@/lib/en";
import { money } from "@/lib/format";
import type { EstReview } from "@/lib/queries";

export type ReviewRow = {
  ticker: string; q_end: string; announced: string | null; est: number; low: number | null; high: number | null; actual: number;
  currency: string; err: number; inRange: boolean; review: EstReview | null;
};

/** 발표 전 마지막 추정(실적 검증) + 복기 메모(data/estimate_reviews.json)를 분기별로 합침.
 *  복기 메모의 추정치는 실적 검증 기록이 없을 때만 씀 (검증 기록이 '발표 전 고정' 원본). */
export function mergeReviews(score: ScoreRow[], reviews: EstReview[], fins: { ticker: string; period_end: string; revenue: number; currency: string }[]): ReviewRow[] {
  const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  const out: ReviewRow[] = score.map((s) => ({
    ticker: s.ticker, q_end: s.q_end, announced: s.seen, est: s.est, low: s.low, high: s.high, actual: s.actual, currency: s.currency, err: s.err, inRange: s.inRange,
    review: reviews.find((r) => r.ticker === s.ticker && days(r.q_end, s.q_end) <= 10) ?? null,
  }));
  for (const r of reviews) {
    if (out.some((o) => o.ticker === r.ticker && days(o.q_end, r.q_end) <= 10) || r.est == null) continue;
    const f = fins.find((x) => x.ticker === r.ticker && days(x.period_end, r.q_end) <= 10);
    const actual = f?.revenue ?? r.actual;
    if (actual == null) continue;
    out.push({ ticker: r.ticker, q_end: r.q_end, announced: r.announced, est: r.est, low: r.low, high: r.high, actual, currency: f?.currency ?? "USD",
      err: r.est / actual - 1, inRange: r.low != null && r.high != null && actual >= r.low && actual <= r.high, review: r });
  }
  return out.sort((a, b) => b.q_end.localeCompare(a.q_end));
}

const qLabel = (d: string) => `${d.slice(0, 4)}년 ${Math.ceil(+d.slice(5, 7) / 3)}분기`;

/** 오차 문장: '추정이 실제보다 12.8% 낮았음' — 부호(추정/실제 − 1)를 말로 */
export function errText(err: number) {
  return `추정이 실제보다 ${Math.abs(err * 100).toFixed(1)}% ${err < 0 ? "낮았음" : "높았음"}`;
}

/** 종목 화면 '지난 추정 복기': 분기마다 발표 전 추정 vs 실제, 왜 틀렸나, 무엇을 바꿨나 */
export function ReviewCard({ rows }: { rows: ReviewRow[] }) {
  if (!rows.length) return null;
  return (
    <Card title="지난 추정 복기" sub="발표 전 마지막 추정 vs 실제 매출 · 틀린 이유와 조정"
      info="실적이 나오면 발표 전 마지막 추정과 비교해 남깁니다. 오차가 크면 이유(세관 수출로 안 잡히는 매출, 업계 합산 흐름 등)와 모델을 어떻게 고쳤는지 적고, 실제 실적은 바로 다음 분기 추정과 편향 보정에 들어갑니다.">
      <ul className="space-y-3">
        {rows.slice(0, 6).map((r) => {
          const big = Math.abs(r.err) >= 0.05;
          return (
            <li key={r.q_end} className="space-y-1 border-t border-line pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <b>{qLabel(r.q_end)}</b>
                <span className="text-muted">추정 <span className="font-mono text-fg">{money(r.est, r.currency)}</span></span>
                <span className="text-muted">실제 <span className="font-mono font-bold text-fg">{money(r.actual, r.currency)}</span></span>
                <span className={`text-xs ${big ? "text-amber-300" : "text-muted"}`}>{errText(r.err)}</span>
                <Badge tone={r.inRange ? "muted" : "warn"}>{r.inRange ? "오차범위 안" : "오차범위 밖"}</Badge>
                {r.review?.tier === "보류" && <Badge title="외삽·컨센서스와 큰 차이로 보류 — 공개 표엔 숫자 대신 이유만 냈던 추정">보류였음</Badge>}
                {r.review?.cause && <Badge tone="info">{r.review.cause}</Badge>}
              </div>
              {r.review?.why && <p className="text-xs leading-relaxed text-muted">{r.review.why}</p>}
              {r.review?.fix && <p className="text-xs leading-relaxed"><span className="text-accent">조정 · </span><span className="text-muted">{r.review.fix}</span></p>}
              {r.review?.source && (
                <Fold summary="출처">
                  <p className="mt-1 text-xs text-muted">{r.review.source}{r.review.announced ? ` (${r.review.announced})` : ""} {r.review.url && <a className="text-accent" href={r.review.url} target="_blank" rel="noreferrer">원문</a>}</p>
                </Fold>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
