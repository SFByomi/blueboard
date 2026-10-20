import Link from "next/link";
import { LastUpdated } from "@/components/LastUpdated";
import { CtyName, HsName, T } from "@/components/Names";
import { Spark } from "@/components/Spark";
import { baseEffect, pct, tone, usd } from "@/lib/format";
import { ADMIN_ENABLED } from "@/lib/db";
import { krShare, meta, surge, tagIndex, TECH_CHAPTERS, type KrShare, type SurgeRow } from "@/lib/queries";
import { PageHead } from "@/components/ui";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "무역 탐색", description: "미국 수출입 전 품목(HS6)에서 급등·급감 품목, 국가별 흐름, 미국 수입 중 한국산 비중" };

const SCOPES = {
  us_imp_world: "미국 수입",
  us_exp_world: "미국 수출",
  us_imp_cty: "관심 품목 × 국가",
  kr_share: "미국 수입 중 한국산 비중",
} as const;
const SORTS = { yoy3m: "3개월 YoY", mom: "MoM", yoy: "YoY", z: "이상치(z)" } as const;
const KR_SORTS = { change: "비중 상승폭", share: "현재 비중" } as const;
const FILTERS = { all: "전 품목", tech: "관심 분야" } as const;
const pp = (v: number | null) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%p`);

export default async function Surge({ searchParams }: PageProps<"/surge">) {
  const sp = await searchParams;
  const scope = (sp.scope as keyof typeof SCOPES) in SCOPES ? (sp.scope as keyof typeof SCOPES) : "us_imp_world";
  const kr = scope === "kr_share";
  const sorts: Record<string, string> = kr ? KR_SORTS : SORTS;
  const sort = (sp.sort as string) in sorts ? (sp.sort as string) : kr ? "change" : "yoy3m";
  const f = (sp.f as keyof typeof FILTERS) in FILTERS ? (sp.f as keyof typeof FILTERS) : "all";
  const chapters = f === "tech" ? TECH_CHAPTERS : undefined;
  const [rows, shares, related, builtAt] = await Promise.all([
    kr ? Promise.resolve([] as SurgeRow[]) : surge(scope, sort as keyof typeof SORTS, 40, chapters),
    kr ? krShare(sort as keyof typeof KR_SORTS, 40, chapters) : Promise.resolve([] as KrShare[]),
    tagIndex(), meta("built_at"),
  ]);
  const q = (p: Record<string, string>) => `/surge?${new URLSearchParams({ scope, sort, f, ...p })}`;

  return (
    <div className="space-y-5">
      <PageHead title={<T ko="무역 탐색" en="Trade scanner" />}
        sub={<>미국 무역 통계 전 품목(HS6)에서 급등·급감 찾기 · 기준월 {(kr ? shares[0]?.month : rows[0]?.month) ?? "-"}</>}
        right={<Link href="/plants" className="text-xs text-muted hover:text-accent">공장 지도 →</Link>}
        info={<>
          <p>{kr ? "비중 = 최근 3개월 미국 수입 중 한국산 금액 비율 · 변화 = 1년 전 같은 3개월 대비(%p) · 한국산 월평균 5백만 달러·미국 전체 2천만 달러 이상 품목. 그래프는 24개월 3개월 이동 비중." : "월 2천만 달러 이상(국가별 5백만 달러) 품목. 200% 넘는 증가율은 전년 같은 기간 금액이 작아 생긴 기저효과일 수 있어 *로 표시 — 금액도 함께 보세요. 3M YoY는 전년 3개월 금액이 충분할 때만."}</p>
          <p>관심 분야 = 화학·의약·구리·기계·전자·광학(HS 28·29·30·38·74·84·85·90장). 관련 종목 = 그 품목에 연결해 둔 추적 종목.</p>
          <p><LastUpdated builtAt={builtAt} /></p>
        </>} />

      <div className="space-y-2">
        <div className="flex gap-1.5 overflow-x-auto text-sm [scrollbar-width:none]">
          {Object.entries(SCOPES).map(([k, v]) => (
            <Link key={k} href={q({ scope: k, sort: k === "kr_share" ? "change" : "yoy3m" })} className={`shrink-0 rounded-full px-3 py-1 ${k === scope ? "bg-accent/20 font-bold text-accent" : "bg-panel2 text-muted hover:text-fg"}`}>{v}</Link>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto text-xs [scrollbar-width:none]">
          <span className="shrink-0 self-center text-muted">정렬</span>
          {Object.entries(sorts).map(([k, v]) => (
            <Link key={k} href={q({ sort: k })} className={`shrink-0 rounded-full px-2.5 py-1 ${k === sort ? "bg-panel2 text-fg ring-1 ring-accent" : "bg-panel text-muted hover:text-fg"}`}>{v}</Link>
          ))}
          {scope !== "us_imp_cty" && <span className="ml-2 shrink-0 self-center text-muted">범위</span>}
          {scope !== "us_imp_cty" && Object.entries(FILTERS).map(([k, v]) => (
            <Link key={k} href={q({ f: k })} className={`shrink-0 rounded-full px-2.5 py-1 ${k === f ? "bg-panel2 text-fg ring-1 ring-accent" : "bg-panel text-muted hover:text-fg"}`}>{v}</Link>
          ))}
        </div>
      </div>

      {kr ? <KrTable rows={shares} related={related} /> : (
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="hidden px-4 py-3 text-left sm:table-cell">#</th>
              <th className="px-3 py-3 text-left sm:px-2"><T ko="품목" en="Item" /></th>
              <th className="px-2 py-3 text-right"><T ko="월 금액" en="Monthly value" /></th>
              <th className="hidden px-2 py-3 md:table-cell"><T ko="24개월" en="24 months" /></th>
              <th className="hidden px-2 py-3 text-right sm:table-cell">MoM</th>
              <th className="hidden px-2 py-3 text-right sm:table-cell">YoY</th>
              <th className="px-3 py-3 text-right sm:px-2">3M YoY</th>
              <th className="hidden px-4 py-3 text-left lg:table-cell"><T ko="관련 종목" en="Related stocks" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const tickers = related(r.hs6);
              return (
                <tr key={`${r.hs6}-${r.partner}`} className="border-b border-line/60 hover:bg-panel2">
                  <td className="hidden px-4 py-3 text-muted sm:table-cell">{i + 1}</td>
                  <td className="px-3 py-3 sm:px-2">
                    <div className="font-medium"><HsName ko={r.name_ko} en={r.name_en} hs={r.hs6} />{r.partner !== "-" && <span className="text-muted"> · <CtyName name={r.partner_name} /></span>}</div>
                    <div className="flex flex-wrap items-center gap-1 font-mono text-xs text-muted">{r.hs6}
                      {tickers.map((t) => <Link key={t} href={`/stocks/${encodeURIComponent(t)}`} className="rounded bg-accent/20 px-1.5 font-sans text-accent lg:hidden">{t}</Link>)}</div>
                  </td>
                  <td className="px-2 py-3 text-right font-mono">{usd(r.value_usd)}</td>
                  <td className="hidden px-2 py-3 md:table-cell"><Spark values={JSON.parse(r.spark)} /></td>
                  <td className={`hidden px-2 py-3 text-right font-mono sm:table-cell ${tone(r.mom)}`}>{pct(r.mom)}</td>
                  <td className={`hidden px-2 py-3 text-right font-mono sm:table-cell ${tone(r.yoy)}`} title={baseEffect(r.yoy)}>{pct(r.yoy)}{baseEffect(r.yoy) && <sup>*</sup>}</td>
                  <td className="px-3 py-3 text-right sm:px-2">
                    <span className={`rounded-md px-2 py-1 font-mono font-medium ${r.yoy3m != null && r.yoy3m >= 0 ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"}`} title={baseEffect(r.yoy3m)}>{pct(r.yoy3m)}{baseEffect(r.yoy3m) && <sup>*</sup>}</span>
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
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
      )}
    </div>
  );
}

function KrTable({ rows, related }: { rows: KrShare[]; related: (hs6: string) => string[] }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line">
            <th className="hidden px-4 py-3 text-left sm:table-cell">#</th>
            <th className="px-3 py-3 text-left sm:px-2"><T ko="품목" en="Item" /></th>
            <th className="hidden px-2 py-3 text-right sm:table-cell"><T ko="한국산 월평균" en="From Korea / mo" /></th>
            <th className="hidden px-2 py-3 md:table-cell"><T ko="비중 24개월" en="Share, 24 months" /></th>
            <th className="px-2 py-3 text-right"><T ko="1년 전" en="Year ago" /></th>
            <th className="px-2 py-3 text-right"><T ko="현재 비중" en="Share" /></th>
            <th className="px-3 py-3 text-right sm:px-2"><T ko="변화" en="Change" /></th>
            <th className="hidden px-4 py-3 text-left lg:table-cell"><T ko="관련 종목" en="Related stocks" /></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.hs6} className="border-b border-line/60 hover:bg-panel2">
              <td className="hidden px-4 py-3 text-muted sm:table-cell">{i + 1}</td>
              <td className="px-3 py-3 sm:px-2">
                <div className="font-medium"><HsName ko={r.name_ko} en={r.name_en} hs={r.hs6} /></div>
                <div className="font-mono text-xs text-muted">{r.hs6} · 한국산 {usd(r.kr_usd)} / 전체 {usd(r.world_usd)}</div>
              </td>
              <td className="hidden px-2 py-3 text-right font-mono sm:table-cell">{usd(r.kr_usd)}</td>
              <td className="hidden px-2 py-3 md:table-cell"><Spark values={(JSON.parse(r.spark) as (number | null)[]).map((v) => v ?? 0)} /></td>
              <td className="px-2 py-3 text-right font-mono text-muted">{r.share_ago == null ? "-" : `${(r.share_ago * 100).toFixed(1)}%`}</td>
              <td className="px-2 py-3 text-right font-mono font-bold">{(r.share * 100).toFixed(1)}%</td>
              <td className={`px-3 py-3 text-right font-mono sm:px-2 ${tone(r.change)}`}>{pp(r.change)}</td>
              <td className="hidden px-4 py-3 lg:table-cell">
                <div className="flex flex-wrap gap-1">
                  {related(r.hs6).map((t) => (
                    <Link key={t} href={`/stocks/${encodeURIComponent(t)}`} className="rounded bg-accent/20 px-2 py-0.5 text-xs text-accent hover:bg-accent/30">{t}</Link>
                  ))}
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">아직 집계 전입니다 (다음 데이터 갱신 후 표시).</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
