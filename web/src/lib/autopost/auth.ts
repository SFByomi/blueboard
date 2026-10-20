import { timingSafeEqual } from "node:crypto";
import { USE_PG } from "../db";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** 크론·관리용 경로: Vercel Cron이 보내는 `Authorization: Bearer $CRON_SECRET`. 시크릿이 없으면 로컬(SQLite)에서만 허용 */
export function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return !USE_PG;
  return same(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

/** 텔레그램 웹훅: setWebhook 때 넣은 secret_token이 헤더로 옴 */
export function telegramAuthorized(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  return !!secret && same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", secret);
}
