import { PriceChart } from "@/components/ComputeCharts";
import { pct, tone } from "@/lib/format";

// Ornn 무료 API — 개인 열람 전용. 약관상 웹사이트·대시보드 재게시와 자체 지수 보정·비교에 쓰는 것이 금지돼 있어
// DB에 저장하지 않고(→ Supabase로 게시되지 않음) 관리 페이지(로컬 전용, 공개 사이트에선 404)에서 그때그때 받아 보여준다.
const API = "https://api.ornnai.com/api";
const GPUS: Record<string, string> = { "H100 SXM": "#60a5fa", H200: "#f59e0b", B200: "#34d399", "A100 SXM4": "#f472b6", "RTX 5090": "#a78bfa" };
const LABS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", deepseek: "DeepSeek" };
const LAB_COLORS = ["#f472b6", "#60a5fa", "#fbbf24", "#34d399"];

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { next: { revalidate: 3600 } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const change = (pts: [string, number][], back: number) =>
  pts.length > back ? pts[pts.length - 1][1] / pts[pts.length - 1 - back][1] - 1 : null;

export default async function OrnnPrivate() {
  const start = new Date(); start.setMonth(start.getMonth() - 1);
  const [gpus, otpi] = await Promise.all([
    Promise.all(Object.keys(GPUS).map(async (g) => {
      const d = await get<{ data: { timestamp: string; index_value: number }[] }>(`/gpu/${encodeURIComponent(g)}/index-history`);
      return { g, pts: (d?.data ?? []).map((x) => [x.timestamp.slice(0, 10), x.index_value] as [string, number]) };
    })),
    get<{ data: { date: string; lab: string; indexPerMtok: number }[] }>(`/otpi?startDate=${start.toISOString().slice(0, 10)}&endDate=${new Date().toISOString().slice(0, 10)}`),
  ]);
  const labs = Object.keys(LABS).filter((l) => otpi?.data.some((x) => x.lab === l));
  const labPts = (l: string) => (otpi?.data ?? []).filter((x) => x.lab === l).sort((a, b) => a.date.localeCompare(b.date)).map((x) => [x.date, x.indexPerMtok] as [string, number]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Ornn 지수 <span className="text-base font-normal text-muted">· 개인 열람용</span></h1>
        <p className="mt-1 text-sm text-amber-300">
          로컬 관리 페이지에서만 보입니다. Ornn 약관상 웹사이트·대시보드 재게시, 자체 지수 보정·비교에 사용 금지 — 공개 사이트로 옮기지 마세요 (문의: legal@ornn.com).
        </p>
        <p className="mt-1 text-xs text-muted">
          출처 <a className="text-accent" href="https://data.ornn.com/markets" target="_blank" rel="noreferrer">Ornn OCPI · OTPI</a> 무료 API (컴퓨트 최근 3개월, 토큰 최근 1개월) · 거래 체결가 기반 일별 정산값
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {gpus.map(({ g, pts }) => (
          <div key={g} className="card min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div><div className="font-bold">{g}</div><div className="text-xs text-muted">{pts.at(-1)?.[0] ?? "데이터 없음"}</div></div>
              {pts.length > 0 && (
                <div className="text-right">
                  <div className="font-mono text-xl font-bold">${pts.at(-1)![1].toFixed(2)}</div>
                  <div className="font-mono text-xs">
                    <span className={tone(change(pts, 7))}>1주 {pct(change(pts, 7))}</span> · <span className={tone(change(pts, 30))}>1달 {pct(change(pts, 30))}</span>
                  </div>
                </div>
              )}
            </div>
            <PriceChart unit="$/GPU·h" lines={[{ name: "OCPI", color: GPUS[g], points: pts }]} />
          </div>
        ))}
      </section>

      {labs.length > 0 && (
        <section className="card">
          <h2 className="font-bold">토큰 가격 지수 (OTPI) <span className="text-sm font-normal text-muted">$ / 100만 토큰, 연구소별</span></h2>
          <PriceChart unit="$/M" height={280} lines={labs.map((l, i) => ({ name: LABS[l], color: LAB_COLORS[i], points: labPts(l) }))} />
        </section>
      )}
    </div>
  );
}
