import { cronAuthorized } from "@/lib/autopost/auth";
import { runDaily } from "@/lib/autopost/flow";

// Vercel Cron(vercel.json, 매일 1회) → 공급망 흐름 TOP 3 초안을 텔레그램으로 보냄.
// ?dry=1 고른 흐름·확인 필요 표시만(Claude·텔레그램 호출 없음), ?force=1 같은 조합이어도 다시 작성
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams;
  try {
    return Response.json(await runDaily({ dry: q.has("dry"), force: q.has("force") }));
  } catch (e) {
    console.error("autopost cron", e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
