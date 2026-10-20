import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { FlowChart, RevenueChart } from "@/components/en/Charts";
import { monthEn, moneyTxt, pctTxt } from "@/lib/autopost/types";
import { estimatesEn, GRADE_EN, groupOf, scorecard, stockEn } from "@/lib/en";
import { financials } from "@/lib/queries";
import { stockSignals } from "@/lib/signals";

export const dynamic = "force-dynamic";

const TIER_EN: Record<string, string> = { 신뢰: "High confidence", 보통: "Medium confidence", 참고: "Low confidence", 추세: "Trend only" };
const tone = (v: number | null) => (v == null ? "text-muted" : v >= 0 ? "text-up" : "text-down");
const dateEn = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const qLab = (d: string) => `${monthEn(d).slice(0, 3)} '${d.slice(2, 4)}`;

export async function generateMetadata({ params }: PageProps<"/en/stocks/[ticker]">) {
  const s = await stockEn(decodeURIComponent((await params).ticker));
  return s ? {
    title: { absolute: `${s.co.ticker} ${s.co.name} — supply-chain data & revenue estimate · Investing Idea` },
    description: `Customs trade flows, revenue link grades and our current-quarter revenue estimate for ${s.co.name}.`,
    alternates: { languages: { ko: `/stocks/${encodeURIComponent(s.co.ticker)}`, en: `/en/stocks/${encodeURIComponent(s.co.ticker)}` } },
  } : {};
}

export default async function EnStock({ params }: PageProps<"/en/stocks/[ticker]">) {
  const ticker = decodeURIComponent((await params).ticker);
  const s = await stockEn(ticker);
  if (!s) notFound();
  const [ests, fins, sigs, score] = await Promise.all([estimatesEn(), financials(ticker), stockSignals(), scorecard(ticker)]);
  const e = ests.find((x) => x.ticker === ticker);
  const sig = sigs.find((x) => x.c.ticker === ticker);
  const quarters = fins.filter((f) => !e || f.period_end < e.q_end).slice(-12).map((f) => ({ label: qLab(f.period_end), value: f.revenue }));
  const cur = e?.currency ?? fins.at(-1)?.currency ?? "USD";
  const mainIds = sig?.ids ?? [];
  const months = sig?.month ? Array.from({ length: sig.sparkAt.length }, (_, i) => {
    const d = new Date(Date.UTC(Number(sig.month!.slice(0, 4)), Number(sig.month!.slice(5, 7)) - 1 - (sig.sparkAt.length - 1 - i), 1));
    return qLab(d.toISOString().slice(0, 10));
  }) : [];
  const co = s.co as typeof s.co & { thesis_en?: string | null };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/en#coverage" className="text-xs text-muted hover:text-accent">← Coverage</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{co.ticker} <span className="font-normal text-muted">{co.name}</span></h1>
        <div className="mt-0.5 text-xs text-muted">{groupOf(co)}{co.market ? ` · ${co.market}` : ""} · <Link href={`/stocks/${encodeURIComponent(co.ticker)}`} className="hover:text-accent">한국어 페이지</Link></div>
        {co.thesis_en && <p className="mt-2 max-w-3xl text-sm leading-relaxed">{co.thesis_en}</p>}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Current-quarter revenue estimate" sub={e ? `Quarter ending ${monthEn(e.q_end)} · ${e.next ? `reports ${dateEn(e.next)}` : "report date not set"}` : undefined}>
          {e ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div><div className="text-xs text-muted">Our estimate</div><div className="font-mono text-2xl font-bold text-accent">{moneyTxt(e.est, cur)}</div><div className="text-xs text-muted">{moneyTxt(e.low, cur)}–{moneyTxt(e.high, cur)}</div></div>
                <div><div className="text-xs text-muted">vs a year ago</div><div className={`font-mono text-2xl font-bold ${tone(e.yoy)}`}>{e.yoy != null ? pctTxt(e.yoy) : "—"}</div></div>
                <div><div className="text-xs text-muted">vs consensus</div><div className={`font-mono text-2xl font-bold ${tone(e.cons_gap)}`}>{e.cons_gap != null ? pctTxt(e.cons_gap) : "—"}</div></div>
              </div>
              <p className="text-xs leading-relaxed text-muted">
                {TIER_EN[e.tier ?? ""] ?? "Estimate"} · within ±5% in {e.hits ?? 0} of {e.bt_n} backtested quarters{e.mape != null ? `, average error ${(e.mape * 100).toFixed(1)}%` : ""}.
                {" "}Model: {e.model.guide ? `${e.model.kind} cross-checked with company guidance` : e.model.kind === "Guidance-based" ? "company guidance adjusted by its historical beat rate" : e.model.kind}{e.model.sources.length ? ` (${e.model.sources.join(", ")})` : ""}.
              </p>
              <RevenueChart quarters={quarters} est={{ label: qLab(e.q_end), value: e.est, low: e.low, high: e.high }} currency={cur} />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted">No current-quarter estimate — no data flow moves closely enough with this company&apos;s revenue.</p>
              {quarters.length > 0 && <RevenueChart quarters={quarters} est={null} currency={cur} />}
            </div>
          )}
        </Card>

        <Card title={sig && !sig.proxy ? "Key supply-chain flow" : "Industry flow"} sub={sig?.month ? `${mainIds.map((id) => s.flows.find((f) => f.id === id)?.name ?? id).join(" + ")} · to ${monthEn(sig.month)}` : undefined}>
          {sig?.yoy3m != null ? (
            <div className="space-y-2">
              <div className="flex items-baseline gap-3">
                <span className={`font-mono text-2xl font-bold ${tone(sig.yoy3m)}`}>{pctTxt(sig.yoy3m)}</span>
                <span className="text-xs text-muted">last 3 months vs a year earlier{Math.abs(sig.yoy3m) > 2 ? " · small base a year ago, read with care" : ""}</span>
              </div>
              <FlowChart months={months} values={sig.sparkAt} />
              {sig.proxy && <p className="text-xs text-muted">No company-specific flow — this is an industry-wide flow for context.</p>}
            </div>
          ) : <p className="text-sm text-muted">No monthly flow with enough history.</p>}
        </Card>
      </div>

      <Card title="Mapped data flows" sub="How each flow moves with quarterly revenue (year-over-year correlation, flow leading by 0–2 quarters).">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-line text-left">
              <th className="py-1.5 pr-2 font-normal">Flow</th><th className="px-2 font-normal">Stage</th><th className="px-2 font-normal">Revenue link</th>
              <th className="px-2 text-right font-normal">Correlation</th><th className="pl-2 text-right font-normal">Data to</th>
            </tr></thead>
            <tbody>{s.flows.map((f) => (
              <tr key={f.id} className="border-b border-line/50 last:border-0">
                <td className="max-w-[320px] py-1.5 pr-2"><div className="truncate">{f.name}</div><div className="text-xs text-muted">{f.source}</div></td>
                <td className="px-2 text-xs text-muted">{f.role}</td>
                <td className="whitespace-nowrap px-2"><span className="font-mono font-bold">{f.grade ?? "—"}</span> <span className="text-xs text-muted">{f.grade ? GRADE_EN[f.grade] : "too little history"}</span></td>
                <td className="px-2 text-right font-mono">{f.corr != null ? f.corr.toFixed(2) : "—"}<span className="text-xs text-muted">{f.lag ? ` · leads ${f.lag}Q` : ""}</span></td>
                <td className="pl-2 text-right text-xs text-muted">{f.month ? monthEn(f.month) : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">A ≥0.7 direct link · B ≥0.5 linked · C ≥0.3 industry context · D weak. Fewer than 8 comparable quarters caps the grade at C.</p>
      </Card>

      {score.length > 0 && (
        <Card title="Scorecard" sub="Our last estimate before each report vs actual revenue.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm tnum">
              <thead className="text-xs text-muted"><tr className="border-b border-line text-left">
                <th className="py-1.5 pr-2 font-normal">Quarter</th><th className="px-2 text-right font-normal">Our estimate</th><th className="px-2 text-right font-normal">Actual</th><th className="pl-2 text-right font-normal">Error</th>
              </tr></thead>
              <tbody>{score.map((x) => (
                <tr key={x.q_end} className="border-b border-line/50 last:border-0">
                  <td className="py-1.5 pr-2">{monthEn(x.q_end)}</td>
                  <td className="px-2 text-right font-mono">{moneyTxt(x.est, x.currency)}</td>
                  <td className="px-2 text-right font-mono">{moneyTxt(x.actual, x.currency)}</td>
                  <td className={`pl-2 text-right font-mono ${Math.abs(x.err) <= 0.05 ? "text-up" : "text-amber-300"}`}>{pctTxt(x.err)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
