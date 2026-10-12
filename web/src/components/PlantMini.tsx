"use client";

import * as echarts from "echarts";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { registerWorld } from "@/components/PlantMap";

export type MiniPoint = { id: number; lon: number; lat: number; name: string; sub: string; yoy: number | null; q: string };

/** 홈용 작은 공장 지도 — 점 색 = 연결된 무역 흐름의 최근 3개월 전년비 (초록 증가·빨강 감소·회색 흐름 없음). 클릭하면 공장 지도에서 그 회사 */
const colorOf = (y: number | null) => (y == null ? "#5c6280" : y >= 0.3 ? "#22c55e" : y >= 0 ? "#86efac" : y >= -0.2 ? "#fca5a5" : "#ef4444");

export function PlantMini({ points }: { points: MiniPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    registerWorld();
    const chart = echarts.init(ref.current!, undefined, { renderer: "canvas" });
    chart.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "item", backgroundColor: "#1a1f3a", borderColor: "#2c3358", textStyle: { color: "#e6e8f2", fontSize: 12 },
        formatter: (p: { data?: { name?: string; sub?: string } }) => (p.data?.name ? `<b>${p.data.name}</b><br/>${p.data.sub ?? ""}` : "") },
      geo: { map: "world", roam: false, boundingCoords: [[-128, 63], [150, -3]], left: 0, right: 0, top: 0, bottom: 0, itemStyle: { areaColor: "#141a33", borderColor: "#2c3358", borderWidth: 0.5 },
        emphasis: { disabled: true }, select: { disabled: true }, label: { show: false } },
      series: [{ type: "scatter", coordinateSystem: "geo", symbolSize: 7,
        data: points.map((p) => ({ ...p, value: [p.lon, p.lat], itemStyle: { color: colorOf(p.yoy), opacity: 0.9 } })) }],
    });
    chart.on("click", (e) => { const q = (e.data as { q?: string } | undefined)?.q; if (q) router.push(`/plants?q=${encodeURIComponent(q)}`); });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current!);
    return () => { ro.disconnect(); chart.dispose(); };
  }, [points, router]);
  return <div ref={ref} className="h-[140px] w-full sm:h-[230px]" />;
}
