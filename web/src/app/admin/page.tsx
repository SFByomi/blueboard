import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { PROJECT_ROOT } from "@/lib/db";
import { allAlerts, allMappings, allSeries, companies, meta } from "@/lib/queries";
import { runEtl, saveCompany, saveSeries } from "./actions";

export const dynamic = "force-dynamic";

const SPEC_EXAMPLE = `{"dataset": "imports/hs", "hs": "8542320036", "filters": {"CTY_CODE": "5830"}}`;

export default function Admin() {
  const cos = companies();
  const maps = allMappings();
  const series = allSeries();
  const alerts = allAlerts();
  const logPath = path.join(PROJECT_ROOT, "data", "etl.log");
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf-8").split("\n").slice(-12).join("\n") : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">관리</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/admin/tags" className="btn-ghost">품목 → 종목 태그</Link>
        </div>
      </div>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">데이터 갱신</h2>
            <p className="text-xs text-muted">마지막 빌드 {meta("built_at")?.replace("T", " ") ?? "-"} · 시계열·매출·급등 탐지 (급등 포함 시 첫 실행 5~10분)</p>
          </div>
          <form action={runEtl} className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1 text-muted"><input type="checkbox" name="skip_surge" /> 급등 탐지 생략</label>
            <button className="btn">지금 갱신</button>
          </form>
        </div>
        {log && <pre className="max-h-48 overflow-auto rounded-lg bg-bg p-3 text-xs text-muted">{log}</pre>}
      </section>

      {alerts.length > 0 && (
        <section className="card">
          <h2 className="font-bold">⚠ 통계 단절 자동 경고 ({alerts.length})</h2>
          <p className="mb-3 text-xs text-muted">단가 계단식 변화(수량은 유지) · 금액 수준 변화 · 연속 결측. 실제 업황 변화일 수도 있으니 확인 후 매핑 주의사항에 반영하세요.</p>
          <table className="w-full text-xs">
            <tbody>
              {alerts.map((a) => (
                <tr key={a.series_id + a.month + a.kind} className="border-b border-line/50">
                  <td className="py-1.5 font-mono">{a.month}</td><td>{a.label}</td><td className="text-amber-300">{a.detail}</td>
                  <td className="text-muted">{maps.filter((m) => m.series_id === a.series_id).map((m) => m.ticker).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2 className="mb-3 font-bold">종목 ({cos.length})</h2>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {cos.map((c) => (
            <Link key={c.ticker} href={`/admin/stocks/${encodeURIComponent(c.ticker)}`} className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-2 text-sm hover:ring-1 hover:ring-accent">
              <span><b>{c.ticker}</b> <span className="text-muted">{c.name_ko ?? c.name}</span></span>
              <span className="text-xs text-muted">흐름 {maps.filter((m) => m.ticker === c.ticker).length}</span>
            </Link>
          ))}
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-accent">+ 종목 추가</summary>
          <form action={saveCompany} className="mt-3 grid gap-2 md:grid-cols-3">
            <input name="ticker" required placeholder="티커 (예: NVDA, 000660.KS)" className="input" />
            <input name="name" placeholder="영문명" className="input" />
            <input name="name_ko" placeholder="한글명" className="input" />
            <input name="market" placeholder="시장 (NASDAQ/KOSPI)" className="input" />
            <input name="sector" placeholder="섹터" className="input" />
            <input name="sec_ticker" placeholder="SEC 티커 (미국 상장사만, 매출 자동 수집)" className="input" />
            <input name="dart_fs" placeholder="DART 재무: CFS/OFS (한국 상장사, 티커 000000.KS)" className="input" />
            <input name="fy_note" placeholder="회계연도 메모" className="input" />
            <input name="sort" placeholder="정렬 순서 (숫자)" className="input" />
            <textarea name="thesis" placeholder="투자 포인트·매핑 메모" className="input md:col-span-3" rows={2} />
            <button className="btn md:col-span-3">저장</button>
          </form>
        </details>
      </section>

      <section className="card">
        <h2 className="mb-3 font-bold">무역 시리즈 ({series.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted"><tr className="border-b border-line text-left">
              <th className="py-2">ID</th><th>설명</th><th>출처</th><th>HS</th><th>상대국</th><th>최신월</th><th>사용 종목</th>
            </tr></thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.id} className="border-b border-line/50">
                  <td className="py-2 font-mono">{s.id}</td><td>{s.label}</td><td>{s.source}</td>
                  <td className="font-mono">{s.hs}</td><td>{s.partner}</td><td className="font-mono">{s.last_month ?? <span className="text-amber-400">미수집</span>}</td>
                  <td>{maps.filter((m) => m.series_id === s.id).map((m) => m.ticker).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-accent">+ 시리즈 추가 (저장 후 &apos;지금 갱신&apos;을 눌러 수집)</summary>
          <form action={saveSeries} className="mt-3 grid gap-2 md:grid-cols-4">
            <input name="id" required placeholder="ID (영문, 예: us_imp_tw_dram)" className="input" />
            <input name="label" required placeholder="설명" className="input md:col-span-2" />
            <select name="source" className="input"><option value="census">census (미국)</option><option value="estat">estat (일본)</option><option value="kcs">kcs (한국)</option></select>
            <input name="reporter" placeholder="보고국 (🇺🇸 미국)" className="input" />
            <input name="flow" placeholder="수출/수입" className="input" />
            <input name="region" placeholder="지역/세관" className="input" />
            <input name="hs" placeholder="HS 표시용" className="input" />
            <input name="partner" placeholder="상대국 표시용" className="input" />
            <textarea name="spec" required rows={3} className="input font-mono md:col-span-3" placeholder={SPEC_EXAMPLE} />
            <div className="text-xs leading-relaxed text-muted md:col-span-4">
              census: {`{"dataset": "imports/hs" | "exports/hs" | "exports/statehs", "hs": "HS10 또는 HS6" | [목록 합산], "filters": {"CTY_CODE": "5830", "DISTRICT": "28", "STATE": "CA"}}`} · 국가코드 대만 5830, 일본 5880, 한국 5800, 중국 5700, 말레이시아 5570, 태국 5490, 멕시코 2010, 전체 &quot;-&quot;<br />
              estat: {`{"flow": "export", "hs9": ["854232100"], "offices": ["関西空港", "成田"], "country": "50113"}`} · 세관 関西空港·成田·大阪·呉·中部空港·福岡空港 · 상대국 대만 50106, 중국 50105, 말레이시아 50113, 미국 50304<br />
              kcs: {`{"api": "sigungu", "hs": "853224", "flow": "export", "sido": "41", "sgg": "경기도 수원시"}`} (시군구, HS6) · {`{"api": "item", "hs": "8542321010"}`} (전국 품목) · {`{"api": "item_cty", "hs": "741021", "cnty": "TW"}`} (품목×국가) · 시도코드 서울 11, 부산 26, 인천 28, 경기 41, 충북 43, 충남 44, 경북 47, 경남 48
            </div>
            <button className="btn md:col-span-4">저장</button>
          </form>
        </details>
      </section>
    </div>
  );
}
