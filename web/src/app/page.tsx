import Link from "next/link";
import { HsName } from "@/components/Names";
import { Spark } from "@/components/Spark";
import { estReliable, money, pct, tone, usd } from "@/lib/format";
import { latestEstimates, meta, priceSnapshots, surge, tagIndex } from "@/lib/queries";
import { stockSignals, type Signal } from "@/lib/signals";

// 게시 직후 바로 보이도록 요청마다 렌더 (ISR 캐시가 게시 후에도 이전 데이터로 남던 문제). DB가 작아 부담 없음
export const dynamic = "force-dynamic";

function Row({ s }: { s: Signal }) {
  return (
    <Link href={`/stocks/${encodeURIComponent(s.c.ticker)}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-panel2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{s.c.name_ko ?? s.c.name} <span className="text-xs font-normal text-muted">{s.c.ticker}</span></div>
        <div className="truncate text-xs text-muted">{s.proxy ? "업황 · " : ""}{s.flowLabel} · {s.month}</div>
      </div>
      <Spark values={s.spark} />
      <div className={`w-20 text-right font-mono font-bold ${tone(s.yoy3m)}`}>{pct(s.yoy3m)}</div>
    </Link>
  );
}

export default async function Home() {
  const [sig, prices, top, related, builtAt, estRows] = await Promise.all([
    stockSignals(), priceSnapshots(), surge("us_imp_world", "yoy3m", 6), tagIndex(), meta("built_at"), latestEstimates(),
  ]);
  const ranked = sig.filter((s) => s.yoy3m != null).sort((a, b) => b.yoy3m! - a.yoy3m!);
  const half = Math.ceil(ranked.length / 2); // 상위 절반 = 가속, 하위 절반 = 둔화 (겹치지 않게)
  const up = ranked.slice(0, Math.min(half, 6)), down = ranked.slice(half).reverse().slice(0, 6);
  const names = Object.fromEntries(sig.map((s) => [s.c.ticker, s.c.name_ko ?? s.c.name]));
  // 신뢰 추정 먼저, 그 안에서 컨센 괴리 큰 순
  const ests = [...estRows].sort((a, b) => Number(estReliable(b)) - Number(estReliable(a)) || Math.abs(b.cons_gap ?? 0) - Math.abs(a.cons_gap ?? 0));
  const gpu = ["H100 SXM", "H200", "B200"].map((g) => prices.filter((r) => r.kind === "gpu" && r.item === g && r.stat === "median").at(-1)).filter((r) => r != null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">공급망 신호</h1>
        <p className="mt-1 text-sm text-muted">AI·반도체 공급망 출하 흐름 · 최근 3개월 전년비 · 마지막 갱신 {builtAt?.replace("T", " ") ?? "-"}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card min-w-0">
          <h2 className="mb-1 font-bold text-up">출하 가속</h2>
          {up.map((s) => <Row key={s.c.ticker} s={s} />)}
        </section>
        <section className="card min-w-0">
          <h2 className="mb-1 font-bold text-down">출하 둔화</h2>
          {down.map((s) => <Row key={s.c.ticker} s={s} />)}
        </section>
      </div>

      {ests.length > 0 && (
        <section className="card min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold">진행 분기 매출 추정 · 컨센서스 괴리</h2>
            <span className="text-xs text-muted">매출 연관도 A·B 흐름 회귀 · 백테스트 오차로 신뢰도 표시</span>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] whitespace-nowrap text-sm">
              <thead className="text-xs text-muted"><tr className="border-b border-line">
                <th className="py-2 text-left">종목</th><th className="text-left">분기</th><th className="text-right">추정 매출</th>
                <th className="text-right">직전 분기 대비</th><th className="text-right">컨센 대비</th><th className="text-right">백테스트 오차</th>
              </tr></thead>
              <tbody className="font-mono">
                {ests.map((e) => {
                  const ok = estReliable(e);
                  return (
                    <tr key={e.ticker} className={`border-b border-line/50 ${ok ? "" : "opacity-60"}`}>
                      <td className="py-2 font-sans"><Link className="font-bold hover:text-accent" href={`/stocks/${encodeURIComponent(e.ticker)}`}>{names[e.ticker] ?? e.ticker}</Link></td>
                      <td className="text-xs text-muted">{e.q_start.slice(0, 7)}~{e.q_end.slice(0, 7)}</td>
                      <td className="text-right font-bold">{money(e.est, e.currency)}</td>
                      <td className={`text-right ${tone(e.est / e.last_actual - 1)}`}>{pct(e.est / e.last_actual - 1)}</td>
                      <td className={`text-right font-bold ${e.cons_gap == null ? "text-muted" : tone(e.cons_gap)}`}>{e.cons_gap == null ? "-" : pct(e.cons_gap)}</td>
                      <td className="text-right text-xs"><span className={`mr-1 rounded px-1.5 py-0.5 font-sans ${ok ? "bg-up/20 text-up" : "bg-panel2 text-muted"}`}>{ok ? "신뢰" : "참고"}</span>{pct(e.mape, 1).replace("+", "")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">컨센 대비 = 무역 기반 추정 ÷ 애널리스트 컨센서스 − 1 (컨센 금액은 제공처 약관상 비공개). 신뢰 = 백테스트 오차 12% 이하이면서 &lsquo;직전 성장률 유지&rsquo;보다 정확. 한국 종목은 부문 매출이라 컨센 비교 없음.</p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Link href="/prices" className="card block min-w-0 transition hover:border-accent">
          <div className="flex items-baseline justify-between"><h2 className="font-bold">가격·지수</h2><span className="text-xs text-muted">전체 보기 →</span></div>
          <div className="mt-3 grid grid-cols-3 gap-3 font-mono">
            {gpu.map((r) => <div key={r.item}><div className="text-xs text-muted">{r.item}</div><div className="text-lg font-bold">${r.value.toFixed(2)}<span className="text-xs font-normal text-muted">/h</span></div></div>)}
          </div>
          <p className="mt-2 text-xs text-muted">GPU 렌탈가 · 토큰 가격 · 서버·스토리지 가격지수</p>
        </Link>
        <section className="card min-w-0">
          <div className="flex items-baseline justify-between"><h2 className="font-bold">급등 품목</h2><Link href="/surge" className="text-xs text-muted hover:text-fg">전체 보기 →</Link></div>
          <div className="mt-2 space-y-1 text-sm">
            {top.map((r) => (
              <div key={`${r.hs6}${r.partner}`} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate"><HsName ko={r.name_ko} en={r.name_en} hs={r.hs6} /> <span className="font-mono text-xs text-muted">{r.hs6}</span>
                  {related(r.hs6).map((t) => <Link key={t} href={`/stocks/${encodeURIComponent(t)}`} className="ml-1 rounded bg-accent/20 px-1.5 text-xs text-accent">{t}</Link>)}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted">{usd(r.value_usd)} <span className={tone(r.yoy3m)}>{pct(r.yoy3m)}</span></span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
