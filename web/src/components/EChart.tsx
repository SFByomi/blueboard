"use client";

import * as echarts from "echarts";
import { useEffect, useRef } from "react";

export function EChart({ option, height = 360 }: { option: echarts.EChartsOption; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    chart.current = echarts.init(ref.current!, undefined, { renderer: "canvas" });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current!);
    return () => { ro.disconnect(); chart.current?.dispose(); };
  }, []);

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
