import { cronAuthorized } from "@/lib/autopost/auth";
import { runDaily } from "@/lib/autopost/flow";
import type { Kind } from "@/lib/autopost/types";

// Vercel Cron(vercel.json, 매일 1회) → 게시 후보(실적 결과·프리뷰·무역 TOP 3·주간 GPU 가격) 초안을 텔레그램으로 보냄.
// ?dry=1 후보·확인 필요 표시만(Claude·텔레그램 호출 없음), ?force=1 이미 보낸 후보도 다시, ?kind=trade|preview|result|prices 한 종류만
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 초안 최대 3개(Claude 호출이 차례로)

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams;
  try {
    return Response.json(await runDaily({ dry: q.has("dry"), force: q.has("force"), kind: (q.get("kind") ?? undefined) as Kind | undefined }));
  } catch (e) {
    console.error("autopost cron", e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
