import type { Metadata } from "next";
import { T } from "@/components/Names";
import { PlantMap, type FlowStat } from "@/components/PlantMap";
import { yoy3m } from "@/lib/estimate";
import { allSeries, observations, plants } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "공장 지도", description: "AI·반도체 공급망 공장 위치·상태와, 각 공장 출하를 보여주는 세관 무역 흐름" };

export default async function Plants({ searchParams }: PageProps<"/plants">) {
  const sp = await searchParams;
  const initialQ = typeof sp.q === "string" ? sp.q : "";
  const [list, series] = await Promise.all([plants(), allSeries()]);
  const ids = [...new Set(list.flatMap((p) => JSON.parse(p.flows) as string[]))];
  const obs = ids.length ? await observations(ids) : [];
  const label = Object.fromEntries(series.map((s) => [s.id, s.label]));
  const unit = Object.fromEntries(series.map((s) => [s.id, s.unit]));
  // 흐름별 최근 3개월 전년비·최근 월·24개월 스파크라인 (서버에서 계산해 클라이언트로 작게 전달)
  const stats: Record<string, FlowStat> = {};
  for (const id of ids) {
    const rows = obs.filter((o) => o.series_id === id);
    const vals = rows.map((o) => o.value_usd);
    const y = yoy3m(vals);
    stats[id] = { label: label[id] ?? id, month: y.index >= 0 ? rows[y.index]?.month ?? null : null, yoy3m: y.value,
      spark: vals.slice(-24).map((v) => v ?? 0), money: !["건", "MW", "MWh"].includes(unit[id] ?? "") };
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold"><T ko="공장 지도" en="Plant map" /></h1>
        <p className="mt-1 text-sm text-muted">추적 종목과 핵심 공급망의 공장 {list.length}곳 · 공장마다 그 출하를 보여주는 세관 무역 흐름을 연결해, 지금 어느 공장이 바쁜지 숫자로 봅니다.</p>
      </div>
      {list.length ? <PlantMap plants={list} stats={stats} initialQ={initialQ} /> : <div className="card text-sm text-muted">공장 데이터가 아직 게시되지 않았습니다.</div>}
      <p className="text-xs leading-relaxed text-muted">
        위치는 산업단지·도시 수준 좌표(수 km 오차)이며, 상태·제품·증설 내용은 회사 공시·IR·보도 기준(각 공장의 &lsquo;기준&rsquo; 월)입니다. 위탁생산 공장은 회사가 밝힌 거점 기준이고, 실제 물량 배분은 공개되지 않습니다.
        &lsquo;연결된 무역 흐름&rsquo;은 그 공장이 있는 지역·경로의 세관 통계로, 다른 회사 물량이 섞일 수 있습니다(종목 화면의 상관 등급 참고). 위성 사진은 외부 지도(구글)로 연결합니다.
      </p>
    </div>
  );
}
