import { StackChart } from "@/components/ComputeCharts";
import { T } from "@/components/Names";
import type { Obs } from "@/lib/queries";

export const POWER_IDS = ["us_const_datacenter", "us_const_electric", "us_const_chipfab", "us_imp_all_panel_lv", "us_imp_all_panel_hv",
  "us_imp_cn_panel", "kr_exp_tr10", "kr_exp_tr10_us", "kr_exp_tr10_my", "us_plan_gas", "us_plan_gas_uc", "us_plan_battery", "us_elec_va_com", "us_elec_us_com"];

const r1 = (v: number | null) => (v == null ? null : +v.toFixed(1));
const yoy = (a: (number | null)[], i = a.length - 1) => (a[i] != null && a[i - 12] ? a[i]! / a[i - 12]! - 1 : null);
const fmtPct = (v: number | null) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

/** 전력 인프라: 미국 건설투자 · 미국 배전반 수입(중국 비중) · 한국 대용량 변압기 수출(국가별) */
export function PowerSection({ obs }: { obs: Obs[] }) {
  if (!obs.length) return null;
  const by = (id: string, from = "2021-01") => {
    const m = new Map(obs.filter((o) => o.series_id === id && o.month >= from).map((o) => [o.month, o]));
    return m;
  };
  const range = (maps: Map<string, Obs>[]) => [...new Set(maps.flatMap((m) => [...m.keys()]))].sort();

  // 1) 건설투자 (연율, $B)
  const dc = by("us_const_datacenter", "2020-01"), el = by("us_const_electric", "2020-01"), fab = by("us_const_chipfab", "2020-01");
  const cm = range([dc, el, fab]);
  const B = (m: Map<string, Obs>) => cm.map((k) => r1((m.get(k)?.value_usd ?? NaN) / 1e9) ?? null).map((v) => (Number.isNaN(v) ? null : v));
  const dcv = B(dc), elv = B(el), fabv = B(fab);

  // 2) 배전·제어반 수입 ($B) + 중국산 비중(%)
  const lv = by("us_imp_all_panel_lv"), hv = by("us_imp_all_panel_hv"), cn = by("us_imp_cn_panel");
  const pm = range([lv, hv]);
  const lvv = pm.map((k) => lv.get(k)?.value_usd ?? null), hvv = pm.map((k) => hv.get(k)?.value_usd ?? null);
  const tot = pm.map((_, i) => (lvv[i] ?? 0) + (hvv[i] ?? 0));
  const cnShare = pm.map((k, i) => (tot[i] ? r1(((cn.get(k)?.value_usd ?? 0) / tot[i]) * 100) : null));

  // 3) 한국 대용량 변압기 수출 ($M): 미국·말레이시아·기타 + 단가(USD/kg)
  const tt = by("kr_exp_tr10"), us = by("kr_exp_tr10_us"), my = by("kr_exp_tr10_my");
  const km = range([tt]);
  const M = (m: Map<string, Obs>) => km.map((k) => m.get(k)?.value_usd ?? 0);
  const ttv = M(tt), usv = M(us), myv = M(my);
  const other = km.map((_, i) => Math.max(0, ttv[i] - usv[i] - myv[i]));
  const unit = km.map((k) => { const o = tt.get(k); return o?.qty ? r1(o.value_usd! / o.qty) : null; });
  const last = km.length - 1;

  // 4) 발전 건설 계획 (GW) — EIA 860M 계획 목록 합계
  const pg = by("us_plan_gas"), pu = by("us_plan_gas_uc"), pb = by("us_plan_battery");
  const gm = range([pg]);
  const G = (m: Map<string, Obs>) => gm.map((k) => { const v = m.get(k)?.value_usd; return v == null ? null : +(v / 1000).toFixed(1); });
  const gasv = G(pg), gucv = G(pu), batv = G(pb);

  // 5) 상업용 전력 판매 전년비(3개월 합) — 버지니아(데이터센터 밀집) vs 미국
  const va = by("us_elec_va_com", "2020-01"), usc = by("us_elec_us_com", "2020-01");
  const em = range([va, usc]);
  const yoy3 = (m: Map<string, Obs>) => em.map((_, i) => {
    if (i < 14) return null;
    const cur = [0, 1, 2].reduce((a, j) => a + (m.get(em[i - j])?.value_usd ?? NaN), 0);
    const prev = [12, 13, 14].reduce((a, j) => a + (m.get(em[i - j])?.value_usd ?? NaN), 0);
    return Number.isFinite(cur / prev) ? +((cur / prev - 1) * 100).toFixed(1) : null;
  });
  const vay = yoy3(va), usy = yoy3(usc);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold"><T ko="전력 인프라" en="Power infrastructure" /> <span className="text-sm font-normal text-muted">데이터센터 → 전력 설비 수요</span></h2>
        <span className="text-xs text-muted">미국 Census 건설투자·수입통계 · 한국 관세청</span>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card min-w-0">
          <h3 className="font-bold">미국 건설투자 <span className="text-xs font-normal text-muted">계절조정 연율 · 최근 {cm.at(-1)}</span></h3>
          <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
            <span>데이터센터 <b>${dcv.at(-1)}B</b> <span className="text-xs text-muted">전년비 {fmtPct(yoy(dcv))}</span></span>
            <span>반도체·전자 공장 <b>${fabv.at(-1)}B</b> <span className="text-xs text-muted">전년비 {fmtPct(yoy(fabv))}</span></span>
            <span>전력 <b>${elv.at(-1)}B</b> <span className="text-xs text-muted">전년비 {fmtPct(yoy(elv))}</span></span>
          </div>
          <StackChart months={cm} left="$B" bars={[]} lines={[
            { name: "데이터센터", color: "#22d3ee", values: dcv }, { name: "반도체·전자 공장", color: "#a78bfa", values: fabv }, { name: "전력(발전·송배전)", color: "#f59e0b", values: elv },
          ]} />
        </div>
        <div className="card min-w-0">
          <h3 className="font-bold">미국 배전·제어반 수입 <span className="text-xs font-normal text-muted">HS 8537.10·8537.20 · 최근 {pm.at(-1)}</span></h3>
          <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
            <span>합계 <b>${((tot.at(-1) ?? 0) / 1e9).toFixed(2)}B</b> <span className="text-xs text-muted">전년비 {fmtPct(yoy(tot))}</span></span>
            <span>중국산 비중 <b>{cnShare.at(-1)}%</b> <span className="text-xs text-muted">1년 전 {cnShare.at(-13) ?? "-"}%</span></span>
          </div>
          <StackChart months={pm} left="$B" right="중국 %" bars={[
            { name: "1kV 이하", color: "#3b5bdb", values: lvv.map((v) => (v == null ? null : +(v / 1e9).toFixed(3))) },
            { name: "1kV 초과", color: "#748ffc", values: hvv.map((v) => (v == null ? null : +(v / 1e9).toFixed(3))) },
          ]} lines={[{ name: "중국산 비중", color: "#f87171", values: cnShare }]} />
        </div>
      </div>
      {(gm.length > 0 || em.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {gm.length > 0 && (
            <div className="card min-w-0">
              <h3 className="font-bold">미국 발전소 건설 계획 <span className="text-xs font-normal text-muted">EIA 860M 계획 목록 합계 · 최근 {gm.at(-1)}</span></h3>
              <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
                <span>가스발전 <b>{gasv.at(-1)}GW</b> <span className="text-xs text-muted">1년 전 {gasv.at(-13) ?? "-"}GW</span></span>
                <span>그중 착공 <b>{gucv.at(-1)}GW</b></span>
                <span>배터리 <b>{batv.at(-1)}GW</b></span>
              </div>
              <StackChart months={gm} left="GW" bars={[]} lines={[
                { name: "가스발전 계획", color: "#f59e0b", values: gasv }, { name: "가스 착공·완공 대기", color: "#f87171", values: gucv }, { name: "배터리 계획", color: "#22d3ee", values: batv },
              ]} />
              <p className="mt-1 text-xs text-muted">데이터센터 전력 부족을 가스발전으로 메우는 흐름 — 발전소 연계 변압기·차단기·가스터빈 수요의 선행 지표.</p>
            </div>
          )}
          {em.length > 0 && (
            <div className="card min-w-0">
              <h3 className="font-bold">상업용 전력 판매 전년비 <span className="text-xs font-normal text-muted">3개월 합 · EIA · 최근 {em.at(-1)}</span></h3>
              <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
                <span>버지니아 <b>{fmtPct(vay.at(-1) == null ? null : vay.at(-1)! / 100)}</b></span>
                <span>미국 전체 <b>{fmtPct(usy.at(-1) == null ? null : usy.at(-1)! / 100)}</b></span>
              </div>
              <StackChart months={em} left="%" bars={[]} lines={[
                { name: "버지니아(데이터센터 밀집)", color: "#22d3ee", values: vay }, { name: "미국 전체", color: "#8a90ad", values: usy },
              ]} />
              <p className="mt-1 text-xs text-muted">버지니아 북부는 세계 최대 데이터센터 밀집지 — 상업용 판매가 미국 평균보다 빠르게 늘면 데이터센터 가동 전력이 늘고 있다는 뜻.</p>
            </div>
          )}
        </div>
      )}
      <div className="card min-w-0">
        <h3 className="font-bold">한국 대용량 변압기 수출 <span className="text-xs font-normal text-muted">10MVA 초과 액체절연 (HS 8504.23) · 최근 {km.at(-1)}</span></h3>
        <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
          <span>합계 <b>${(ttv[last] / 1e6).toFixed(1)}M</b> <span className="text-xs text-muted">전년비 {fmtPct(yoy(ttv))}</span></span>
          <span>미국 <b>{((usv[last] / ttv[last]) * 100).toFixed(1)}%</b></span>
          <span>말레이시아 <b>{((myv[last] / ttv[last]) * 100).toFixed(1)}%</b> <span className="text-xs text-muted">${(myv[last] / 1e6).toFixed(1)}M · 전월 ${(myv[last - 1] / 1e6).toFixed(1)}M</span></span>
          <span>단가 <b>${unit[last]}/kg</b></span>
        </div>
        <StackChart months={km} left="$M" right="USD/kg" height={320} bars={[
          { name: "미국", color: "#3b5bdb", values: usv.map((v) => +(v / 1e6).toFixed(1)) },
          { name: "말레이시아", color: "#22d3ee", values: myv.map((v) => +(v / 1e6).toFixed(1)) },
          { name: "기타", color: "#5c6280", values: other.map((v) => +(v / 1e6).toFixed(1)) },
        ]} lines={[{ name: "단가(USD/kg)", color: "#f87171", values: unit }]} />
        <p className="mt-2 text-xs leading-relaxed text-muted">
          HD현대일렉트릭·효성중공업·LS ELECTRIC·일진전기 등 국내 변압기 업체 합산(회사별 구분 불가). 대형 변압기는 건당 금액이 커서 월별로 크게 출렁이니 3개월 합으로 보세요.
        </p>
      </div>
    </section>
  );
}
