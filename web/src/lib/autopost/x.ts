import { createHmac, randomBytes } from "node:crypto";

// X(트위터) 게시 — OAuth 1.0a 사용자 키 4개(X_API_KEY·X_API_SECRET·X_ACCESS_TOKEN·X_ACCESS_SECRET, Vercel 환경변수).
// 이미지는 v2 /2/media/upload(multipart), 안 되면 v1.1 upload.twitter.com으로 한 번 더. JSON·multipart 본문은 서명에 넣지 않는다.

export const X_READY = () => ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"].every((k) => process.env[k]);

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** HMAC-SHA1 서명 (extra: x-www-form-urlencoded 본문 파라미터 — 여기선 안 쓰지만 공식 예제로 검증할 때 필요) */
export function sign(method: string, url: string, o: Record<string, string>, consumerSecret: string, tokenSecret: string, extra: [string, string][] = []) {
  const u = new URL(url);
  const params = [...Object.entries(o), ...u.searchParams.entries(), ...extra].map(([k, v]) => [enc(k), enc(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
  const base = [method, enc(`${u.origin}${u.pathname}`), enc(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  return createHmac("sha1", `${enc(consumerSecret)}&${enc(tokenSecret)}`).update(base).digest("base64");
}

function oauth(method: string, url: string): string {
  const o: Record<string, string> = {
    oauth_consumer_key: process.env.X_API_KEY!, oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: process.env.X_ACCESS_TOKEN!, oauth_version: "1.0",
  };
  o.oauth_signature = sign(method, url, o, process.env.X_API_SECRET!, process.env.X_ACCESS_SECRET!);
  return "OAuth " + Object.entries(o).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
}

async function call(url: string, body: FormData | object): Promise<Record<string, unknown>> {
  const isForm = body instanceof FormData;
  const r = await fetch(url, {
    method: "POST",
    headers: { authorization: oauth("POST", url), ...(isForm ? {} : { "content-type": "application/json" }) },
    body: isForm ? body : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`X ${new URL(url).pathname} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function uploadImage(png: ArrayBuffer): Promise<string> {
  const form = () => { const f = new FormData(); f.set("media", new Blob([png], { type: "image/png" }), "chart.png"); return f; };
  try {
    const f = form(); f.set("media_category", "tweet_image");
    const j = await call("https://api.x.com/2/media/upload", f) as { data?: { id?: string } };
    if (j.data?.id) return j.data.id;
    throw new Error("X media upload: id 없음");
  } catch (e) {
    const j = await call("https://upload.twitter.com/1.1/media/upload.json", form()).catch((e2) => { throw new Error(`${(e as Error).message} / v1.1: ${(e2 as Error).message}`); }) as { media_id_string?: string };
    if (!j.media_id_string) throw e;
    return j.media_id_string;
  }
}

/** 글 + 차트 이미지 게시 → 게시물 id */
export async function postToX(text: string, png: ArrayBuffer | null): Promise<string> {
  const media = png ? await uploadImage(png) : null;
  const j = await call("https://api.x.com/2/tweets", { text, ...(media ? { media: { media_ids: [media] } } : {}) }) as { data?: { id?: string } };
  if (!j.data?.id) throw new Error("X 게시: id 없음");
  return j.data.id;
}
