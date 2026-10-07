import { T } from "@/components/Names";
import { PriceChart } from "@/components/ComputeCharts";
import { pct, tone } from "@/lib/format";
import { IndexSection } from "@/components/IndexSection";
import { indicators, priceSnapshots, type PriceRow } from "@/lib/queries";

// 게시 직후 바로 보이도록 요청마다 렌더 (ISR 캐시가 게시 후에도 이전 데이터로 남던 문제). DB가 작아 부담 없음
export const dynamic = "force-dynamic";

const GPU_COLORS: Record<string, string> = {
  "H100 SXM": "#60a5fa", "H100 NVL": "#22d3ee", H200: "#f59e0b", "H200 NVL": "#f472b6", B200: "#34d399", B300: "#a78bfa",
};
const TOKEN_COLORS = ["#f472b6", "#a78bfa", "#60a5fa", "#34d399"];

/** 기준일로부터 days일 이전(이하) 가장 가까운 값 대비 변화율 */
function change(points: [string, number][], days: number) {
  if (points.length < 2) return null;
  const [lastDate, last] = points[points.length - 1];
  const cutoff = new Date(lastDate); cutoff.setDate(cutoff.getDate() - days);
  const prev = [...points].reverse().find(([d]) => new Date(d) <= cutoff);
  return prev ? last / prev[1] - 1 : null;
}

const series = (rows: PriceRow[], item: string, stat: string): [string, number][] =>
  rows.filter((r) => r.item === item && r.stat === stat).map((r) => [r.date, r.value]);

export default async function Prices() {
  const [rows, defs] = await Promise.all([priceSnapshots(), indicators()]);
  const idx = rows.filter((r) => r.kind === "index");
  const idxGroups = [...new Set(defs.map((d) => d.grp))];
  const gpu = rows.filter((r) => r.kind === "gpu");
  const tok = rows.filter((r) => r.kind === "token");
  const gpus = Object.keys(GPU_COLORS).filter((g) => gpu.some((r) => r.item === g));
  const models = [...new Set(tok.map((r) => r.item))];
  const daily = rows.filter((r) => r.kind !== "index");
  const first = daily[0]?.date, last = daily.at(-1)?.date;
  const days = new Set(daily.map((r) => r.date)).size;
  // 이력이 짧아 1주·1달 변화가 아직 계산 안 되면 열 자체를 숨김
  const gpuW = gpus.some((g) => change(series(gpu, g, "median"), 7) != null);
  const gpuM = gpus.some((g) => change(series(gpu, g, "median"), 30) != null);
  const tokM = models.some((md) => change(series(tok, md, "output"), 30) != null);
  const short = days > 0 && days < 30 ? `데이터 ${days}일치 — 매일 쌓이는 중이라 추세 판단은 이르니 참고만` : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold"><T ko="가격·지수" en="Prices & indices" /></h1>
        <p className="mt-1 text-sm text-muted">
          GPU·토큰 가격(일별) · 공급망 가격지수(월별) · {first ? `GPU·토큰 ${first} ~ ${last} 수집` : "수집 전"} · 매일 아침 갱신
        </p>
      </div>

      {!daily.length && <div className="card text-sm text-muted">아직 수집된 가격이 없습니다. 매일 아침 데이터 갱신 때 첫 값이 쌓입니다.</div>}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold"><T ko="GPU 렌탈가" en="GPU rental price" /> <span className="text-sm font-normal text-muted">$ / GPU·시간, 온디맨드</span></h2>
          <span className="text-xs text-muted">Vast.ai 마켓플레이스 대여 가능 매물의 중앙값 · 범례를 누르면 기종을 켜고 끕니다</span>
        </div>
        <div className="rounded-lg border border-line bg-panel2 px-4 py-3 text-sm leading-relaxed">
          이 탭의 GPU 가격은 <b>Vast.ai 공개 매물로 Investing Idea가 직접 계산한 지수</b>입니다.
          실제 거래 체결가 기반 지수(Ornn OCPI)는 재게시가 허용되지 않아 여기 싣지 않으니, 아래 사이트에서 확인하세요.
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <a className="text-accent" href="https://data.ornn.com/markets" target="_blank" rel="noreferrer">Ornn OCPI (H100·H200·B200 등) →</a>
            <a className="text-accent" href="https://www.silicondata.com/products/silicon-index/h100" target="_blank" rel="noreferrer">Silicon Data H100 지수 →</a>
          </div>
        </div>
        {gpus.length > 0 && (
          <div className="card min-w-0 space-y-4">
            {short && <div className="text-xs text-muted">{short}</div>}
            <PriceChart unit="$/GPU·h" height={320} lines={gpus.map((g) => ({ name: g, color: GPU_COLORS[g], points: series(gpu, g, "median") }))} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] whitespace-nowrap text-sm">
                <thead className="text-xs text-muted"><tr className="border-b border-line">
                  <th className="py-2 text-left"><T ko="기종" en="GPU" /></th><th className="text-right"><T ko="중앙값" en="Median" /></th><th className="text-right"><T ko="하위 25%" en="Bottom 25%" /></th>
                  {gpuW && <th className="text-right"><T ko="1주" en="1W" /></th>}{gpuM && <th className="text-right"><T ko="1달" en="1M" /></th>}<th className="text-right"><T ko="대여 가능 GPU" en="Available GPUs" /></th>
                </tr></thead>
                <tbody className="font-mono">
                  {gpus.map((g) => {
                    const med = series(gpu, g, "median");
                    const last = gpu.filter((r) => r.item === g && r.stat === "median").at(-1)!;
                    const p25 = series(gpu, g, "p25").at(-1)?.[1];
                    const w = change(med, 7), m = change(med, 30);
                    return (
                      <tr key={g} className="border-b border-line/50">
                        <td className="py-2 font-sans font-bold"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: GPU_COLORS[g] }} />{g}</td>
                        <td className="text-right font-bold">${last.value.toFixed(2)}</td>
                        <td className="text-right text-muted">{p25 != null ? `$${p25.toFixed(2)}` : "-"}</td>
                        {gpuW && <td className={`text-right ${tone(w)}`}>{pct(w)}</td>}
                        {gpuM && <td className={`text-right ${tone(m)}`}>{pct(m)}</td>}
                        <td className="text-right text-muted">{last.n}장 <span className="text-xs">({last.detail?.replace("vast.ai ", "")})</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="text-xs leading-relaxed text-muted">
          스팟 매물 가격이라 GPU 클라우드 업체가 실제 받는 장기계약 단가와는 다릅니다. GPU 공급이 빠듯한지(가격↑·매물↓) 남는지(가격↓·매물↑)를 보는 업황 신호로 쓰세요.
          매물이 기종당 수십 개 수준이라 하루 단위로는 출렁일 수 있습니다.
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold"><T ko="프런티어 모델 토큰 가격" en="Frontier model token prices" /> <span className="text-sm font-normal text-muted">$ / 100만 토큰</span></h2>
          <span className="text-xs text-muted">OpenRouter 정가 · 각 회사 최신 플래그십</span>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px] whitespace-nowrap text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-line">
              <th className="py-2 text-left"><T ko="모델" en="Model" /></th><th className="text-left"><T ko="현재 가리키는 모델" en="Current model" /></th>
              <th className="text-right"><T ko="입력" en="Input" /></th><th className="text-right"><T ko="출력" en="Output" /></th>{tokM && <th className="text-right"><T ko="출력" en="Output" /> 1달</th>}
            </tr></thead>
            <tbody className="font-mono">
              {models.map((md) => {
                const inp = series(tok, md, "input"), out = series(tok, md, "output");
                const c = change(out, 30);
                const detail = tok.filter((r) => r.item === md).at(-1)?.detail;
                return (
                  <tr key={md} className="border-b border-line/50">
                    <td className="py-2 font-sans font-bold">{md}</td>
                    <td className="text-xs text-muted">{detail}</td>
                    <td className="text-right">${inp.at(-1)?.[1].toFixed(2)}</td>
                    <td className="text-right">${out.at(-1)?.[1].toFixed(2)}</td>
                    {tokM && <td className={`text-right ${tone(c)}`}>{pct(c)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {models.length > 0 && (
          <div className="card">
            <h3 className="font-bold"><T ko="출력" en="Output" /> 토큰 가격 추이</h3>
            {short && <div className="text-xs text-muted">{short}</div>}
            <PriceChart unit="$/M" height={260} lines={models.map((md, i) => ({ name: md, color: TOKEN_COLORS[i % TOKEN_COLORS.length], points: series(tok, md, "output"), step: true }))} />
          </div>
        )}
        <p className="text-xs leading-relaxed text-muted">
          정가는 신모델 출시·가격 인하 때만 계단식으로 바뀝니다. 같은 성능의 토큰이 싸지는 속도가 GPU 수요(추론 물량)와 GPU 클라우드 마진을 가르는 변수입니다.
        </p>
      </section>

      {idxGroups.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold"><T ko="공급망 가격지수" en="Supply chain price indices" /> <span className="text-sm font-normal text-muted">생산자물가·수출입 가격 (BLS)</span></h2>
            <span className="text-xs text-muted">물량이 아니라 단가 사이클 — 매출 = 물량 × 단가의 단가 쪽</span>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {idxGroups.map((g) => <IndexSection key={g} grp={g} defs={defs.filter((d) => d.grp === g)} rows={idx} />)}
          </div>
          <p className="text-xs leading-relaxed text-muted">
            메모리 단가는 한국·미국 무역통계의 금액÷수량으로 직접 계산한 값입니다 (월별, 제품 구성 변화도 섞임).
            DDR5 RDIMM 스팟·계약가는 출처 약관상 재게시가 안 되어 링크로 안내합니다:{" "}
            <a className="text-accent" href="https://www.memorymarket.com/price/ems/100263" target="_blank" rel="noreferrer">MemoryMarket DDR5 RDIMM 64GB</a> ·{" "}
            <a className="text-accent" href="https://memoryindex.io/ddr5-price" target="_blank" rel="noreferrer">MemoryIndex DDR5</a>
          </p>
        </section>
      )}
    </div>
  );
}
