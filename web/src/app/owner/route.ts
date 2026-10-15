import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { OWNER_COOKIE, ownerToken } from "@/lib/owner";

/** /owner?key=OWNER_KEY → 이 기기를 본인으로 등록(1년) 후 신용 탭으로. /owner?logout=1 → 해제. 키가 틀리면 404 */
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const url = req.nextUrl;
  if (url.searchParams.has("logout")) {
    jar.delete(OWNER_COOKIE);
    return Response.redirect(new URL("/", url), 302);
  }
  const key = process.env.OWNER_KEY;
  if (!key || url.searchParams.get("key") !== key) return new Response("Not found", { status: 404 });
  jar.set(OWNER_COOKIE, ownerToken(key), { httpOnly: true, secure: true, sameSite: "lax", maxAge: 365 * 864e2, path: "/" });
  return Response.redirect(new URL("/credit", url), 302);
}
