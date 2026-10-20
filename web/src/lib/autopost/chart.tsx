import { ImageResponse } from "next/og";
import type { FlowPick } from "./pick";

// 자동 게시 차트 — opengraph-image.tsx와 같은 ImageResponse 방식. 기본 폰트에 한글이 없어 영문만.
export const CHART_SIZE = { width: 1200, height: 675 }; // X 권장 16:9

export async function renderChart(picks: FlowPick[], labels: Record<string, string>): Promise<ArrayBuffer> {
  const sources = [...new Set(picks.flatMap((p) => p.sources))].join(" · ");
  const res = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "44px 52px", background: "linear-gradient(135deg, #0b0e1c 0%, #141830 60%, #1d2350 100%)", color: "#e6e8f2" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 22, color: "#8a90ad", letterSpacing: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 6, background: "#7c86ff" }} />
            INVESTING IDEA
          </div>
          <div style={{ fontSize: 22, color: "#8a90ad" }}>Biggest supply-chain moves · 3M vs a year ago</div>
        </div>
        <div style={{ display: "flex", gap: 24, marginTop: 34, flex: 1 }}>
          {picks.map((p) => {
            const max = Math.max(...p.spark, 1);
            const up = p.yoy3m >= 0;
            return (
              <div key={p.key} style={{ flex: 1, display: "flex", flexDirection: "column", padding: "24px 24px 18px", borderRadius: 18, border: "1px solid #272d4d", background: "rgba(20,24,48,0.85)" }}>
                <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>{p.tickers.join(" · ")}</div>
                <div style={{ display: "flex", fontSize: 20, color: "#8a90ad", marginTop: 6, height: 28, overflow: "hidden" }}>{(labels[p.key] ?? p.products[0]?.replace(/^HS \d+ /, "") ?? "").slice(0, 34)}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
                  <div style={{ fontSize: 58, fontWeight: 700, color: up ? "#34d399" : "#f87171" }}>{p.yoy3m_txt}</div>
                  {p.flags.length > 0 && <div style={{ fontSize: 30, color: "#fbbf24" }}>*</div>}
                </div>
                <div style={{ display: "flex", fontSize: 18, color: "#8a90ad" }}>{`3 months to ${p.month_en}`}</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, flex: 1, marginTop: 18 }}>
                  {p.spark.map((v, i) => (
                    <div key={i} style={{ flex: 1, height: `${Math.max(2, (v / max) * 100)}%`, borderRadius: 3, background: i >= p.spark.length - 3 ? "#7c86ff" : i >= p.spark.length - 15 && i < p.spark.length - 12 ? "#4b527e" : "#272d4d" }} />
                  ))}
                </div>
                <div style={{ display: "flex", fontSize: 15, color: "#6b7194", marginTop: 8 }}>{`Monthly value, 24 months to ${p.month_en}`}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 18, fontSize: 17, color: "#8a90ad" }}>
          <div>{`Source: ${sources}`}</div>
          <div>{`${picks.some((p) => p.flags.length) ? "* Check before reading: base effect or short history · " : ""}Not investment advice · buywhenitgoesup.vercel.app`}</div>
        </div>
      </div>
    ),
    CHART_SIZE,
  );
  return res.arrayBuffer();
}
