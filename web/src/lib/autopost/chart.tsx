import { ImageResponse } from "next/og";
import type { EarnChart } from "./earnings";
import type { FlowPick } from "./pick";
import type { PriceChart } from "./prices";
import { type Candidate, moneyTxt, pctTxt } from "./types";

// 자동 게시 차트 — opengraph-image.tsx와 같은 ImageResponse 방식. 기본 폰트에 한글이 없어 영문만.
export const CHART_SIZE = { width: 1200, height: 675 }; // X 권장 16:9
const C = { bg: "linear-gradient(135deg, #0b0e1c 0%, #141830 60%, #1d2350 100%)", fg: "#e6e8f2", muted: "#8a90ad", dim: "#6b7194", line: "#272d4d", panel: "rgba(20,24,48,0.85)", accent: "#7c86ff", mid: "#4b527e", up: "#34d399", down: "#f87171", warn: "#fbbf24" };

export async function renderChart(c: Candidate, labels: Record<string, string>): Promise<ArrayBuffer> {
  const body = c.kind === "trade" ? <Trade picks={c.data as FlowPick[]} labels={labels} />
    : c.kind === "prices" ? <Prices d={c.data as PriceChart} />
    : <Earnings d={c.data as EarnChart} result={c.kind === "result"} />;
  const heading = c.kind === "trade" ? "Biggest supply-chain moves · 3M vs a year ago"
    : c.kind === "prices" ? "Weekly GPU rental prices" : c.kind === "result" ? "Earnings scorecard · our estimate vs actual" : "Earnings preview · our data-driven model";
  const res = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "44px 52px", background: C.bg, color: C.fg }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 22, color: C.muted, letterSpacing: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 6, background: C.accent }} />
            INVESTING IDEA
          </div>
          <div style={{ fontSize: 22, color: C.muted }}>{heading}</div>
        </div>
        <div style={{ display: "flex", gap: 24, marginTop: 30, flex: 1 }}>{body}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 18, fontSize: 17, color: C.muted }}>
          <div>{`Source: ${c.sources.join(" · ")}`}</div>
          <div>{`${c.flags.length ? "* Check before reading: see post · " : ""}Not investment advice`}</div>
        </div>
      </div>
    ),
    CHART_SIZE,
  );
  return res.arrayBuffer();
}

function Bars({ values, hi, mid, color = C.accent }: { values: number[]; hi: (i: number) => boolean; mid?: (i: number) => boolean; color?: string }) {
  const max = Math.max(...values, 1e-9);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, flex: 1 }}>
      {values.map((v, i) => (
        <div key={i} style={{ flex: 1, height: `${Math.max(2, (v / max) * 100)}%`, borderRadius: 3, background: hi(i) ? color : mid?.(i) ? C.mid : C.line }} />
      ))}
    </div>
  );
}

function Trade({ picks, labels }: { picks: FlowPick[]; labels: Record<string, string> }) {
  return (
    <div style={{ flex: 1, display: "flex", gap: 24 }}>
      {picks.map((p) => (
        <div key={p.key} style={{ flex: 1, display: "flex", flexDirection: "column", padding: "24px 24px 18px", borderRadius: 18, border: `1px solid ${C.line}`, background: C.panel }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>{p.tickers.join(" · ")}</div>
          <div style={{ display: "flex", fontSize: 20, color: C.muted, marginTop: 6, height: 28, overflow: "hidden" }}>{(labels[p.key] || p.names_en?.[0] || p.products[0]?.replace(/^HS \d+ /, "") || "").slice(0, 34)}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
            <div style={{ fontSize: 58, fontWeight: 700, color: p.yoy3m >= 0 ? C.up : C.down }}>{p.yoy3m_txt}</div>
            {p.flags.length > 0 && <div style={{ fontSize: 30, color: C.warn }}>*</div>}
          </div>
          <div style={{ display: "flex", fontSize: 18, color: C.muted }}>{`3 months to ${p.month_en}`}</div>
          <div style={{ display: "flex", flex: 1, marginTop: 18 }}>
            <Bars values={p.spark} hi={(i) => i >= p.spark.length - 3} mid={(i) => i >= p.spark.length - 15 && i < p.spark.length - 12} />
          </div>
          <div style={{ display: "flex", fontSize: 15, color: C.dim, marginTop: 8 }}>{`Monthly value, 24 months to ${p.month_en}`}</div>
        </div>
      ))}
    </div>
  );
}

function Earnings({ d, result }: { d: EarnChart; result: boolean }) {
  // 프리뷰: 과거 분기 실제 + 진행 분기 추정(범위). 결과: 마지막 분기 실제 막대 위에 발표 전 추정 표시
  const qs = result ? d.quarters : [...d.quarters, { q: "est", label: `${d.qLabel.slice(0, 3)} '${d.qLabel.slice(-2)}`, value: d.est }];
  const max = Math.max(...qs.map((q) => q.value), d.high) * 1.05;
  const err = d.actual ? d.est / d.actual - 1 : null;
  return (
    <div style={{ flex: 1, display: "flex", gap: 36 }}>
      <div style={{ width: 330, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>{`$${d.ticker}`}</div>
        <div style={{ display: "flex", fontSize: 22, color: C.muted }}>{`${d.name} · quarter ending ${d.qLabel}`}</div>
        <div style={{ display: "flex", fontSize: 20, color: C.muted, marginTop: 18 }}>{result ? "Our estimate before report" : "Our revenue estimate"}</div>
        <div style={{ display: "flex", fontSize: 54, fontWeight: 700, color: C.accent }}>{moneyTxt(d.est, d.currency)}</div>
        <div style={{ display: "flex", fontSize: 20, color: C.muted }}>{`range ${moneyTxt(d.low, d.currency)}–${moneyTxt(d.high, d.currency)}`}</div>
        {result && d.actual != null && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
            <div style={{ display: "flex", fontSize: 20, color: C.muted }}>Actual</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
              <div style={{ fontSize: 46, fontWeight: 700 }}>{moneyTxt(d.actual, d.currency)}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: Math.abs(err!) <= 0.05 ? C.up : C.warn }}>{`error ${pctTxt(err!)}`}</div>
            </div>
          </div>
        )}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 14, position: "relative" }}>
          {qs.map((q, i) => {
            const last = i === qs.length - 1;
            return (
              <div key={q.q} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", position: "relative" }}>
                <div style={{ width: "100%", height: `${(q.value / max) * 100}%`, borderRadius: 4, background: last ? (result ? C.mid : C.accent) : C.line, border: last && !result ? `2px dashed ${C.fg}` : "none" }} />
                {last && (
                  <div style={{ position: "absolute", left: "50%", width: 4, marginLeft: -2, bottom: `${(d.low / max) * 100}%`, height: `${((d.high - d.low) / max) * 100}%`, background: C.fg }} />
                )}
                {last && result && <div style={{ position: "absolute", left: 0, right: 0, height: 4, bottom: `${(d.est / max) * 100}%`, background: C.accent }} />}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
          {qs.map((q, i) => <div key={q.q} style={{ flex: 1, display: "flex", justifyContent: "center", fontSize: 15, color: i === qs.length - 1 ? C.fg : C.dim }}>{q.q === "est" ? `${q.label} est` : q.label}</div>)}
        </div>
        <div style={{ display: "flex", fontSize: 15, color: C.dim, marginTop: 6 }}>{result ? "Quarterly revenue · bar = actual, line = our estimate, whisker = our range" : "Quarterly revenue · dashed = our estimate, whisker = range"}</div>
      </div>
    </div>
  );
}

function Prices({ d }: { d: PriceChart }) {
  return (
    <div style={{ flex: 1, display: "flex", gap: 24 }}>
      {d.rows.map((r) => {
        const ch = r.avgPrev ? r.avg / r.avgPrev - 1 : null;
        return (
          <div key={r.gpu} style={{ flex: 1, display: "flex", flexDirection: "column", padding: "24px 22px 18px", borderRadius: 18, border: `1px solid ${C.line}`, background: C.panel }}>
            <div style={{ display: "flex", fontSize: 32, fontWeight: 700 }}>{r.gpu}</div>
            <div style={{ display: "flex", fontSize: 18, color: C.muted, marginTop: 4 }}>Nebius, avg across regions</div>
            <div style={{ display: "flex", fontSize: 50, fontWeight: 700, marginTop: 10 }}>{`$${r.avg.toFixed(2)}`}</div>
            <div style={{ display: "flex", fontSize: 18, color: C.muted }}>{`per GPU-hour · low $${r.min.toFixed(2)}`}</div>
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700, marginTop: 6, color: ch == null ? C.muted : ch >= 0 ? C.up : C.down }}>{ch == null ? "—" : `${pctTxt(ch)} w/w`}</div>
            <div style={{ display: "flex", flex: 1, marginTop: 14 }}>
              <Bars values={r.spark} hi={(i) => i === r.spark.length - 1} />
            </div>
            <div style={{ display: "flex", fontSize: 15, color: C.dim, marginTop: 8 }}>{`Daily avg, 30 days to ${d.day}`}</div>
          </div>
        );
      })}
    </div>
  );
}
