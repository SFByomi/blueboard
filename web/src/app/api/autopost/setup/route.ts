import { cronAuthorized } from "@/lib/autopost/auth";
import { tg } from "@/lib/autopost/telegram";

// 한 번만: 텔레그램 봇 웹훅을 이 배포의 /api/autopost/telegram 으로 등록 (CRON_SECRET 필요)
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) return Response.json({ error: "TELEGRAM_BOT_TOKEN·TELEGRAM_WEBHOOK_SECRET 필요" }, { status: 400 });
  const url = `${new URL(req.url).origin}/api/autopost/telegram`;
  await tg("setWebhook", { url, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  const info = await tg<{ url: string; pending_update_count: number; last_error_message?: string }>("getWebhookInfo", {});
  return Response.json({ url: info.url, pending: info.pending_update_count, last_error: info.last_error_message ?? null });
}
