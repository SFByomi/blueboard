import type { Metadata } from "next";
import Link from "next/link";
import { T } from "@/components/Names";
import { money, pct, TIER_STYLE } from "@/lib/format";
import { companies, latestEstimates } from "@/lib/queries";
import { median, trackRecord, type Call } from "@/lib/track";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "실적 검증", description: "발표 전에 고정한 매출 추정 vs 실제 매출 — 오차·방향·오차범위 적중" };

const CALL_STYLE: Record<Call, string> = { Beat: "text-up", Inline: "text-muted", Miss: "text-down" };
const CALL_KO: Record<Call, string> = { Beat: "상회", Inline: "부합", Miss: "하회" };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card min-w-0 text-center">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export default async function Track() {
  const [rows, ests, cos] = await Promise.all([trackRecord(), latestEstimates(), companies()]);
  const names = Object.fromEntries(cos.map((c) => [c.ticker, c.name_ko ?? c.name]));
  const dir = rows.filter((r) => r.callEst && r.callActual);
  const dirHit = dir.filter((r) => r.callEst === r.callActual).length;
  const inRange = rows.filter((r) => r.inRange).length;
  const near = rows.filter((r) => Math.abs(r.err) <= 0.05).length;
  const cmp = rows.filter((r) => r.closer != null), closer = cmp.filter((r) => r.closer).length;
  const med = median(rows.map((r) => Math.abs(r.err)));

  // 현재 추정 모델의 백테스트(그 분기 이전 데이터로만 예측) 합계 — 실시간 검증이 쌓이기 전의 기준
  type Bt = { actual: number; pred: number; naive: number | null };
  const groups = [
    { name: "회사 가이던스 반영 (단독·무역 결합)", rows: ests.filter((e) => e.method.includes("guide")) },
    { name: "무역 모델", rows: ests.filter((e) => e.method !== "trend" && !e.method.includes("guide")) },
    { name: "단순 추세 (추세)", rows: ests.filter((e) => e.method === "trend") },
  ].map((g) => {
    const bt = g.rows.flatMap((e) => JSON.parse(e.backtest) as Bt[]);
    const err = bt.map((b) => Math.abs(b.pred / b.actual - 1));
    const nv = bt.filter((b) => b.naive != null).map((b) => Math.abs(b.naive! / b.actual - 1));
    return { ...g, n: bt.length, stocks: g.rows.length, hit: err.filter((x) => x <= 0.05).length, med: median(err), naive: median(nv) };
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold"><T ko="실적 검증" en="Track record" /></h1>
        <p className="mt-1 text-sm text-muted">실적 발표 전에 고정한 진행 분기 매출 추정을 실제 매출과 비교합니다. 맞은 것만 고르지 않고 실적이 나온 모든 종목·분기를 그대로 보여줍니다.</p>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="검증 분기" value={`${rows.length}`} sub={`${new Set(rows.map((r) => r.ticker)).size}종목`} />
            <Stat label="매출 오차 중앙값" value={med == null ? "-" : `${(med * 100).toFixed(1)}%`} sub={`±5% 안 ${near}/${rows.length}`} />
            <Stat label="오차범위 안" value={`${inRange}/${rows.length}`} sub="추정 ± 백테스트 80% 범위" />
            <Stat label="방향 적중 (컨센 대비)" value={dir.length ? `${dirHit}/${dir.length}` : "-"} sub="상회·부합(±1%)·하회" />
            <Stat label="컨센보다 정확" value={cmp.length ? `${closer}/${cmp.length}` : "-"} sub="실제와의 거리" />
          </div>
          <section className="card min-w-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] whitespace-nowrap text-sm">
                <thead className="text-xs text-muted"><tr className="border-b border-line">
                  <th className="py-2 text-left">종목</th><th className="text-left">분기</th><th className="text-left">추정 고정일</th>
                  <th className="text-right">사전 추정</th><th className="text-right">실제 매출</th><th className="text-right">오차</th><th className="text-right">범위 안</th>
                  <th className="text-right">사전 판단</th><th className="text-right">실제</th><th className="text-right">컨센 오차</th>
                </tr></thead>
                <tbody className="font-mono">
                  {rows.map((r) => (
                    <tr key={`${r.ticker}${r.q_end}`} className="border-b border-line/50">
                      <td className="py-2 font-sans"><Link className="font-bold hover:text-accent" href={`/stocks/${encodeURIComponent(r.ticker)}`}>{names[r.ticker] ?? r.ticker}</Link>
                        {r.tier && <span className={`ml-1 rounded px-1.5 text-xs ${TIER_STYLE[r.tier] ?? ""}`}>{r.tier}</span>}</td>
                      <td className="text-xs text-muted">{r.q_end.slice(0, 7)}</td>
                      <td className="text-xs text-muted" title={r.fixedBeforeReport ? `발표 확인 ${r.reportSeen} 전날까지의 마지막 추정` : "발표일 기록 전 분기 — 공시 반영 전 마지막 추정"}>{r.frozen}{r.fixedBeforeReport ? "" : " *"}</td>
                      <td className="text-right">{money(r.est, r.currency)}</td>
                      <td className="text-right">{money(r.actual, r.currency)}</td>
                      <td className={`text-right ${Math.abs(r.err) <= 0.05 ? "text-up" : Math.abs(r.err) > 0.15 ? "text-down" : ""}`}>{pct(r.err)}</td>
                      <td className="text-right font-sans text-xs">{r.inRange ? "✓" : "✗"}</td>
                      <td className={`text-right font-sans text-xs ${r.callEst ? CALL_STYLE[r.callEst] : "text-muted"}`}>{r.callEst ? CALL_KO[r.callEst] : "-"}</td>
                      <td className={`text-right font-sans text-xs ${r.callActual ? CALL_STYLE[r.callActual] : "text-muted"}`}>{r.callActual ? `${CALL_KO[r.callActual]}${r.callEst ? (r.callEst === r.callActual ? " ✓" : " ✗") : ""}` : "-"}</td>
                      <td className="text-right text-xs text-muted">{r.consErr == null ? "-" : `${pct(r.consErr)}${r.closer ? "" : " (컨센 우세)"}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              사전 추정 = 실적 발표를 처음 확인한 날 전날까지의 마지막 추정(매일 저장한 기록 그대로). * = 발표일 기록을 시작하기 전 분기라 공시(10-Q·DART)가 들어오기 전 마지막 추정 — 모델은 공시 매출이 들어오기 전엔 그 분기 실적을 모르지만 발표 직후 며칠이 포함될 수 있음.
              사전 판단 = 추정 ÷ 컨센서스가 +1% 넘으면 상회, −1% 미만이면 하회, 그 사이는 부합. 실제도 같은 기준. 컨센서스 금액은 약관상 표시하지 않음.
            </p>
          </section>
        </>
      ) : (
        <div className="card text-sm text-muted">아직 실적이 나온 추정 분기가 없습니다. 매일 저장되는 추정 중 발표 전 마지막 값이 실적 공시 후 이 표에 자동으로 쌓입니다.</div>
      )}

      <section className="card min-w-0">
        <h2 className="font-bold">모델 백테스트 합계 <span className="text-sm font-normal text-muted">현재 추정 모델로 최근 6~12분기를 그 분기 이전 데이터만으로 예측</span></h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] whitespace-nowrap text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-line">
              <th className="py-1 text-left">구분</th><th className="text-right">종목</th><th className="text-right">분기</th><th className="text-right">±5% 적중</th><th className="text-right">오차 중앙값</th><th className="text-right">단순 추세 오차 중앙값</th>
            </tr></thead>
            <tbody className="font-mono">
              {groups.map((g) => (
                <tr key={g.name} className="border-b border-line/50">
                  <td className="py-1 font-sans">{g.name}</td><td className="text-right">{g.stocks}</td><td className="text-right">{g.n}</td>
                  <td className="text-right">{g.n ? `${g.hit} (${((g.hit / g.n) * 100).toFixed(0)}%)` : "-"}</td>
                  <td className="text-right">{g.med == null ? "-" : `${(g.med * 100).toFixed(1)}%`}</td>
                  <td className="text-right text-muted">{g.naive == null ? "-" : `${(g.naive * 100).toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">백테스트는 모델·흐름 선택에 같은 기간을 써서 실제 성적보다 약간 낙관적일 수 있습니다 — 그래서 위의 발표 전 고정 검증을 따로 쌓습니다.</p>
      </section>
    </div>
  );
}
