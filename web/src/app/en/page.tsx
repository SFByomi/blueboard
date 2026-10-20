import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { topFlows } from "@/lib/autopost/pick";
import { monthEn, moneyTxt, pctTxt, todayKst } from "@/lib/autopost/types";
import { estimatesEn, GRADE_EN, GROUP_ORDER, groupOf, scorecard, seriesEn, nameOf } from "@/lib/en";
import { companies } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Investing Idea — AI & chip supply chains, tracked with customs data" },
  description: "Customs trade data from the US, Japan and Korea mapped to AI and semiconductor stocks: revenue estimates before earnings, scorecards after, and the biggest supply-chain moves.",
  alternates: { languages: { ko: "/", en: "/en" } },
  openGraph: { locale: "en_US", title: "Investing Idea — AI & chip supply chains", description: "Customs trade data → revenue estimates for AI and chip stocks." },
};

const TIER_EN: Record<string, string> = { 신뢰: "High", 보통: "Medium", 참고: "Low", 추세: "Trend" };
const tone = (v: number | null) => (v == null ? "text-muted" : v >= 0 ? "text-up" : "text-down");
const dateEn = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function EnHome() {
  const [ests, score, moves, cos, ser] = await Promise.all([estimatesEn(), scorecard(), topFlows(6), companies(), seriesEn()]);
  const today = todayKst();
  const soon = ests.filter((e) => e.next && e.next >= today && Date.parse(e.next) - Date.parse(today) <= 45 * 864e5 && (e.tier === "신뢰" || e.tier === "보통"))
    .sort((a, b) => a.next!.localeCompare(b.next!));
  const hits = score.filter((s) => Math.abs(s.err) <= 0.05).length;
  const mape = score.length ? score.reduce((a, s) => a + Math.abs(s.err), 0) / score.length : null;
  const groups = GROUP_ORDER.map((g) => ({ g, cs: cos.filter((c) => groupOf(c) === g) })).filter((x) => x.cs.length);

  return (
    <div className="space-y-6">
      <section className="space-y-3 pt-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">AI &amp; chip supply chains, tracked with customs data</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted sm:text-base">
          Official trade statistics from the US, Japan and Korea show what physically ships — memory from Korean fabs, transceivers from Thailand,
          servers from Mexico. We map each flow to the company that ships it, test it against reported revenue, and use the flows that
          really move with revenue to estimate the current quarter before earnings.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Companies covered" value={String(cos.length)} />
          <Tile label="Data series tracked" value={String(Object.keys(ser).length)} />
          <Tile label="Reported quarters checked" value={String(score.length)} />
          <Tile label="Within ±5% of actual" value={score.length ? `${hits} of ${score.length}` : "—"} sub={mape != null ? `avg error ${(mape * 100).toFixed(1)}%` : undefined} />
        </div>
      </section>

      <Card id="earnings" title="Upcoming earnings — our revenue estimates" sub="Current-quarter revenue from our data model, next 45 days. Consensus shown only as a gap.">
        {soon.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm tnum">
              <thead className="text-xs text-muted"><tr className="border-b border-line text-left">
                <th className="py-1.5 pr-2 font-normal">Company</th><th className="px-2 font-normal">Reports</th><th className="px-2 font-normal">Quarter</th>
                <th className="px-2 text-right font-normal">Our estimate</th><th className="px-2 text-right font-normal">YoY</th><th className="px-2 text-right font-normal">vs consensus</th>
                <th className="px-2 text-right font-normal">Backtest ±5%</th><th className="pl-2 font-normal">Model</th>
              </tr></thead>
              <tbody>{soon.map((e) => (
                <tr key={e.ticker} className="border-b border-line/50 last:border-0">
                  <td className="py-1.5 pr-2"><Link href={`/en/stocks/${encodeURIComponent(e.ticker)}`} className="font-bold hover:text-accent">{e.ticker}</Link> <span className="text-xs text-muted">{e.name}</span></td>
                  <td className="px-2">{dateEn(e.next!)}</td>
                  <td className="px-2 text-muted">{monthEn(e.q_end)}</td>
                  <td className="px-2 text-right font-mono">{moneyTxt(e.est, e.currency)}<div className="text-xs text-muted">{moneyTxt(e.low, e.currency)}–{moneyTxt(e.high, e.currency)}</div></td>
                  <td className={`px-2 text-right font-mono ${tone(e.yoy)}`}>{e.yoy != null ? pctTxt(e.yoy) : "—"}</td>
                  <td className={`px-2 text-right font-mono ${tone(e.cons_gap)}`}>{e.cons_gap != null ? pctTxt(e.cons_gap) : "—"}</td>
                  <td className="px-2 text-right font-mono">{e.hits ?? 0}/{e.bt_n} <span className="text-xs text-muted">{TIER_EN[e.tier ?? ""] ?? ""}</span></td>
                  <td className="pl-2 text-xs text-muted">{e.model.label}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted">No covered company reports in the next 45 days with a medium- or high-confidence estimate.</p>}
        <p className="mt-2 text-xs text-muted">Backtest = quarters where the model, run as of that time, landed within ±5% of reported revenue. &ldquo;Guidance&rdquo; = company guidance adjusted by its historical beat rate.</p>
      </Card>

      <Card id="scorecard" title="Scorecard — estimates locked before each report" sub="Our last estimate before the company reported vs the actual revenue. Hits and misses both stay here.">
        {score.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm tnum">
              <thead className="text-xs text-muted"><tr className="border-b border-line text-left">
                <th className="py-1.5 pr-2 font-normal">Company</th><th className="px-2 font-normal">Quarter</th><th className="px-2 text-right font-normal">Our estimate</th>
                <th className="px-2 text-right font-normal">Actual</th><th className="px-2 text-right font-normal">Error</th><th className="pl-2 font-normal">Model</th>
              </tr></thead>
              <tbody>{score.slice(0, 20).map((s) => (
                <tr key={`${s.ticker}${s.q_end}`} className="border-b border-line/50 last:border-0">
                  <td className="py-1.5 pr-2"><Link href={`/en/stocks/${encodeURIComponent(s.ticker)}`} className="font-bold hover:text-accent">{s.ticker}</Link></td>
                  <td className="px-2 text-muted">{monthEn(s.q_end)}</td>
                  <td className="px-2 text-right font-mono">{moneyTxt(s.est, s.currency)}</td>
                  <td className="px-2 text-right font-mono">{moneyTxt(s.actual, s.currency)}</td>
                  <td className={`px-2 text-right font-mono ${Math.abs(s.err) <= 0.05 ? "text-up" : "text-amber-300"}`}>{pctTxt(s.err)}</td>
                  <td className="pl-2 text-xs text-muted">{s.kind}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted">The scorecard fills in as covered companies report.</p>}
      </Card>

      <Card title="Biggest supply-chain moves" sub="Company-specific flows with the largest change: last 3 months vs the same 3 months a year earlier.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {moves.map((p) => (
            <div key={p.key} className="rounded-xl bg-panel2 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold">{p.tickers.map((t, i) => <Link key={t} href={`/en/stocks/${encodeURIComponent(t)}`} className="hover:text-accent">{i ? " · " : ""}{t}</Link>)}</span>
                <span className={`font-mono text-lg font-bold ${tone(p.yoy3m)}`}>{p.yoy3m_txt}{p.flags.some((f) => f.code === "extreme" || f.code === "short") ? <span className="text-amber-300">*</span> : null}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted">{p.series.map((id) => nameOf(ser[id], id)).join(" + ")}</div>
              <div className="mt-1 text-xs text-muted">to {p.month_en} · {p.sources.join(", ")} · revenue link {p.grade ?? "—"}{p.grade ? ` (${GRADE_EN[p.grade]})` : ""}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted"><span className="text-amber-300">*</span> Check before reading: a small base a year ago or a short history against revenue.</p>
      </Card>

      <section id="coverage" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-bold">Coverage</h2>
        {groups.map(({ g, cs }) => (
          <div key={g}>
            <h3 className="mb-2 text-sm font-bold text-muted">{g}</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {cs.map((c) => (
                <Link key={c.ticker} href={`/en/stocks/${encodeURIComponent(c.ticker)}`} className="card block !p-3 hover:border-accent">
                  <div className="font-bold">{c.ticker} <span className="text-sm font-normal text-muted">{c.name}</span></div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{(c as typeof c & { thesis_en?: string | null }).thesis_en ?? ""}</p>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <Card title="How it works">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
          <li>Find where each company makes its products (filings, contract manufacturers) and the customs flows that carry them — by country, HS code, US state, Japanese customs office or Korean county.</li>
          <li>Test every flow against quarterly revenue: year-over-year correlation with a 0–2 quarter lead. Grades: A ≥0.7 direct link, B ≥0.5 linked, C ≥0.3 industry context, D weak.</li>
          <li>Estimate the current quarter only from A/B flows, pick the model with the smallest backtest error, and publish the range. Low-confidence cases are shown as such or not at all.</li>
        </ol>
        <p className="mt-2 text-xs text-muted">Data updates daily as sources publish (trade data is monthly). As of {dateEn(today)} (KST).</p>
      </Card>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card !p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-mono text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
