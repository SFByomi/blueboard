"use client";

import * as echarts from "echarts";
import { useEffect, useRef } from "react";

export function EChart({ option, height = 360, onAxis }: { option: echarts.EChartsOption; height?: number; onAxis?: (i: number | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    chart.current = echarts.init(ref.current!, undefined, { renderer: "canvas" });
    if (onAxis) chart.current.on("updateAxisPointer", (e) => {  // 카테고리 축: value = 가리킨 칸 번호
      const v = (e as { axesInfo?: { axisDim: string; value: number }[] }).axesInfo?.find((a) => a.axisDim === "x")?.value;
      onAxis(typeof v === "number" ? v : null);
    });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current!);
    return () => { ro.disconnect(); chart.current?.dispose(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- onAxis는 setState라 바뀌지 않음

  useEffect(() => { chart.current?.setOption(option, true); }, [option]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}

export const axis = {
  axisLine: { lineStyle: { color: "#3a4166" } },
  axisLabel: { color: "#8a90ad", fontSize: 11 },
  splitLine: { lineStyle: { color: "#1f2442" } },
};

export const baseOption = (): echarts.EChartsOption => ({
  backgroundColor: "transparent",
  textStyle: { fontFamily: "inherit" },
  tooltip: {
    trigger: "axis", backgroundColor: "#1a1f3a", borderColor: "#2c3358", textStyle: { color: "#e6e8f2", fontSize: 12 },
    valueFormatter: (v) => (v == null ? "-" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })),
  },
  legend: { bottom: 0, textStyle: { color: "#aab0cc", fontSize: 11 }, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
  grid: { left: 60, right: 60, top: 24, bottom: 64 },
});
