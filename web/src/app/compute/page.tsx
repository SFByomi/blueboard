import { PriceChart } from "@/components/ComputeCharts";
import { pct, tone } from "@/lib/format";
import { priceSnapshots, type PriceRow } from "@/lib/queries";

export const revalidate = 3600;

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

export default async function Compute() {
  const rows = await priceSnapshots();
  const gpu = rows.filter((r) => r.kind === "gpu");
  const tok = rows.filter((r) => r.kind === "token");
  const gpus = Object.keys(GPU_COLORS).filter((g) => gpu.some((r) => r.item === g));
  const models = [...new Set(tok.map((r) => r.item))];
  const first = rows[0]?.date, last = rows.at(-1)?.date;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">GPU·토큰 가격</h1>
        <p className="mt-1 text-sm text-muted">
          AI 컴퓨트 수급 지표 · {first ? `${first} ~ ${last} 일별 수집` : "수집 전"} · 매일 아침 갱신
        </p>
      </div>

      {!rows.length && <div className="card text-sm text-muted">아직 수집된 가격이 없습니다. 매일 아침 데이터 갱신 때 첫 값이 쌓입니다.</div>}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">GPU 렌탈가 <span className="text-sm font-normal text-muted">$ / GPU·시간, 온디맨드</span></h2>
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
            <PriceChart unit="$/GPU·h" height={320} lines={gpus.map((g) => ({ name: g, color: GPU_COLORS[g], points: series(gpu, g, "median") }))} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] whitespace-nowrap text-sm">
                <thead className="text-xs text-muted"><tr className="border-b border-line">
                  <th className="py-2 text-left">기종</th><th className="text-right">중앙값</th><th className="text-right">하위 25%</th>
                  <th className="text-right">1주</th><th className="text-right">1달</th><th className="text-right">대여 가능 GPU</th>
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
                        <td className={`text-right ${tone(w)}`}>{pct(w)}</td>
                        <td className={`text-right ${tone(m)}`}>{pct(m)}</td>
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
          <h2 className="text-lg font-bold">프런티어 모델 토큰 가격 <span className="text-sm font-normal text-muted">$ / 100만 토큰</span></h2>
          <span className="text-xs text-muted">OpenRouter 정가 · 각 회사 최신 플래그십</span>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px] whitespace-nowrap text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-line">
              <th className="py-2 text-left">모델</th><th className="text-left">현재 가리키는 모델</th>
              <th className="text-right">입력</th><th className="text-right">출력</th><th className="text-right">출력 1달</th>
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
                    <td className={`text-right ${tone(c)}`}>{pct(c)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {models.length > 0 && (
          <div className="card">
            <h3 className="font-bold">출력 토큰 가격 추이</h3>
            <PriceChart unit="$/M" height={260} lines={models.map((md, i) => ({ name: md, color: TOKEN_COLORS[i % TOKEN_COLORS.length], points: series(tok, md, "output"), step: true }))} />
          </div>
        )}
        <p className="text-xs leading-relaxed text-muted">
          정가는 신모델 출시·가격 인하 때만 계단식으로 바뀝니다. 같은 성능의 토큰이 싸지는 속도가 GPU 수요(추론 물량)와 GPU 클라우드 마진을 가르는 변수입니다.
        </p>
      </section>
    </div>
  );
}
