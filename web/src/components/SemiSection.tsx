import { StackChart } from "@/components/ComputeCharts";
import { T } from "@/components/Names";
import type { Obs } from "@/lib/queries";

export const CAPEX_IDS = ["capex_samsung", "capex_skhynix", "capex_mu"];

/** AI 가속기 공식 사양 (BF16 dense PFLOPS · HBM GB · 메모리 대역폭 TB/s) — 나쁜양파 정리 표를 공식 사양으로 대조. MI455X는 양산 사양 */
type Chip = { name: string; line: "NVIDIA" | "AMD" | "TPU" | "TPU e"; cohort: string; bf16: number; hbm: number; bw: number };
const CHIPS: Chip[] = [
  { name: "MI250X", line: "AMD", cohort: "2021", bf16: 0.383, hbm: 128, bw: 3.2 },
  { name: "H100 SXM", line: "NVIDIA", cohort: "2022", bf16: 0.9895, hbm: 80, bw: 3.35 },
  { name: "TPU v4", line: "TPU", cohort: "2022", bf16: 0.275, hbm: 34.4, bw: 1.2 },
  { name: "MI300A", line: "AMD", cohort: "2023", bf16: 0.9806, hbm: 128, bw: 5.3 },
  { name: "MI300X", line: "AMD", cohort: "2023", bf16: 1.3074, hbm: 192, bw: 5.3 },
  { name: "TPU v5e", line: "TPU e", cohort: "2023", bf16: 0.197, hbm: 16, bw: 0.819 },
  { name: "TPU v5p", line: "TPU", cohort: "2024H1", bf16: 0.459, hbm: 102, bw: 2.765 },
  { name: "H200 SXM", line: "NVIDIA", cohort: "2024H1", bf16: 0.9895, hbm: 141, bw: 4.8 },
  { name: "GB200 (GPU당)", line: "NVIDIA", cohort: "2024H2", bf16: 2.5, hbm: 186, bw: 8 },
  { name: "MI325X", line: "AMD", cohort: "2024H2", bf16: 1.3074, hbm: 256, bw: 6 },
  { name: "TPU v6e Trillium", line: "TPU e", cohort: "2024H2", bf16: 0.918, hbm: 34.4, bw: 1.64 },
  { name: "MI350X", line: "AMD", cohort: "2025", bf16: 2.3, hbm: 288, bw: 8 },
  { name: "MI355X", line: "AMD", cohort: "2025", bf16: 2.5166, hbm: 288, bw: 8 },
  { name: "GB300 (GPU당)", line: "NVIDIA", cohort: "2025", bf16: 2.5, hbm: 279, bw: 8 },
  { name: "TPU Ironwood", line: "TPU", cohort: "2026", bf16: 2.307, hbm: 206.2, bw: 7.37 },
  { name: "Rubin (NVL72, GPU당)", line: "NVIDIA", cohort: "2026", bf16: 4, hbm: 288, bw: 19.2 },
  { name: "MI455X", line: "AMD", cohort: "2026", bf16: 5, hbm: 432, bw: 23.3 },
];
const COHORTS = ["2021", "2022", "2023", "2024H1", "2024H2", "2025", "2026"];
const LINES: { line: Chip["line"]; color: string; label: string }[] = [
  { line: "NVIDIA", color: "#76b900", label: "NVIDIA" }, { line: "AMD", color: "#f87171", label: "AMD (세대 최상위)" },
  { line: "TPU", color: "#60a5fa", label: "구글 TPU 고성능" }, { line: "TPU e", color: "#a78bfa", label: "구글 TPU 효율형" },
];
/** 세대별 각 라인의 최상위 제품 값 (같은 세대에 여러 개면 큰 값) */
const series = (key: "bf16" | "hbm" | "bw") => LINES.map((l) => ({
  name: l.label, color: l.color,
  values: COHORTS.map((c) => { const v = CHIPS.filter((x) => x.line === l.line && x.cohort === c).map((x) => x[key]); return v.length ? Math.max(...v) : null; }),
}));
const RATIO: [string, string, string][] = [["TPU v4", "H100 SXM", "2022"], ["TPU v5p", "H200 SXM", "2024H1"], ["TPU Ironwood", "Rubin (NVL72, GPU당)", "2026"]];
const chip = (n: string) => CHIPS.find((c) => c.name === n)!;
const fmtPct = (v: number | null) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

/** 반도체 투자·AI 칩: 메모리 3사 설비투자(분기) · AI 가속기 세대별 사양 */
export function SemiSection({ obs }: { obs: Obs[] }) {
  // 분기 합 (ETL은 분기 금액을 3개월에 ÷3씩 저장) → 3개월 다 있는 분기만
  const qOf = (m: string) => `${m.slice(0, 4)}Q${Math.ceil(Number(m.slice(5, 7)) / 3)}`;
  const sum = (id: string) => {
    const acc = new Map<string, { v: number; n: number }>();
    for (const o of obs.filter((x) => x.series_id === id && x.month >= "2021-01")) {
      const q = qOf(o.month), a = acc.get(q) ?? { v: 0, n: 0 };
      acc.set(q, { v: a.v + (o.value_usd ?? 0), n: a.n + 1 });
    }
    return new Map([...acc].filter(([, a]) => a.n === 3).map(([q, a]) => [q, a.v / 1e9]));
  };
  const sam = sum("capex_samsung"), hy = sum("capex_skhynix"), mu = sum("capex_mu");
  const qs = [...sam.keys()].filter((q) => hy.has(q) && mu.has(q)).sort();
  const tot = qs.map((q) => sam.get(q)! + hy.get(q)! + mu.get(q)!);
  const yoy = tot.map((v, i) => (i >= 4 ? +((v / tot[i - 4] - 1) * 100).toFixed(1) : null));
  const last = qs.length - 1;
  const r2 = (m: Map<string, number>) => qs.map((q) => +m.get(q)!.toFixed(2));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold"><T ko="반도체 투자 · AI 칩" en="Semi capex · AI accelerators" /> <span className="text-sm font-normal text-muted">메모리 설비투자 → 장비 수요 · 가속기당 HBM → 메모리 수요</span></h2>
        <span className="text-xs text-muted">DART·SEC 현금흐름표 · 각 사 공식 사양</span>
      </div>
      {qs.length > 0 && (
        <div className="card min-w-0">
          <h3 className="font-bold">메모리 3사 설비투자 (현금 CAPEX) <span className="text-xs font-normal text-muted">분기 · 유형자산 취득 · 최근 {qs[last]}</span></h3>
          <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
            <span>합계 <b>${tot[last].toFixed(2)}B</b> <span className="text-xs text-muted">전년비 {fmtPct(yoy[last] == null ? null : yoy[last]! / 100)}</span></span>
            <span>삼성전자 <b>${sam.get(qs[last])!.toFixed(2)}B</b></span>
            <span>SK하이닉스 <b>${hy.get(qs[last])!.toFixed(2)}B</b></span>
            <span>마이크론 <b>${mu.get(qs[last])!.toFixed(2)}B</b></span>
          </div>
          <StackChart months={qs} left="$B" right="전년비 %" bars={[
            { name: "삼성전자", color: "#3b5bdb", values: r2(sam) }, { name: "SK하이닉스", color: "#f87171", values: r2(hy) }, { name: "마이크론", color: "#22d3ee", values: r2(mu) },
          ]} lines={[{ name: "합계 전년비", color: "#fbbf24", values: yoy }]} />
          <p className="mt-1 text-xs leading-relaxed text-muted">
            삼성전자·SK하이닉스는 DART 연결 현금흐름표(반기·3분기 누적값을 차감해 분기화, 분기 평균 환율로 달러 환산), 마이크론은 SEC 10-Q(회계분기를 가까운 달력 분기로).
            삼성은 회사 전체(디스플레이 등 포함). 실측: 미코 매출과 전년비 상관 0.52(동행), ASML 매출과는 0.33(1분기 선행)으로 약함 — ASML은 TSMC·중국 비중이 커서 메모리만으론 설명이 부족.
          </p>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        {([["bf16", "BF16 연산 (dense, PFLOPS)", "PF"], ["hbm", "HBM 용량 (GB)", "GB"], ["bw", "메모리 대역폭 (TB/s)", "TB/s"]] as const).map(([k, title, unit]) => (
          <div key={k} className="card min-w-0">
            <h3 className="font-bold">{title} <span className="text-xs font-normal text-muted">세대별 최상위</span></h3>
            <StackChart months={COHORTS} left={unit} bars={[]} lines={series(k)} height={260} dots />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card min-w-0">
          <h3 className="font-bold">구글 TPU ÷ NVIDIA BF16 <span className="text-xs font-normal text-muted">같은 세대 비교</span></h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-line"><th className="py-1 text-left font-normal">세대</th><th className="text-left font-normal">TPU</th><th className="text-left font-normal">NVIDIA</th><th className="text-right font-normal">비율</th></tr></thead>
            <tbody className="font-mono">
              {RATIO.map(([t, n, c]) => (
                <tr key={c} className="border-b border-line/50"><td className="py-1 font-sans text-xs">{c}</td><td className="font-sans">{t}</td><td className="font-sans">{n}</td>
                  <td className="text-right font-bold">{((chip(t).bf16 / chip(n).bf16) * 100).toFixed(1)}%</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">TPU가 NVIDIA 대비 연산 격차를 빠르게 좁히는 중 (27.8% → 46.4% → 57.7%). 구글 자체 칩 비중이 늘면 브로드컴(설계)·HBM 공급사 수혜, NVIDIA 독점 약화.</p>
        </div>
        <div className="card min-w-0">
          <h3 className="font-bold">가속기 1개당 HBM — 메모리 수요로 <span className="text-xs font-normal text-muted">NVIDIA 기준</span></h3>
          <div className="mt-2 space-y-1 text-sm">
            {CHIPS.filter((c) => c.line === "NVIDIA").map((c, i, a) => (
              <div key={c.name} className="flex justify-between gap-2"><span>{c.cohort} · {c.name}</span>
                <span className="font-mono">{c.hbm}GB{i > 0 && <span className="ml-2 text-xs text-muted">×{(c.hbm / a[0].hbm).toFixed(1)}</span>}</span></div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">H100 80GB → Rubin 288GB (3.6배), AMD MI455X는 432GB. 가속기 출하가 같아도 HBM 수요는 세대마다 커짐 → SK하이닉스·마이크론·삼성 HBM 물량의 구조적 동력. 대역폭은 같은 기간 5.7배(3.35 → 19.2TB/s).</p>
        </div>
      </div>
      <p className="text-xs text-muted">사양: 각 사 공식 발표 기준(BF16 dense, 희소성 미적용). GB200·GB300·Rubin은 GPU 1개 기준. 구글 TPU 용량은 GiB 공시를 GB로 환산(×1.074). 나쁜양파 정리 표를 공식 사양으로 대조함.</p>
    </section>
  );
}
