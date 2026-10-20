import { CardHead, Fold } from "@/components/ui";
import { money, pct, TIER_STYLE, tone } from "@/lib/format";
import type { OiEstimate } from "@/lib/queries";

type Bt = { q_end: string; actual: number; rev: number; naive?: number; drift?: number; guide?: number };
type OiGuide = { margin: number; kind: string; basis?: string; filed: string; gap: number | null; n: number; used: boolean; mape_guide: number | null; mape_naive_same: number | null; om?: number[]; gm?: number[] };

const METHOD: Record<string, string> = { guide: "회사 수익성 가이던스 − 과거 GAAP 차이", drift: "직전 영업이익률 + 최근 4분기 추세", naive: "직전 분기 영업이익률 유지" };
const KIND: Record<string, string> = { om: "영업이익률", oi: "영업이익 금액", "gm-opex": "매출총이익률 − 영업비용" };
const e = (v: number | null | undefined) => (v == null ? "-" : `${(v * 100).toFixed(0)}%`);
const mp = (v: number | null | undefined) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);

/** 진행 분기 영업이익 추정 — 매출 추정 × 영업이익률 모델(백테스트로 채택). 오차가 크면 이유만 */
export function OiCard({ o }: { o: OiEstimate | null }) {
  if (!o) return null;
  const why: string[] = JSON.parse(o.caution ?? "[]");
  const g: OiGuide | null = o.guide ? JSON.parse(o.guide) : null;
  const bt: Bt[] = JSON.parse(o.backtest || "[]");
  const key = o.method as keyof Bt;
  const kr = o.currency === "KRW";
  const info = (
    <p>{kr ? "DART 손익계산서 영업이익 기준(부문 매출을 쓰는 종목은 같은 부문 영업이익). 한국 회사는 분기 수익성 가이던스가 없어 직전 마진 유지·추세 모델만 씁니다." : "GAAP 영업이익(SEC 재무제표) 기준. 회사 가이던스·애널리스트 추정은 대개 주식보상·인수 상각을 뺀 non-GAAP이라 금액이 다릅니다."} 영업이익 = 매출 추정 × 영업이익률 모델. 백테스트 오차 7% 이하 신뢰, 15% 이하 보통, 30% 이하 참고, 그 이상은 추정하지 않고 이유만 표시. 영업이익률이 0 근처인 종목은 영업이익률 오차(%p)로 판단합니다.</p>
  );
  return (
    <div className="card min-w-0 space-y-3">
      <CardHead title="진행 분기 영업이익 추정" sub={`${kr ? "K-IFRS" : "GAAP"}${o.q_end ? ` · ${o.q_end.slice(0, 7)} 분기` : ""}`} info={info}
        right={<span className={`rounded px-2 py-0.5 text-xs ${TIER_STYLE[o.tier] ?? TIER_STYLE["참고"]}`}>{o.tier}{o.mape != null ? ` · 오차 ${e(o.mape)}` : ""}</span>} />
      {o.est == null ? (
        <div className="text-sm text-muted">{why.length ? why.join(" · ") : "추정하지 않음"}
          {o.last_oi != null && <div className="mt-1 text-xs">직전 분기{o.last_q ? `(${o.last_q.slice(0, 7)})` : ""} 영업이익 {money(o.last_oi, o.currency)} · 영업이익률 {mp(o.last_margin)}</div>}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1"><div className="text-xs text-muted">추정 영업이익</div><div className="font-mono text-2xl font-bold">{money(o.est, o.currency)}</div>
            <div className="text-xs text-muted">영업이익률 {mp(o.margin)} × 추정 매출 {money(o.rev_est, o.currency)}</div></div>
          <div><div className="text-xs text-muted">직전 분기 대비</div>
            <div className={`font-mono text-2xl font-bold ${o.last_oi != null && o.last_oi > 0 ? tone(o.est / o.last_oi - 1) : "text-muted"}`}>{o.last_oi != null && o.last_oi > 0 ? pct(o.est / o.last_oi - 1) : "-"}</div>
            <div className="text-xs text-muted">직전 {money(o.last_oi, o.currency)} · {mp(o.last_margin)}</div></div>
          <div><div className="text-xs text-muted">모델</div><div className="text-sm">{METHOD[o.method] ?? o.method}</div>
            <div className="text-xs text-muted">오차 {e(o.mape)} (±{o.err_pts == null ? "-" : (o.err_pts * 100).toFixed(1)}%p) · 단순 유지 {e(o.mape_naive)}</div></div>
        </div>
      )}
      {o.est != null && why.length > 0 && <div className="text-xs text-muted">· {why.join(" · ")}</div>}
      {(g || bt.length > 0) && (
        <Fold summary={`근거 자세히${g ? " — 회사 수익성 가이던스" : ""}${bt.length ? ` · 백테스트 ${bt.length}분기` : ""}`}>
          {g && (
            <p className="mb-2 text-xs text-muted">
              회사 가이던스({g.filed}, {KIND[g.kind] ?? g.kind}{g.basis ? ` · ${g.basis}` : ""}) → 영업이익률 {mp(g.margin)}
              {g.gap != null && <> · 과거 {g.n}분기 &lsquo;가이던스 마진 − 실제 GAAP 마진&rsquo; 중앙값 {g.gap >= 0 ? "+" : ""}{(g.gap * 100).toFixed(1)}%p{g.basis === "non-GAAP" ? "(주식보상 등 GAAP 차이 + 상습 초과분)" : ""}</>}
              {g.used && o.margin != null ? <> → 그만큼 뺀 {mp(o.margin)} 반영. 근거: 같은 분기들 백테스트 오차 {e(g.mape_guide)} vs 직전 마진 유지 {e(g.mape_naive_same)}</>
                : g.used ? <> · 가이던스 모델이 직전 마진 유지보다 나았지만({e(g.mape_guide)} vs {e(g.mape_naive_same)}) 둘 다 오차가 커서 숫자는 내지 않음</>
                : <> · 백테스트에서 가이던스 모델이 더 정확하지 않아(또는 과거 표본 부족) 쓰지 않음</>}
            </p>
          )}
          {bt.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] font-mono text-xs tnum">
                <thead className="text-muted"><tr className="border-b border-line"><th className="py-1 text-left">분기</th><th className="text-right">실제 영업이익</th><th className="text-right">영업이익률</th><th className="text-right">모델 오차</th><th className="text-right">단순 유지</th></tr></thead>
                <tbody>{bt.map((r) => {
                  const p = r[key] as number | undefined;
                  const err = (v?: number) => (v == null ? "-" : `${((v - r.actual) / r.rev * 100 >= 0 ? "+" : "")}${((v - r.actual) / r.rev * 100).toFixed(1)}%p`);
                  return (
                    <tr key={r.q_end} className="border-b border-line/50">
                      <td className="py-1">{r.q_end.slice(0, 7)}</td><td className="text-right">{money(r.actual, o.currency)}</td><td className="text-right">{mp(r.actual / r.rev)}</td>
                      <td className="text-right">{err(p)}</td><td className="text-right text-muted">{err(r.naive)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <p className="mt-1 text-xs text-muted">오차는 영업이익률 기준 (예측 영업이익 − 실제) ÷ 실제 매출. 매출 추정 오차도 포함.</p>
            </div>
          )}
        </Fold>
      )}
    </div>
  );
}
