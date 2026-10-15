// 본인 전용 화면(신용 탭) — Vercel 환경변수 OWNER_KEY. /owner?key=... 를 한 번 열면 그 기기에 1년 쿠키(키의 해시)를 심음.
// 로컬(SQLite, 관리 페이지 켜진 환경)은 항상 본인.
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { ADMIN_ENABLED } from "@/lib/db";

export const OWNER_COOKIE = "yo_owner";
export const ownerToken = (key: string) => createHash("sha256").update(`yomin:${key}`).digest("hex");

export async function isOwner(): Promise<boolean> {
  if (ADMIN_ENABLED) return true;
  const key = process.env.OWNER_KEY;
  if (!key) return false;
  return (await cookies()).get(OWNER_COOKIE)?.value === ownerToken(key);
}
