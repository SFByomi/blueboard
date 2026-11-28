import type { Metadata } from "next";
import Link from "next/link";
import { T } from "@/components/Names";
import { NhpCharts, type NhpMonth, type NhpQuarter } from "@/components/NhpCharts";
import { SectionNav } from "@/components/SectionNav";
import { Card, PageHead, Stat } from "@/components/ui";
import { companies, financials, flowScores, observations, type Obs } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "바이오 — 실험용 원숭이 공급", description: "신약 독성시험의 병목인 실험용 원숭이(NHP)의 미국 수입 마릿수·마리당 단가·원산지와 찰스리버 매출 비교" };

const IDS = { all: "us_imp_all_nhp", kh: "us_imp_kh_nhp", mu: "us_imp_mu_nhp", vn: "us_imp_vn_nhp" } as const;
// 공급이 바뀐 시점 (출처: 미 법무부 2022-11-16 기소 발표, 찰스리버 2023-02 공시 — 수치는 아래 세관 통계)
const EVENTS = [{ q: "2023-Q1", label: "캄보디아산 중단" }];
const quarterOf = (m: string) => `${m.slice(0, 4)}-Q${Math.ceil(+m.slice(5, 7) / 3)}`;
const num = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`;
const usdK = (v: number) => `$${(v / 1000).toFixed(1)}K`;

type Row = { m: string; v: number; n: number };
const rowsOf = (obs: Obs[], id: string): Row[] => obs.filter((o) => o.series_id === id).map((o) => ({ m: o.month, v: o.value_usd ?? 0, n: o.qty ?? 0 }));
const sum = (rows: Row[], k: "v" | "n") => rows.reduce((a, r) => a + r[k], 0);

export default async function BioPage() {
  const [obs, fin, scores, cos] = await Promise.all([observations(Object.values(IDS)), financials("CRL"), flowScores("CRL"), companies()]);
  const all = rowsOf(obs, IDS.all), by = { kh: rowsOf(obs, IDS.kh), mu: rowsOf(obs, IDS.mu), vn: rowsOf(obs, IDS.vn) };
  const bio = cos.filter((c) => c.grp === "바이오");
  const nav = [{ id: "nhp", label: "실험용 원숭이" }, { id: "why", label: "읽는 법" }, { id: "names", label: "바이오 종목" }];

  if (all.length < 24) {
    return (
      <div className="space-y-5">
        <PageHead title={<T ko="바이오" en="Bio" />} sub="실험용 원숭이(NHP) 공급 — 신약 독성시험의 병목" />
        <div className="card text-sm text-muted">수집 전입니다. 다음 데이터 갱신 뒤에 표시됩니다.</div>
      </div>
    );
  }

  // 분기 합계 (달력 분기) — 원산지별 마릿수·금액, 찰스리버 매출은 분기 말일 기준으로 같은 분기에
  const revByQ = new Map(fin.map((f) => [quarterOf(new Date(Date.parse(f.period_end) - 15 * 864e5).toISOString().slice(0, 7)), f.revenue]));
  const qKeys = [...new Set(all.map((r) => quarterOf(r.m)))];
  const cnt = (rows: Row[], q: string) => sum(rows.filter((r) => quarterOf(r.m) === q), "n");
  const quarters: NhpQuarter[] = qKeys.map((q) => {
    const a = all.filter((r) => quarterOf(r.m) === q);
    const kh = cnt(by.kh, q), mu = cnt(by.mu, q), vn = cnt(by.vn, q);
    return { q, partial: a.length < 3, kh, mu, vn, other: Math.max(0, sum(a, "n") - kh - mu - vn), value: sum(a, "v"), rev: revByQ.get(q) ?? null };
  });

  // 마리당 단가: 3개월 금액 합 ÷ 마릿수 합 (그 석 달에 30마리 미만이면 비움 — 소량 신고는 단가가 튐)
  const months = all.map((r) => r.m);
  const roll = (rows: Row[], m: string) => {
    const i = months.indexOf(m), set = new Set(months.slice(Math.max(0, i - 2), i + 1));
    const w = rows.filter((r) => set.has(r.m));
    return i < 2 || sum(w, "n") < 30 ? null : sum(w, "v") / sum(w, "n");
  };
  const asia = [...by.kh, ...by.vn];
  const unit: NhpMonth[] = months.map((m) => ({ m, all: roll(all, m), mu: roll(by.mu, m), asia: roll(asia, m) }));

  // 요약 숫자
  const last12 = all.slice(-12), prev12 = all.slice(-24, -12);
  const n12 = sum(last12, "n"), nPrev = sum(prev12, "n");
  const y2022 = sum(all.filter((r) => r.m.startsWith("2022")), "n");
  const uNow = unit.at(-1)!.all, uYear = unit.at(-13)?.all ?? null;
  const u2020 = sum(all.filter((r) => r.m.startsWith("2020")), "v") / Math.max(1, sum(all.filter((r) => r.m.startsWith("2020")), "n"));
  const set12 = new Set(last12.map((r) => r.m));
  const share = (rows: Row[]) => (sum(rows.filter((r) => set12.has(r.m)), "n") / Math.max(1, n12)) * 100;
  const origins = ([["모리셔스", share(by.mu)], ["베트남", share(by.vn)], ["캄보디아", share(by.kh)]] as [string, number][]).sort((a, b) => b[1] - a[1]);
  const lastM = months.at(-1)!;
  const uChg = uNow && uYear ? (uNow / uYear - 1) * 100 : null;
  const nChg = nPrev ? (n12 / nPrev - 1) * 100 : null;
  // 한 줄 결론 — 고정 규칙: 단가 1년 전 대비 ±10%, 물량 ±15%를 넘어야 '상승/감소'로 읽음
  const priceWord = uChg == null ? "비교 불가" : uChg > 10 ? "오르는 중" : uChg < -10 ? "내리는 중" : "제자리";
  const volWord = nChg == null ? "비교 불가" : nChg > 15 ? "늘어나는 중" : nChg < -15 ? "줄어드는 중" : "비슷";
  const tight = (uChg ?? 0) > 10 && (nChg ?? 0) <= 15;
  const verdict = tight ? "단가가 오르는데 물량은 못 따라옴 — 공급이 빠듯해지는 모습" : (uChg ?? 0) > 10 ? "단가와 물량이 함께 늘어남 — 수요가 늘고 공급도 따라오는 모습" : "새로운 부족 신호는 아직 세관 숫자에 없음";
  const score = scores.find((s) => s.series_id === IDS.all);
  const r = (v: number | null | undefined) => (v == null ? "-" : v.toFixed(2));

  return (
    <div className="space-y-5">
      <PageHead title={<T ko="바이오" en="Bio" />} sub="실험용 원숭이(NHP) 공급 — 신약 독성시험의 병목이 숫자로 어떻게 움직이나"
        info={<p>신약은 사람에게 투여하기 전에 동물 독성시험을 거쳐야 하고, 항체·유전자 치료제처럼 사람과 비슷한 동물에서만 약효가 나타나는 약은 원숭이(주로 긴꼬리원숭이)로 시험합니다. 미국은 실험용 원숭이를 거의 전부 수입하므로, 세관 통계의 &lsquo;살아 있는 영장류&rsquo;(HS 0106.11) 수입 마릿수와 신고 금액으로 공급 상황을 볼 수 있습니다. 통계는 약 두 달 늦게 나옵니다. 투자 권유가 아닙니다.</p>} />
      <SectionNav items={nav} />

      <Card id="nhp" title="실험용 원숭이 미국 수입" sub={`${lastM.replace("-", "년 ")}월까지 · 미국 세관 통계(살아 있는 영장류, HS 0106.11)`}
        info={<p>마릿수 = 세관에 신고된 수입 마릿수(전 원산지). 마리당 단가 = 신고 금액 ÷ 마릿수로, 실제 계약 가격과 다를 수 있고 운송·검역 비용은 빠져 있습니다. 긴꼬리원숭이 외 다른 영장류도 소량 섞여 있습니다. 전세기 단위로 들어와 달마다 크게 출렁이므로 분기·12개월 합으로 봅니다.</p>}>
        <div className="mb-3 rounded-lg bg-panel2 p-3 text-sm">
          <b>{verdict}</b>
          <span className="text-muted"> — 마리당 단가는 1년 전과 {priceWord}{uChg != null && ` (${pct(uChg)})`}, 최근 12개월 물량은 그 전 12개월과 {volWord}{nChg != null && ` (${pct(nChg)})`}</span>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="최근 12개월 수입" value={`${num(n12)}마리`} sub={nChg == null ? "" : `그 전 12개월 대비 ${pct(nChg)}`} />
          <Stat label="2022년과 비교" value={y2022 ? `${((n12 / y2022) * 100).toFixed(0)}%` : "-"} sub={`2022년 ${num(y2022)}마리 (캄보디아산 중단 전)`} />
          <Stat label="마리당 신고 단가" value={uNow ? usdK(uNow) : "-"} sub={`최근 3개월 · 2020년 ${usdK(u2020)}`} />
          <Stat label="원산지 (최근 12개월)" value={`${origins[0][0]} ${origins[0][1].toFixed(0)}%`} sub={origins.slice(1).map(([k, v]) => `${k} ${v.toFixed(0)}%`).join(" · ")} />
        </div>
        <NhpCharts quarters={quarters} months={unit} events={EVENTS.filter((e) => qKeys.includes(e.q))} />
      </Card>

      <Card id="why" title="어떻게 읽나">
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li><b>공급이 두 번 끊겼습니다.</b> 중국이 2020년 초 수출을 멈췄고, 2022년 11월 미국 법무부가 캄보디아산 야생 원숭이 밀수를 기소한 뒤 2023년부터 캄보디아산이 사실상 끊겼습니다. 미국 수입은 2022년 {num(y2022)}마리에서 2023년 {num(sum(all.filter((x) => x.m.startsWith("2023")), "n"))}마리로 줄었고, 마리당 신고 단가는 2020년 {usdK(u2020)}에서 2022년 {usdK(sum(all.filter((x) => x.m.startsWith("2022")), "v") / Math.max(1, y2022))}로 올랐습니다.</li>
          <li><b>지금 볼 것은 단가와 물량의 방향입니다.</b> 신약 연구가 늘어 원숭이가 다시 부족해지면 단가가 먼저 오르고 물량은 못 따라옵니다. 위 한 줄 결론은 이 두 숫자만으로 정한 고정 규칙입니다(단가 ±10%, 물량 ±15%).</li>
          <li><b>찰스리버 매출과의 관계는 참고용입니다.</b> {score ? <>미국 전체 원숭이 수입 금액과 찰스리버 매출의 전년비 상관은 같은 분기 {r(score.yoy0)}, 수입이 2분기 앞설 때 {r(score.yoy2)}(표본 {score.n_yoy}분기)입니다. 수입 → 검역 → 시험 착수 순서와는 맞지만 표본이 짧아 우연일 수 있습니다.</> : <>상관 점수는 다음 데이터 갱신 뒤 표시됩니다.</>} 회사 매출에는 원숭이와 무관한 사업도 섞여 있습니다. <Link href="/stocks/CRL" className="text-accent">찰스리버 종목 화면 →</Link></li>
          <li><b>이 숫자가 못 보는 것</b>: 수주잔고(회사 공시), 미국 안에서 번식한 물량, 원숭이를 쓰지 않는 대체 시험법으로의 전환, 그리고 미국 밖(중국·유럽) 시험 물량.</li>
        </ul>
      </Card>

      <Card id="names" title="사이트의 바이오 종목" sub="무역 흐름으로 볼 수 있는 것과 없는 것">
        <ul className="divide-y divide-line text-sm">
          {bio.map((c) => (
            <li key={c.ticker} className="py-2.5">
              <Link href={`/stocks/${c.ticker}`} className="font-bold hover:text-accent">{c.name_ko ?? c.name} <span className="font-mono text-xs font-normal text-muted">{c.ticker}</span></Link>
              <span className="ml-2 text-xs text-muted">{c.sector}</span>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{(c.thesis ?? "").split(". ")[0].split(" — ").slice(0, 2).join(" — ").slice(0, 110)}</p>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-xs leading-relaxed text-muted">출처: U.S. Census Bureau(USA Trade), SEC EDGAR. 세관 통계는 업계 전체 수입이라 특정 회사 물량이 아니며, 신고 단가는 실제 거래 가격과 다를 수 있습니다. 투자 권유가 아닙니다.</p>
    </div>
  );
}
