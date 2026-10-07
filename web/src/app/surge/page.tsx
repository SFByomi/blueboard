import Link from "next/link";
import { CtyName, HsName, T } from "@/components/Names";
import { Spark } from "@/components/Spark";
import { baseEffect, pct, tone, usd } from "@/lib/format";
import { ADMIN_ENABLED } from "@/lib/db";
import { meta, surge, tagIndex } from "@/lib/queries";

export const dynamic = "force-dynamic";

const SCOPES = {
  us_imp_world: "🇺🇸 미국 수입 (품목 전체)",
  us_exp_world: "🇺🇸 미국 수출 (품목 전체)",
  us_imp_cty: "🇺🇸 미국 수입 · 관심 품목 × 국가",
} as const;
const SORTS = { yoy3m: "3개월 YoY", mom: "MoM", yoy: "YoY", z: "이상치(z)" } as const;

export default async function Surge({ searchParams }: PageProps<"/surge">) {
  const sp = await searchParams;
  const scope = (sp.scope as keyof typeof SCOPES) in SCOPES ? (sp.scope as keyof typeof SCOPES) : "us_imp_world";
  const sort = (sp.sort as keyof typeof SORTS) in SORTS ? (sp.sort as keyof typeof SORTS) : "yoy3m";
  const [rows, related, builtAt] = await Promise.all([surge(scope, sort, 40), tagIndex(), meta("built_at")]);
  const q = (p: Record<string, string>) => `/surge?${new URLSearchParams({ scope, sort, ...p })}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">🚀 <T ko="급등 탐색" en="Surge scanner" /></h1>
          <p className="mt-1 text-sm text-muted">
            기준월 {rows[0]?.month ?? "-"} · 월 2천만 달러 이상(국가별 5백만 달러) 품목 · 마지막 갱신 {builtAt?.replace("T", " ") ?? "-"}
          </p>
          <p className="text-xs text-muted">* 200% 넘는 증가율은 전년 같은 기간 금액이 작아 생긴 기저효과일 수 있음 — 금액도 함께 보세요. 3M YoY는 전년 3개월 금액이 충분할 때만 계산.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(SCOPES).map(([k, v]) => (
          <Link key={k} href={q({ scope: k })} className={`rounded-lg px-3 py-1.5 text-sm ${k === scope ? "bg-accent text-white" : "bg-panel text-muted hover:text-fg"}`}>{v}</Link>
        ))}
        <span className="mx-2 border-l border-line" />
        {Object.entries(SORTS).map(([k, v]) => (
          <Link key={k} href={q({ sort: k })} className={`rounded-lg px-3 py-1.5 text-sm ${k === sort ? "bg-panel2 text-fg ring-1 ring-accent" : "bg-panel text-muted hover:text-fg"}`}>{v}</Link>
        ))}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-3 text-left">#</th>
              <th className="px-2 py-3 text-left"><T ko="품목" en="Item" /></th>
              <th className="px-2 py-3 text-right"><T ko="월 금액" en="Monthly value" /></th>
              <th className="px-2 py-3"><T ko="24개월" en="24 months" /></th>
              <th className="px-2 py-3 text-right">MoM</th>
              <th className="px-2 py-3 text-right">YoY</th>
              <th className="px-2 py-3 text-right">3M YoY</th>
              <th className="px-4 py-3 text-left"><T ko="관련 종목" en="Related stocks" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const tickers = related(r.hs6);
              return (
                <tr key={`${r.hs6}-${r.partner}`} className="border-b border-line/60 hover:bg-panel2">
                  <td className="px-4 py-3 text-muted">{i + 1}</td>
                  <td className="px-2 py-3">
                    <div className="font-medium"><HsName ko={r.name_ko} en={r.name_en} hs={r.hs6} />{r.partner !== "-" && <span className="text-muted"> · <CtyName name={r.partner_name} /></span>}</div>
                    <div className="font-mono text-xs text-muted">{r.hs6}</div>
                  </td>
                  <td className="px-2 py-3 text-right font-mono">{usd(r.value_usd)}</td>
                  <td className="px-2 py-3"><Spark values={JSON.parse(r.spark)} /></td>
                  <td className={`px-2 py-3 text-right font-mono ${tone(r.mom)}`}>{pct(r.mom)}</td>
                  <td className={`px-2 py-3 text-right font-mono ${tone(r.yoy)}`} title={baseEffect(r.yoy)}>{pct(r.yoy)}{baseEffect(r.yoy) && <sup>*</sup>}</td>
                  <td className="px-2 py-3 text-right">
                    <span className={`rounded-md px-2 py-1 font-mono font-medium ${r.yoy3m != null && r.yoy3m >= 0 ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"}`} title={baseEffect(r.yoy3m)}>{pct(r.yoy3m)}{baseEffect(r.yoy3m) && <sup>*</sup>}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {tickers.map((t) => (
                        <Link key={t} href={`/stocks/${encodeURIComponent(t)}`} className="rounded bg-accent/20 px-2 py-0.5 text-xs text-accent hover:bg-accent/30">{t}</Link>
                      ))}
                      {!tickers.length && ADMIN_ENABLED && <Link href={`/admin/tags?hs=${r.hs6}`} className="text-xs text-muted hover:text-fg">+ 종목 연결</Link>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">데이터가 없습니다. 루트에서 ETL을 실행하세요: .venv/bin/python -m etl.build (윈도우: .venv/Scripts/python)</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
