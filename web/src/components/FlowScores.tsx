import { STAGES, stageOf } from "@/lib/format";
import type { FlowScore } from "@/lib/queries";

export const GRADE_STYLE: Record<string, string> = {
  A: "bg-up/20 text-up",
  B: "bg-accent/20 text-accent",
  C: "bg-panel2 text-fg",
  D: "bg-panel2 text-muted",
};
const VERDICT: Record<string, string> = { A: "직접 연동", B: "연동", C: "업황 참고", D: "연관 약함" };

export function GradeBadge({ grade }: { grade: string | null }) {
  return (
    <span className={`inline-block w-6 rounded text-center font-mono text-xs font-bold leading-5 ${GRADE_STYLE[grade ?? ""] ?? "bg-panel2 text-muted"}`}>
      {grade ?? "-"}
    </span>
  );
}

const f = (v: number | null) => (v == null ? "-" : v.toFixed(2));
const lagLabel = (k: number | null) => (k == null ? "" : k === 0 ? "동행" : `${k}분기 선행`);

type Row = FlowScore & { label: string; role: string };

/** 매핑된 흐름별 매출 상관 — 어떤 품목이 매출과 직접 연결되는지 (etl/scores.py) */
export function FlowScores({ rows }: { rows: Row[] }) {
  if (!rows.length) return null;
  const order = { A: 0, B: 1, C: 2, D: 3 } as Record<string, number>;
  const sorted = [...rows].sort((a, b) => (order[a.grade ?? ""] ?? 9) - (order[b.grade ?? ""] ?? 9) || (b.best ?? -9) - (a.best ?? -9));
  return (
    <div className="card min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">매출 연관도</h2>
        <span className="text-xs text-muted">분기 매출 vs 무역 흐름 · 전년비 상관 기준 등급</span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line text-left">
              <th className="py-1.5 pr-2 font-normal">흐름</th>
              <th className="px-2 font-normal">등급</th>
              <th className="px-2 text-right font-normal">전년비 상관</th>
              <th className="px-2 text-right font-normal">최근 8분기</th>
              <th className="px-2 text-right font-normal">금액 상관</th>
              <th className="pl-2 text-right font-normal">표본</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.series_id} className="border-b border-line/50 last:border-0">
                <td className="max-w-[280px] py-1.5 pr-2">
                  <div className="truncate">{r.label}</div>
                  <div className="text-xs text-muted">{STAGES.find((s) => s.key === stageOf(r.role))?.title}</div>
                </td>
                <td className="px-2 whitespace-nowrap"><GradeBadge grade={r.grade} /> <span className="text-xs text-muted">{r.grade ? VERDICT[r.grade] : "표본 부족"}</span></td>
                <td className="px-2 text-right font-mono whitespace-nowrap">{f(r.best)} <span className="text-xs text-muted">{lagLabel(r.best_lag)}</span></td>
                <td className={`px-2 text-right font-mono ${r.recent != null && r.best != null && r.recent < r.best - 0.4 ? "text-down" : ""}`}>{f(r.recent)}</td>
                <td className="px-2 text-right font-mono text-muted">{f(r.level)}</td>
                <td className="pl-2 text-right font-mono text-muted">{r.n_yoy}분기</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        전년비 상관은 계절성·장기 추세를 걷어낸 실제 연동(무역이 0~2분기 앞설 때 중 최고). 등급 A ≥0.7 · B ≥0.5 · C ≥0.3, 표본이 짧으면 최대 C.
        금액 상관은 둘 다 성장하기만 해도 높게 나와 참고용. 최근 8분기가 크게 낮으면(빨강) 관계가 약해지는 중.
      </p>
    </div>
  );
}
