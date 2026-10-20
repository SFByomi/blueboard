// 텔레그램 봇 API — 키는 Vercel 환경변수(TELEGRAM_BOT_TOKEN)만. 실패하면 응답 설명을 담아 예외.
const api = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export type Button = { text: string; callback_data?: string; copy_text?: { text: string } };
/** 초안 버튼. X 키가 없으면(직접 올리기) [게시] 대신 [✅ 올렸음], 영어 글은 [📋 복사]로 바로 붙여 넣게 (복사 한도 256자) */
export const draftButtons = (id: string, en?: string, manual = false): Button[][] => [
  [{ text: manual ? "✅ 올렸음" : "✅ 게시", callback_data: `post:${id}` }, { text: "✏️ 수정", callback_data: `edit:${id}` }, { text: "🗑 버리기", callback_data: `drop:${id}` }],
  ...(en && en.length <= 256 ? [[{ text: "📋 영어 글 복사", copy_text: { text: en } }]] : []),
];

export async function tg<T = unknown>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
  const r = await fetch(api(method), body instanceof FormData ? { method: "POST", body } : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description ?? r.status}`);
  return j.result as T;
}

type Msg = { message_id: number; photo?: { file_id: string }[] };

/** 사진 보내기(바이트 업로드 또는 이미 올린 file_id). 가장 큰 사진의 file_id를 함께 돌려준다 */
export async function sendPhoto(chat: string, photo: ArrayBuffer | string, caption?: string) {
  const fd = new FormData();
  fd.set("chat_id", chat);
  if (typeof photo === "string") fd.set("photo", photo);
  else fd.set("photo", new Blob([photo], { type: "image/png" }), "chart.png");
  if (caption) fd.set("caption", caption);
  const m = await tg<Msg>("sendPhoto", fd);
  return { message_id: m.message_id, file_id: m.photo?.at(-1)?.file_id ?? null };
}

export const sendText = (chat: string | number, text: string, extra: Record<string, unknown> = {}) =>
  tg<Msg>("sendMessage", { chat_id: chat, text, link_preview_options: { is_disabled: true }, ...extra });

export const editText = (chat: string | number, message_id: number, text: string, buttons?: Button[][]) =>
  tg("editMessageText", { chat_id: chat, message_id, text, link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: buttons ?? [] } });
