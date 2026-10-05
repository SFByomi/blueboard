import Link from "next/link";
import { companies, hsNames, hsTags } from "@/lib/queries";
import { deleteTag, saveTag } from "../actions";

export const dynamic = "force-dynamic";

export default async function Tags({ searchParams }: PageProps<"/admin/tags">) {
  const hs = String((await searchParams).hs ?? "");
  const [tags, cos, hn] = await Promise.all([hsTags(), companies(), hsNames()]);
  const names = new Map(hn.map((r) => [r.hs, r.n]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">품목 → 종목 태그</h1>
          <p className="text-sm text-muted">급등 탐색에서 HS 코드 앞자리가 일치하면 해당 종목이 표시됩니다 (예: 8542 → 반도체 전체, 854232 → 메모리).</p>
        </div>
        <Link href="/admin" className="btn-ghost">← 관리</Link>
      </div>

      <form action={saveTag} className="card grid gap-2 md:grid-cols-4">
        <input name="hs_prefix" required defaultValue={hs} placeholder="HS 앞자리 (2~6자리)" className="input font-mono" />
        <select name="ticker" required className="input">{cos.map((c) => <option key={c.ticker} value={c.ticker}>{c.ticker} {c.name_ko ?? c.name}</option>)}</select>
        <input name="note" placeholder="메모 (품목명)" defaultValue={hs ? names.get(hs) ?? "" : ""} className="input" />
        <button className="btn">추가</button>
        {hs && <p className="text-xs text-muted md:col-span-4">선택한 품목: <span className="font-mono">{hs}</span> {names.get(hs)}</p>}
      </form>

      <div className="card">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted"><tr className="border-b border-line text-left"><th className="py-2">HS</th><th>품목</th><th>종목</th><th>메모</th><th /></tr></thead>
          <tbody>
            {tags.map((t) => (
              <tr key={`${t.hs_prefix}${t.ticker}`} className="border-b border-line/50">
                <td className="py-2 font-mono">{t.hs_prefix}</td><td className="text-muted">{names.get(t.hs_prefix) ?? ""}</td>
                <td>{t.ticker}</td><td className="text-muted">{t.note}</td>
                <td className="text-right">
                  <form action={deleteTag}><input type="hidden" name="hs_prefix" value={t.hs_prefix} /><input type="hidden" name="ticker" value={t.ticker} /><button className="text-xs text-red-400 hover:underline">삭제</button></form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
