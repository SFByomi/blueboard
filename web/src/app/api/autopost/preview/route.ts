import { cronAuthorized } from "@/lib/autopost/auth";
import { renderChart } from "@/lib/autopost/chart";
import { candidates } from "@/lib/autopost/flow";
import type { Kind } from "@/lib/autopost/types";

// 차트 미리보기(PNG) — 오늘 후보 중 ?kind=trade|preview|result|prices 의 첫 번째(기본: 우선순위 1위). 제목은 Claude 대신 품목명.
// CRON_SECRET 필요(로컬은 없이)
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const kind = (new URL(req.url).searchParams.get("kind") ?? undefined) as Kind | undefined;
  const c = (await candidates(kind))[0];
  if (!c) return new Response("후보 없음", { status: 404 });
  return new Response(await renderChart(c, {}), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}
