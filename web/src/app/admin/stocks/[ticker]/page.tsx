import Link from "next/link";
import { notFound } from "next/navigation";
import { CONFIDENCES, ROLES } from "@/lib/format";
import { allSeries, company, mappingsFor } from "@/lib/queries";
import { deleteCompany, deleteMapping, saveCompany, saveMapping } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditStock({ params }: PageProps<"/admin/stocks/[ticker]">) {
  const ticker = decodeURIComponent((await params).ticker);
  const c = company(ticker);
  if (!c) notFound();
  const maps = mappingsFor(ticker);
  const series = allSeries();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{c.name_ko ?? c.name} <span className="text-muted">{c.ticker}</span></h1>
        <div className="flex gap-2"><Link href="/admin" className="btn-ghost">← 관리</Link><Link href={`/stocks/${encodeURIComponent(ticker)}`} className="btn-ghost">종목 페이지</Link></div>
      </div>

      <form action={saveCompany} className="card grid gap-2 md:grid-cols-4">
        <h2 className="font-bold md:col-span-4">종목 정보</h2>
        <input type="hidden" name="ticker" value={c.ticker} />
        <Field name="name" label="영문명" v={c.name} /><Field name="name_ko" label="한글명" v={c.name_ko} />
        <Field name="market" label="시장" v={c.market} /><Field name="sector" label="섹터" v={c.sector} />
        <Field name="sec_ticker" label="SEC 티커" v={c.sec_ticker} /><Field name="fy_note" label="회계연도" v={c.fy_note} />
        <Field name="sort" label="정렬" v={String(c.sort)} />
        <Field name="dart_fs" label="DART 재무 (한국: CFS 연결 / OFS 별도)" v={c.dart_fs} />
        <Field name="dart_segment" label="사업부문 매출 (XBRL 키워드, 예: Component, Component:Separate)" v={c.dart_segment} />
        <label className="text-xs text-muted md:col-span-4">투자 포인트·매핑 메모<textarea name="thesis" defaultValue={c.thesis ?? ""} rows={3} className="input mt-1" /></label>
        <button className="btn md:col-span-4">저장</button>
      </form>

      <section className="card space-y-4">
        <h2 className="font-bold">연결된 무역 흐름 ({maps.length})</h2>
        {maps.map((m) => (
          <div key={m.id} className="rounded-xl bg-panel2 p-3">
            <form action={saveMapping} className="grid gap-2 md:grid-cols-6">
              <input type="hidden" name="ticker" value={ticker} /><input type="hidden" name="series_id" value={m.series_id} /><input type="hidden" name="mapping_id" value={m.id} />
              <div className="md:col-span-6 text-sm"><b>{m.label}</b> <span className="font-mono text-xs text-muted">{m.series_id} · 최신 {m.last_month ?? "미수집"}</span></div>
              <Select name="role" label="역할" options={ROLES} v={m.role} />
              <Select name="confidence" label="신뢰도" options={CONFIDENCES} v={m.confidence} />
              <Field name="sort" label="순서" v={String(m.sort)} />
              <label className="flex items-end gap-2 pb-2 text-xs text-muted"><input type="checkbox" name="include_in_total" defaultChecked={!!m.include_in_total} /> 매출 합산에 포함</label>
              <label className="text-xs text-muted md:col-span-3">근거<textarea name="rationale" defaultValue={m.rationale ?? ""} rows={2} className="input mt-1" /></label>
              <label className="text-xs text-muted md:col-span-3">주의사항<textarea name="caveat" defaultValue={m.caveat ?? ""} rows={2} className="input mt-1" /></label>
              <button className="btn md:col-span-5">저장</button>
              <button formAction={deleteMapping} className="rounded-lg border border-red-900 px-3 py-2 text-sm text-red-400 hover:bg-red-950">연결 해제</button>
            </form>
          </div>
        ))}

        <form action={saveMapping} className="grid gap-2 rounded-xl border border-dashed border-line p-3 md:grid-cols-6">
          <div className="text-sm font-bold md:col-span-6">+ 흐름 연결</div>
          <input type="hidden" name="ticker" value={ticker} />
          <label className="text-xs text-muted md:col-span-3">시리즈
            <select name="series_id" required className="input mt-1">
              {series.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.id})</option>)}
            </select>
          </label>
          <Select name="role" label="역할" options={ROLES} v="회사출하" />
          <Select name="confidence" label="신뢰도" options={CONFIDENCES} v="중간" />
          <label className="flex items-end gap-2 pb-2 text-xs text-muted"><input type="checkbox" name="include_in_total" /> 매출 합산</label>
          <label className="text-xs text-muted md:col-span-3">근거<textarea name="rationale" rows={2} className="input mt-1" /></label>
          <label className="text-xs text-muted md:col-span-3">주의사항<textarea name="caveat" rows={2} className="input mt-1" /></label>
          <button className="btn md:col-span-6">연결</button>
          <p className="text-xs text-muted md:col-span-6">원하는 시리즈가 없으면 관리 첫 화면에서 시리즈를 먼저 추가하세요.</p>
        </form>
      </section>

      <form action={deleteCompany} className="text-right">
        <input type="hidden" name="ticker" value={ticker} />
        <button className="text-xs text-red-400 hover:underline">종목 삭제</button>
      </form>
    </div>
  );
}

function Field({ name, label, v }: { name: string; label: string; v: string | null }) {
  return <label className="text-xs text-muted">{label}<input name={name} defaultValue={v ?? ""} className="input mt-1" /></label>;
}
function Select({ name, label, options, v }: { name: string; label: string; options: string[]; v: string }) {
  return (
    <label className="text-xs text-muted">{label}
      <select name={name} defaultValue={v} className="input mt-1">{options.map((o) => <option key={o}>{o}</option>)}</select>
    </label>
  );
}
