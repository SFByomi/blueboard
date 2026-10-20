import { Stat } from "@/components/ui";
import { cov, lev, pdFmt, pdTone, risk, RISK_STYLE, x } from "@/lib/credit";
import { money } from "@/lib/format";
import type { CreditRow, MarketCredit } from "@/lib/queries";

/** 종목 화면용 신용 요약 — 신용 탭과 같은 판정 규칙 (lib/credit) */
export function CreditMini({ rows, mkt }: { rows: CreditRow[]; mkt: MarketCredit | null }) {
  const r = rows.at(-1);
  if (!r) return <p className="text-sm text-muted">재무 신용 지표가 없습니다 (공시 형식상 수집하지 못함).</p>;
  const [lvl, why] = risk(r), l = lev(r), c = cov(r);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${RISK_STYLE[lvl]}`}>{lvl}</span>
        <span className="text-muted">{why.length ? why.join(" · ") : "빚 부담·현금흐름 모두 무난"}</span>
        <span className="text-xs text-muted">· {r.q_end.slice(0, 7)} 장부</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="순부채/EBITDA" value={(r.net_debt ?? 0) <= 0 ? "순현금" : x(l)} sub={`순부채 ${money(r.net_debt, r.currency)}`} />
        <Stat label="이자보상" value={x(c)} sub="영업이익 ÷ 이자 (4분기)" />
        <Stat label="FCF (4분기)" value={money(r.fcf_ttm, r.currency)} tone={r.fcf_ttm == null ? "" : r.fcf_ttm >= 0 ? "text-up" : "text-down"} sub={`현금 ${money(r.cash, r.currency)}`} />
        <Stat label="주가 내재 5년 부도" value={<span className={pdTone(mkt?.pd5)}>{pdFmt(mkt?.pd5)}</span>} sub={mkt ? `${mkt.date} · 머튼 모형` : "부채가 거의 없거나 계산 불가"} />
      </div>
    </div>
  );
}
