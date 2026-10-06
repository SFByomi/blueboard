import { ImageResponse } from "next/og";

// 링크 미리보기(카톡·텔레그램·X) 썸네일. 기본 폰트에 한글 글리프가 없어 영문만 쓴다.
export const alt = "Investing Idea — Supply Chain Intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BARS = [38, 46, 41, 55, 52, 63, 60, 72, 69, 84, 92, 100];
const STAGES = ["Components", "Production", "Shipments", "Demand", "Pricing"];

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", padding: "64px 72px", background: "linear-gradient(135deg, #0b0e1c 0%, #141830 60%, #1d2350 100%)", color: "#e6e8f2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, color: "#8a90ad", letterSpacing: 4 }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: "#7c86ff" }} />
          INVESTING IDEA
        </div>
        <div style={{ position: "absolute", top: 72, right: 72, display: "flex", alignItems: "flex-end", gap: 8, height: 200 }}>
          {BARS.map((h, i) => (
            <div key={i} style={{ width: 16, height: `${h}%`, borderRadius: 4, background: i === BARS.length - 1 ? "#7c86ff" : "#272d4d" }} />
          ))}
        </div>
        <div style={{ display: "flex" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 92, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>Supply Chain</div>
            <div style={{ fontSize: 92, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, color: "#7c86ff" }}>Intelligence</div>
            <div style={{ marginTop: 24, fontSize: 30, color: "#8a90ad" }}>Customs flows & price indices across the AI hardware stack</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 22, color: "#8a90ad" }}>
          {STAGES.map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", padding: "8px 16px", borderRadius: 10, border: "1px solid #272d4d", background: "#141830" }}>{s}</div>
              {i < STAGES.length - 1 && <div style={{ color: "#7c86ff" }}>→</div>}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
