import { after } from "next/server";
import { telegramAuthorized } from "@/lib/autopost/auth";
import { handleUpdate } from "@/lib/autopost/flow";

// 텔레그램 봇 웹훅 — [게시][수정][버리기] 버튼과 수정 답장. 텔레그램엔 바로 200을 주고(재전송 방지) 처리는 응답 뒤에.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!telegramAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const update = await req.json();
  after(() => handleUpdate(update).catch((e) => console.error("autopost telegram", e)));
  return new Response("ok");
}
