import { execute, query, USE_PG } from "../db";
import { renderChart } from "./chart";
import { finalize, writeDraft, xLength } from "./draft";
import { previewCandidates, resultCandidates } from "./earnings";
import { tradeCandidate } from "./pick";
import { priceCandidate } from "./prices";
import { draftButtons, editText, sendPhoto, sendText, tg } from "./telegram";
import type { Candidate, Kind } from "./types";
import { postToX, X_READY } from "./x";

// 자동 게시 흐름: 크론 → 후보(실적 결과·실적 프리뷰·무역 TOP 3·주간 GPU 가격) → 초안(DB 저장)
// → 텔레그램으로 나에게 [게시][수정][버리기] → 승인 시 X·채널 게시.
// 상태는 autopost_drafts 한 테이블(Supabase). ETL 게시(etl.publish)는 SQLite에 있는 테이블만 바꾸므로 이 테이블은 그대로 남는다.

/** 채널 게시는 선택 — TELEGRAM_CHANNEL=off 면 X에만 올림 */
export const CHANNEL = process.env.TELEGRAM_CHANNEL ?? "@buywhenitgoesup";
const CHANNEL_ON = CHANNEL.toLowerCase() !== "off";
const MAX_PER_DAY = 3; // 하루에 보내는 초안 수 (실적 시즌에 쏟아지지 않게)
const owner = () => process.env.TELEGRAM_CHAT_ID!;

type Row = {
  id: string; sig: string; created_at: string; status: "pending" | "posting" | "posted" | "discarded";
  cand: string; labels: string | null; en: string; ko: string; warnings: string | null;
  tg_message_id: number | null; tg_file_id: string | null; x_id: string | null; channel_message_id: number | null; error: string | null;
};

let ready: Promise<void> | null = null;
function ensureTable() {
  ready ??= (async () => {
    await execute(`CREATE TABLE IF NOT EXISTS autopost_drafts (
      id TEXT PRIMARY KEY, sig TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL,
      cand TEXT NOT NULL, labels TEXT, en TEXT NOT NULL, ko TEXT NOT NULL, warnings TEXT,
      tg_message_id INTEGER, tg_file_id TEXT, x_id TEXT, channel_message_id INTEGER, error TEXT, posted_at TEXT)`);
    if (USE_PG) await execute("ALTER TABLE autopost_drafts ENABLE ROW LEVEL SECURITY"); // Supabase 공개 API(anon)로는 못 읽게
  })().catch((e) => { ready = null; throw e; });
  return ready;
}
const getRow = async (id: string) => (await query<Row>("SELECT * FROM autopost_drafts WHERE id = ?", [id]))[0];

/** 우선순위 순 후보 — 실적 결과(신뢰 쌓기) > 실적 프리뷰(때가 있음) > 무역 TOP 3(월 1회꼴) > 주간 GPU 가격(월요일) */
export async function candidates(kind?: Kind): Promise<Candidate[]> {
  const all = await Promise.all([resultCandidates(), previewCandidates(), tradeCandidate().then((c) => (c ? [c] : [])), priceCandidate().then((c) => (c ? [c] : []))]);
  return all.flat().filter((c) => !kind || c.kind === kind);
}

/** 크론: 후보 → 이미 보낸 서명은 건너뜀 → 하루 최대 3개 Claude 초안 → 차트 → 텔레그램.
 *  dry는 Claude·텔레그램·DB 없이 후보만, force는 이미 보낸 서명도 다시, kind는 한 종류만 */
export async function runDaily({ force = false, dry = false, kind }: { force?: boolean; dry?: boolean; kind?: Kind } = {}) {
  const cands = await candidates(kind);
  if (dry) return { dry: true, candidates: cands.map(({ kind, sig, title, flags, brief, facts }) => ({ kind, sig, title, flags, brief, facts })) };
  if (!cands.length) return { skipped: "후보 없음" };
  const missing = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"].filter((k) => !process.env[k]); // Claude·X 키는 없어도 됨 (문장 틀·직접 올리기)
  if (missing.length) return { skipped: `키 없음: ${missing.join(", ")}` }; // 키를 넣기 전 배포에서 크론이 매일 실패하지 않게
  await ensureTable();
  const done = new Set((await query<{ sig: string }>(`SELECT sig FROM autopost_drafts WHERE sig IN (${cands.map(() => "?").join(",")})`, cands.map((c) => c.sig))).map((r) => r.sig));
  const todo = cands.filter((c) => force || !done.has(c.sig)).slice(0, MAX_PER_DAY);
  if (!todo.length) return { skipped: "새 후보 없음 (이미 보낸 초안)" };

  const base = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date()).replace(/\D/g, "").slice(2);
  const sent = [];
  for (const [i, c] of todo.entries()) {
    const id = `${base}${i}`;
    try {
      sent.push(await sendDraft(id, c));
    } catch (e) {
      console.error("autopost draft", c.sig, e);
      await sendText(owner(), `⚠️ 자동 게시 초안 실패 (${c.title})\n${(e as Error).message}`).catch(() => {});
    }
  }
  return { sent };
}

async function sendDraft(id: string, c: Candidate) {
  const d = await writeDraft(c);
  const labels = Object.fromEntries(d.labels.map((l) => [l.key, l.label_en]));
  const png = await renderChart(c, labels);
  await execute(
    "INSERT INTO autopost_drafts (id, sig, created_at, status, cand, labels, en, ko, warnings) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
    [id, c.sig, new Date().toISOString(), JSON.stringify(c), JSON.stringify(labels), d.en, d.ko, JSON.stringify(d.warnings)],
  );
  const photo = await sendPhoto(owner(), png, `📊 초안 ${id} 차트`);
  const msg = await sendText(owner(), draftText({ id, status: "pending", cand: JSON.stringify(c), en: d.en, ko: d.ko, warnings: JSON.stringify(d.warnings) }),
    { reply_markup: { inline_keyboard: draftButtons(id, d.en, !X_READY()) } });
  await execute("UPDATE autopost_drafts SET tg_message_id = ?, tg_file_id = ? WHERE id = ?", [msg.message_id, photo.file_id, id]);
  return { id, kind: c.kind, title: c.title, warnings: d.warnings };
}

const STATUS: Record<Row["status"], string> = { pending: "승인 대기", posting: "게시 중", posted: "✅ 게시됨", discarded: "🗑 버림" };

/** 나에게 보이는 초안 메시지 — 확인 필요 항목·검사 결과·근거 숫자를 함께 */
function draftText(r: Partial<Row> & Pick<Row, "id" | "status" | "cand" | "en" | "ko">): string {
  const c: Candidate = JSON.parse(r.cand);
  const warns: string[] = JSON.parse(r.warnings ?? "[]");
  const lines = [`📝 초안 ${r.id} · ${STATUS[r.status]}`, c.title];
  if (c.flags.length) lines.push("", "⚠️ 확인 필요", ...c.flags.map((f) => `· ${f.ko}`));
  if (warns.length) lines.push("", "⚠️ 초안 검사", ...warns.map((w) => `· ${w}`));
  lines.push("", `🇺🇸 X (${xLength(r.en)}/280)`, r.en);
  if (CHANNEL_ON) lines.push("", "🇰🇷 텔레그램 채널", r.ko);
  lines.push("", "📊 근거 (사이트 숫자)", ...c.brief);
  if (r.x_id) lines.push("", `X: https://x.com/i/web/status/${r.x_id}`);
  if (r.channel_message_id) lines.push(`채널: https://t.me/${CHANNEL.replace("@", "")}/${r.channel_message_id}`);
  if (r.error) lines.push("", `❌ ${r.error}`);
  return lines.join("\n").slice(0, 4000);
}

const refresh = async (id: string) => {
  const r = await getRow(id);
  if (r?.tg_message_id) await editText(owner(), r.tg_message_id, draftText(r), r.status === "pending" ? draftButtons(id, r.en, !X_READY()) : []);
};

type Update = {
  callback_query?: { id: string; from: { id: number }; data?: string };
  message?: { chat: { id: number }; from?: { id: number }; text?: string; reply_to_message?: { text?: string } };
};

/** 텔레그램 웹훅 — 내 chat_id에서 온 버튼·답장만 처리 */
export async function handleUpdate(u: Update) {
  await ensureTable();
  const cq = u.callback_query;
  if (cq) {
    if (String(cq.from.id) !== owner()) return;
    const [act, id] = (cq.data ?? "").split(":");
    const r = id ? await getRow(id) : undefined;
    if (!r) return tg("answerCallbackQuery", { callback_query_id: cq.id, text: "초안을 찾을 수 없음" });
    if (act === "drop") {
      await execute("UPDATE autopost_drafts SET status = 'discarded' WHERE id = ? AND status = 'pending'", [id]);
      await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "버렸습니다" });
      return refresh(id);
    }
    if (act === "edit") {
      await tg("answerCallbackQuery", { callback_query_id: cq.id });
      return sendText(owner(), `✏️ 초안 ${id} 수정 — 이 메시지에 답장으로 보내주세요.\n바꿀 쪽만 써도 됩니다:\nEN: (영어 X 글)${CHANNEL_ON ? "\nKO: (한국어 채널 글)" : ""}`,
        { reply_markup: { force_reply: true, input_field_placeholder: "EN: … / KO: …" } });
    }
    if (act === "post") {
      // 두 번 눌러도 한 번만: pending → posting 으로 바꾼 요청만 게시
      if (!(await execute("UPDATE autopost_drafts SET status = 'posting', error = NULL WHERE id = ? AND status = 'pending'", [id]))) {
        const now = await getRow(id);
        return tg("answerCallbackQuery", { callback_query_id: cq.id, text: `이미 ${STATUS[now?.status ?? r.status]}` });
      }
      await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "게시 중…" });
      return publish(id);
    }
    return;
  }
  const m = u.message;
  if (!m || String(m.chat.id) !== owner() || !m.text) return;
  const id = m.reply_to_message?.text?.match(/초안 (\d{10,12})/)?.[1];
  if (!id) return sendText(owner(), "초안 메시지의 [수정] 버튼을 누른 뒤, 봇이 보낸 안내 메시지에 답장으로 새 문구를 보내주세요.");
  const r = await getRow(id);
  if (!r || r.status !== "pending") return sendText(owner(), `초안 ${id}은(는) 수정할 수 없는 상태입니다 (${r ? STATUS[r.status] : "없음"}).`);
  const en = m.text.match(/EN:\s*([\s\S]*?)(?=\n\s*KO:|$)/i)?.[1].trim();
  const ko = m.text.match(/KO:\s*([\s\S]*)$/i)?.[1].trim();
  if (!en && !ko) return sendText(owner(), "EN: 또는 KO: 로 시작하는 줄이 필요합니다.");
  const d = finalize({ en: en || r.en, ko: ko || r.ko, labels: [] }, JSON.parse(r.cand));
  await execute("UPDATE autopost_drafts SET en = ?, ko = ?, warnings = ? WHERE id = ? AND status = 'pending'", [d.en, d.ko, JSON.stringify(d.warnings), id]);
  await refresh(id);
  return sendText(owner(), `초안 ${id}을(를) 고쳤습니다. 위 메시지에서 [게시]를 누르면 올라갑니다.${d.warnings.length ? `\n⚠️ ${d.warnings.join(" · ")}` : ""}`);
}

/** X·채널에 게시 — 이미 성공한 곳은 건너뛰어, 한쪽만 실패하면 [게시]를 다시 눌러 나머지만 올릴 수 있게 */
async function publish(id: string) {
  const r = (await getRow(id))!;
  const c: Candidate = JSON.parse(r.cand);
  const errors: string[] = [];
  if (!r.x_id) {
    if (X_READY()) try { // 키가 없으면 직접 올리기 — [✅ 올렸음]은 상태만 바꿈
      const png = await renderChart(c, JSON.parse(r.labels ?? "{}"));
      const xid = await postToX(r.en, png);
      await execute("UPDATE autopost_drafts SET x_id = ? WHERE id = ?", [xid, id]);
    } catch (e) { errors.push((e as Error).message); }
  }
  if (CHANNEL_ON && !r.channel_message_id) {
    try {
      const photo = r.tg_file_id ?? (await renderChart(c, JSON.parse(r.labels ?? "{}")));
      const long = r.ko.length > 1000; // 사진 설명 한도 1024자
      const sent = await sendPhoto(CHANNEL, photo, long ? undefined : r.ko);
      const mid = long ? (await sendText(CHANNEL, r.ko)).message_id : sent.message_id;
      await execute("UPDATE autopost_drafts SET channel_message_id = ? WHERE id = ?", [mid, id]);
    } catch (e) { errors.push(`채널: ${(e as Error).message}`); }
  }
  await execute(`UPDATE autopost_drafts SET status = ?, error = ?, posted_at = ? WHERE id = ?`,
    [errors.length ? "pending" : "posted", errors.join(" / ") || null, errors.length ? null : new Date().toISOString(), id]);
  await refresh(id);
}
