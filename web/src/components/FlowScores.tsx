import { STAGES, stageOf } from "@/lib/format";
import type { FlowScore } from "@/lib/queries";

export const GRADE_STYLE: Record<string, string> = {
  A: "bg-up/20 text-up",
  B: "bg-accent/20 text-accent",
  C: "bg-panel text-fg ring-1 ring-line",
  D: "bg-panel text-muted ring-1 ring-line",
};
export const VERDICT: Record<string, string> = { A: "직접 연동", B: "연동", C: "업황 참고", D: "연관 약함" };

export function GradeBadge({ grade }: { grade: string | null }) {
  return (
    <span className={`inline-block w-5 shrink-0 rounded text-center font-mono text-[11px] font-bold leading-[18px] ${GRADE_STYLE[grade ?? ""] ?? "bg-panel text-muted ring-1 ring-line"}`}>
      {grade ?? "-"}
    </span>
  );
}

const f = (v: number | null) => (v == null ? "-" : v.toFixed(2));
const lagLabel = (k: number | null) => (k == null ? "" : k === 0 ? "동행" : `${k}분기 선행`);
const SOLID = 8; // etl/scores.SOLID_YOY

type Row = FlowScore & { label: string; role: string };

/** 매핑된 흐름별 매출 상관 표 — 어떤 품목이 매출과 직접 연결되는지 (etl/scores.py). 종목 화면 공급망 섹션의 펼침 안 */
export function FlowScores({ rows }: { rows: Row[] }) {
  if (!rows.length) return null;
  const order = { A: 0, B: 1, C: 2, D: 3 } as Record<string, number>;
  const sorted = [...rows].sort((a, b) => (order[a.grade ?? ""] ?? 9) - (order[b.grade ?? ""] ?? 9) || (b.best ?? -9) - (a.best ?? -9));
  const short = sorted.some((r) => r.n_yoy < SOLID + 2 * (r.best_lag ?? 0) && (r.best ?? 0) >= 0.5);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line text-left">
              <th className="py-1.5 pr-2 font-normal">흐름</th>
              <th className="px-2 font-normal">등급</th>
              <th className="px-2 text-right font-normal">전년비 상관</th>
              <th className="px-2 text-right font-normal">최근 8분기</th>
              <th className="pl-2 text-right font-normal">표본</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const capped = r.n_yoy < SOLID + 2 * (r.best_lag ?? 0) && (r.best ?? 0) >= 0.5;
              return (
                <tr key={r.series_id} className="border-b border-line/50 last:border-0">
                  <td className="max-w-[240px] py-1.5 pr-2">
                    <div className="truncate">{r.label}</div>
                    <div className="text-xs text-muted">{STAGES.find((s) => s.key === stageOf(r.role))?.title}</div>
                  </td>
                  <td className="whitespace-nowrap px-2"><GradeBadge grade={r.grade} /> <span className="text-xs text-muted">{r.grade ? VERDICT[r.grade] : "표본 부족"}</span></td>
                  <td className="whitespace-nowrap px-2 text-right font-mono">{f(r.best)} <span className="text-xs text-muted">{lagLabel(r.best_lag)}</span></td>
                  <td className={`px-2 text-right font-mono ${r.recent != null && r.best != null && r.recent < r.best - 0.4 ? "text-down" : ""}`}>{f(r.recent)}</td>
                  <td className={`pl-2 text-right font-mono ${capped ? "text-amber-300" : "text-muted"}`}>{r.n_yoy}분기{capped ? "*" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        등급은 분기 매출 전년비와 흐름 전년비의 상관(흐름이 0~2분기 앞설 때 중 최고): A ≥0.7 직접 연동 · B ≥0.5 연동 · C ≥0.3 업황 참고 · D 연관 약함.
        {short && <> <span className="text-amber-300">*</span> 표본(비교 가능한 분기)이 {SOLID}분기 미만이면 우연일 수 있어 상관이 높아도 최대 C — 상장·분사한 지 얼마 안 된 회사가 해당.</>}
        {" "}최근 8분기가 빨간색이면 관계가 약해지는 중.
      </p>
    </div>
  );
}
