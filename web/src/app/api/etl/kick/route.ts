import { cronAuthorized } from "@/lib/autopost/auth";

// 매일 데이터 갱신(GitHub Actions etl.yml)을 제시간에 시작시키는 Vercel Cron.
// GitHub 예약 실행(schedule)은 붐비는 시간대에 3~5시간씩 늦게 시작해(03:43 예약 → 07:15~08:50 시작) 아침에 갱신이 안 돼 있었음.
// Vercel Cron이 workflow_dispatch로 직접 실행 → GitHub 예약은 예비로만 남음(최근 8시간 안에 성공한 실행이 있으면 건너뜀).
// 필요: Vercel 환경변수 GH_DISPATCH_TOKEN (이 저장소 Actions 쓰기 권한만 있는 fine-grained 토큰). 없으면 아무것도 안 함.
export const dynamic = "force-dynamic";

const REPO = "SFByomi/blueboard";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return Response.json({ skipped: "GH_DISPATCH_TOKEN 없음 — GitHub 예약 실행에 맡김" });
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/etl.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "blueboard-cron" },
    body: JSON.stringify({ ref: "main", inputs: { auto: "vercel" } }), // auto: 최근 8시간 안에 갱신이 있으면 Actions 쪽에서 건너뜀
  });
  if (r.status !== 204) {
    const body = await r.text();
    console.error("etl kick", r.status, body);
    return Response.json({ error: `GitHub ${r.status}`, body: body.slice(0, 300) }, { status: 502 });
  }
  return Response.json({ dispatched: true, at: new Date().toISOString() });
}
