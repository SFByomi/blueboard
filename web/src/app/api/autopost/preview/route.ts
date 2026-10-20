import { cronAuthorized } from "@/lib/autopost/auth";
import { renderChart } from "@/lib/autopost/chart";
import { topFlows } from "@/lib/autopost/pick";

// 차트 미리보기(PNG) — 오늘 TOP 3로 그림. 제목은 Claude 대신 품목명. CRON_SECRET 필요(로컬은 없이)
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const png = await renderChart(await topFlows(3), {});
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}
