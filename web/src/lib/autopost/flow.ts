import { execute, query, USE_PG } from "../db";
import { renderChart } from "./chart";
import { finalize, writeDraft, xLength } from "./draft";
import { type FlowPick, signature, topFlows } from "./pick";
import { draftButtons, editText, sendPhoto, sendText, tg } from "./telegram";
import { postToX, X_READY } from "./x";

// 자동 게시 흐름: 크론 → 초안(DB 저장) → 텔레그램으로 나에게 [게시][수정][버리기] → 승인 시 X·채널 게시.
// 상태는 autopost_drafts 한 테이블(Supabase). ETL 게시(etl.publish)는 SQLite에 있는 테이블만 바꾸므로 이 테이블은 그대로 남는다.

export const CHANNEL = process.env.TELEGRAM_CHANNEL ?? "@buywhenitgoesup";
const owner = () => process.env.TELEGRAM_CHAT_ID!;

type Row = {
  id: string; sig: string; created_at: string; status: "pending" | "posting" | "posted" | "discarded";
  picks: string; labels: string | null; en: string; ko: string; warnings: string | null;
  tg_message_id: number | null; tg_file_id: string | null; x_id: string | null; channel_message_id: number | null; error: string | null;
};

let ready: Promise<void> | null = null;
function ensureTable() {
  ready ??= (async () => {
    await execute(`CREATE TABLE IF NOT EXISTS autopost_drafts (
      id TEXT PRIMARY KEY, sig TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL,
      picks TEXT NOT NULL, labels TEXT, en TEXT NOT NULL, ko TEXT NOT NULL, warnings TEXT,
      tg_message_id INTEGER, tg_file_id TEXT, x_id TEXT, channel_message_id INTEGER, error TEXT, posted_at TEXT)`);
    if (USE_PG) await execute("ALTER TABLE autopost_drafts ENABLE ROW LEVEL SECURITY"); // Supabase 공개 API(anon)로는 못 읽게
  })().catch((e) => { ready = null; throw e; });
  return ready;
}
const getRow = async (id: string) => (await query<Row>("SELECT * FROM autopost_drafts WHERE id = ?", [id]))[0];

/** 크론: TOP 3 → 같은 조합이면 건너뜀 → Claude 초안 → 차트 → 텔레그램. dry는 Claude·텔레그램·DB 없이 고른 결과만 */
export async function runDaily({ force = false, dry = false } = {}) {
  const picks = await topFlows(3);
  const sig = signature(picks);
  if (dry) return { dry: true, sig, picks };
  if (!picks.length) return { skipped: "흐름 없음" };
  const missing = ["ANTHROPIC_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"].filter((k) => !process.env[k]);
  if (missing.length) return { skipped: `키 없음: ${missing.join(", ")}` }; // 키를 넣기 전 배포에서 크론이 매일 실패하지 않게
  await ensureTable();
  if (!force && (await query("SELECT id FROM autopost_drafts WHERE sig = ?", [sig])).length) return { skipped: "같은 TOP 3·기준월 초안이 이미 있음", sig };

  const now = new Date();
  const id = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(now).replace(/\D/g, "").slice(2);
  let d;
  try {
    d = await writeDraft(picks);
  } catch (e) {
    await sendText(owner(), `⚠️ 자동 게시 초안 실패 (${id})\n${(e as Error).message}`);
    throw e;
  }
  const labels = Object.fromEntries(d.labels.map((l) => [l.key, l.label_en]));
  const png = await renderChart(picks, labels);
  await execute(
    "INSERT INTO autopost_drafts (id, sig, created_at, status, picks, labels, en, ko, warnings) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
    [id, sig, now.toISOString(), JSON.stringify(picks), JSON.stringify(labels), d.en, d.ko, JSON.stringify(d.warnings)],
  );
  const photo = await sendPhoto(owner(), png, `📊 초안 ${id} 차트`);
  const msg = await sendText(owner(), draftText({ id, status: "pending", picks: JSON.stringify(picks), en: d.en, ko: d.ko, warnings: JSON.stringify(d.warnings) } as Row),
    { reply_markup: { inline_keyboard: draftButtons(id) } });
  await execute("UPDATE autopost_drafts SET tg_message_id = ?, tg_file_id = ? WHERE id = ?", [msg.message_id, photo.file_id, id]);
  return { id, sig, picks: picks.map((p) => `${p.tickers.join("·")} ${p.yoy3m_txt}`), warnings: d.warnings };
}

const STATUS: Record<Row["status"], string> = { pending: "승인 대기", posting: "게시 중", posted: "✅ 게시됨", discarded: "🗑 버림" };

/** 나에게 보이는 초안 메시지 — 확인 필요 항목·검사 결과·근거 숫자를 함께 */
function draftText(r: Partial<Row> & Pick<Row, "id" | "status" | "picks" | "en" | "ko">): string {
  const picks: FlowPick[] = JSON.parse(r.picks);
  const warns: string[] = JSON.parse(r.warnings ?? "[]");
  const flagged = picks.filter((p) => p.flags.length);
  const lines = [`📝 초안 ${r.id} · ${STATUS[r.status]}`];
  if (flagged.length) lines.push("", "⚠️ 확인 필요", ...flagged.flatMap((p) => p.flags.map((f) => `· ${p.tickers.join("·")}: ${f.ko}`)));
  if (warns.length) lines.push("", "⚠️ 초안 검사", ...warns.map((w) => `· ${w}`));
  lines.push("", `🇺🇸 X (${xLength(r.en)}/280)`, r.en, "", "🇰🇷 텔레그램 채널", r.ko, "", "📊 근거 (사이트 숫자)");
  picks.forEach((p, i) => lines.push(`${i + 1}. ${p.tickers.join("·")} ${p.flow_ko}: 3개월 ${p.yoy3m_txt}${p.last_yoy_txt ? ` · 최근 월 ${p.last_yoy_txt}` : ""} (${p.month}, 연관도 ${p.grade ?? "-"}${p.corr_txt ? ` ${p.corr_txt}` : ""}, 표본 ${p.n_yoy ?? 0}분기)`));
  if (r.x_id) lines.push("", `X: https://x.com/i/web/status/${r.x_id}`);
  if (r.channel_message_id) lines.push(`채널: https://t.me/${CHANNEL.replace("@", "")}/${r.channel_message_id}`);
  if (r.error) lines.push("", `❌ ${r.error}`);
  return lines.join("\n").slice(0, 4000);
}

const refresh = async (id: string) => {
  const r = await getRow(id);
  if (r?.tg_message_id) await editText(owner(), r.tg_message_id, draftText(r), r.status === "pending" ? draftButtons(id) : []);
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
      return sendText(owner(), `✏️ 초안 ${id} 수정 — 이 메시지에 답장으로 보내주세요.\n바꿀 쪽만 써도 됩니다:\nEN: (영어 X 글)\nKO: (한국어 채널 글)`,
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
  const id = m.reply_to_message?.text?.match(/초안 (\d{10})/)?.[1];
  if (!id) return sendText(owner(), "초안 메시지의 [수정] 버튼을 누른 뒤, 봇이 보낸 안내 메시지에 답장으로 새 문구를 보내주세요.");
  const r = await getRow(id);
  if (!r || r.status !== "pending") return sendText(owner(), `초안 ${id}은(는) 수정할 수 없는 상태입니다 (${r ? STATUS[r.status] : "없음"}).`);
  const en = m.text.match(/EN:\s*([\s\S]*?)(?=\n\s*KO:|$)/i)?.[1].trim();
  const ko = m.text.match(/KO:\s*([\s\S]*)$/i)?.[1].trim();
  if (!en && !ko) return sendText(owner(), "EN: 또는 KO: 로 시작하는 줄이 필요합니다.");
  const d = finalize({ en: en || r.en, ko: ko || r.ko, labels: [] }, JSON.parse(r.picks));
  await execute("UPDATE autopost_drafts SET en = ?, ko = ?, warnings = ? WHERE id = ? AND status = 'pending'", [d.en, d.ko, JSON.stringify(d.warnings), id]);
  await refresh(id);
  return sendText(owner(), `초안 ${id}을(를) 고쳤습니다. 위 메시지에서 [게시]를 누르면 올라갑니다.${d.warnings.length ? `\n⚠️ ${d.warnings.join(" · ")}` : ""}`);
}

/** X·채널에 게시 — 이미 성공한 곳은 건너뛰어, 한쪽만 실패하면 [게시]를 다시 눌러 나머지만 올릴 수 있게 */
async function publish(id: string) {
  const r = (await getRow(id))!;
  const picks: FlowPick[] = JSON.parse(r.picks);
  const errors: string[] = [];
  if (!r.x_id) {
    if (!X_READY()) errors.push("X 키가 없음 (Vercel 환경변수 X_API_KEY 등)");
    else try {
      const png = await renderChart(picks, JSON.parse(r.labels ?? "{}"));
      const xid = await postToX(r.en, png);
      await execute("UPDATE autopost_drafts SET x_id = ? WHERE id = ?", [xid, id]);
    } catch (e) { errors.push((e as Error).message); }
  }
  if (!r.channel_message_id) {
    try {
      const photo = r.tg_file_id ?? (await renderChart(picks, JSON.parse(r.labels ?? "{}")));
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
