// tg-bot: Telegram webhook for @CCPortfolioManagerBot.
// - Members log trades in the chat: type "bought 500 PAAL at 0.12" or forward an exchange screenshot.
//   Claude reads it, the bot shows what it understood, and ✅ saves it to their Desk.
// - An admin sends /setgroup inside the CC group once, so the Desk can check who is a member.
// - /start login_<nonce> (from the home-screen app) asks the member to approve that sign-in; see tg-login.
// GET ?setup=1 points the bot's webhook here; GET ?info=1 shows the webhook status.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const LIMIT = Number(Deno.env.get("IMPORT_DAILY_LIMIT") ?? 20);
const APP = "https://zino1025.github.io/cc-portfolio-desk/";
const HOOK = `${Deno.env.get("SUPABASE_URL")}/functions/v1/tg-bot`;
function serviceKey() {
  try { const v = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0]; if (v) return String(v); } catch { /* fall back */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), { auth: { persistSession: false } });
const tg = async (method: string, body: unknown) => { const r = await (await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json(); if (!r.ok) console.log("telegram", method, r.description); return r; };
const say = (chat_id: number, text: string, buttons?: unknown[][]) => tg("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: buttons ? { inline_keyboard: buttons } : undefined });
const openBtn = [[{ text: "Open Desk", web_app: { url: APP } }]];
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (v: number) => v >= 1 ? "$" + (+v.toPrecision(6)).toLocaleString("en-US") : "$" + (+v.toPrecision(4));
const secret = async () => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("cc-hook:" + TOKEN)))).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
const cg = async (path: string) => { const r = await fetch("https://api.coingecko.com/api/v3" + path); return r.ok ? r.json() : null; };

const SYSTEM = `You read crypto trades a member sends: a short text ("bought 500 PAAL at 0.12", "sold half my TET at 40")
or a screenshot of an exchange order, fill or trade history (MEXC, Binance, Bybit, Coinbase, wallets…).
List each trade: side, symbol (no "$"), quantity of coins, price_usd per coin if shown or said (USDT/USDC count as USD),
total_usd if only the total is shown, date as YYYY-MM-DD if shown, exchange if visible.
Expand K/M suffixes. Never guess numbers that aren't there. If a quantity is relative ("half my TET"), put it in note and leave quantity null.
If the message isn't about a trade, return no trades. Always answer with the report_trades tool.`;
const TOOL = {
  name: "report_trades", description: "Report the trades in the message.",
  input_schema: { type: "object", required: ["trades"], properties: { trades: { type: "array", items: { type: "object", required: ["side", "symbol"], properties: {
    side: { type: "string", enum: ["buy", "sell"] }, symbol: { type: "string" }, name: { type: ["string", "null"] }, quantity: { type: ["number", "null"] },
    price_usd: { type: ["number", "null"] }, total_usd: { type: ["number", "null"] }, date: { type: ["string", "null"] }, exchange: { type: ["string", "null"] }, note: { type: ["string", "null"] } } } } } },
};

async function readTrades(text: string, image?: string, mime = "image/jpeg") {
  const content: unknown[] = image ? [{ type: "image", source: { type: "base64", media_type: mime, data: image } }] : [];
  content.push({ type: "text", text: text || "List the trades in this screenshot." });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-5-5", max_tokens: 1500, system: SYSTEM, tools: [TOOL], tool_choice: { type: "tool", name: "report_trades" }, messages: [{ role: "user", content }] }),
  });
  const out = await r.json().catch(() => null);
  if (!r.ok) { console.log("anthropic", r.status, JSON.stringify(out)); return null; }
  return { trades: out.content?.find((c: any) => c.type === "tool_use")?.input?.trades ?? [], usage: out.usage };
}

// Symbol → CoinGecko coin: the member's own coins first, then the biggest coin with that ticker.
async function resolve(userId: string, sym: string) {
  const S = sym.replace(/^\$/, "").toUpperCase();
  const { data: mine } = await db.from("transactions").select("coin_id, symbol, name").eq("user_id", userId).ilike("symbol", S).limit(1);
  if (mine?.[0]) return mine[0];
  const r = await cg(`/search?query=${encodeURIComponent(S)}`);
  const c = (r?.coins ?? []).filter((c: any) => String(c.symbol).toUpperCase() === S).sort((a: any, b: any) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))[0];
  return c ? { coin_id: c.id, symbol: S, name: c.name } : null;
}
async function priceOn(id: string, date: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  if (!date || date >= today) return (await cg(`/simple/price?ids=${id}&vs_currencies=usd`))?.[id]?.usd ?? null;
  const [y, m, d] = date.split("-");
  return (await cg(`/coins/${id}/history?date=${d}-${m}-${y}&localization=false`))?.market_data?.current_price?.usd ?? null;
}

async function handleTrade(chat: number, prof: any, text: string, image?: string, mime?: string) {
  if (!KEY) return say(chat, "Logging trades here isn't set up yet. Use the Desk for now.", openBtn);
  if (prof.role !== "admin") {
    const { count } = await db.from("screenshot_imports").select("id", { count: "exact", head: true }).eq("user_id", prof.id).gte("created_at", new Date(Date.now() - 864e5).toISOString());
    if ((count ?? 0) >= LIMIT) return say(chat, `You've hit today's limit of ${LIMIT} reads. Add this one in the Desk.`, openBtn);
  }
  tg("sendChatAction", { chat_id: chat, action: "typing" });
  const res = await readTrades(text, image, mime);
  if (!res) return say(chat, "I couldn't read that right now. Try again in a minute, or add it in the Desk.", openBtn);
  await db.from("screenshot_imports").insert({ user_id: prof.id, images: image ? 1 : 0, coins: res.trades.length, source_app: "bot", input_tokens: res.usage?.input_tokens, output_tokens: res.usage?.output_tokens });
  const rows: any[] = [], skipped: string[] = [];
  for (const t of res.trades.slice(0, 10)) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(t.date ?? "") ? t.date : null, coin = await resolve(prof.id, String(t.symbol || ""));
    if (!coin) { skipped.push(`${esc(t.symbol)}: couldn't find that coin`); continue; }
    let price = t.price_usd > 0 ? t.price_usd : t.total_usd > 0 && t.quantity > 0 ? t.total_usd / t.quantity : null, estimated = false;
    const qty = t.quantity > 0 ? t.quantity : price && t.total_usd > 0 ? t.total_usd / price : null;
    if (!qty) { skipped.push(`${esc(coin.symbol)}: no amount${t.note ? ` (${esc(t.note)})` : ""}`); continue; }
    if (!price) { price = await priceOn(coin.coin_id, date); estimated = true; }
    if (!price) { skipped.push(`${esc(coin.symbol)}: no price`); continue; }
    rows.push({ ...coin, side: t.side === "sell" ? "sell" : "buy", quantity: qty, price_usd: price, fee_usd: 0, executed_at: date ? `${date}T12:00:00Z` : new Date().toISOString(), exchange: t.exchange ? String(t.exchange).slice(0, 40) : null, note: "Logged in the bot chat", estimated });
  }
  if (!rows.length) return say(chat, (skipped.length ? skipped.join("\n") + "\n\n" : "I didn't find a trade in that. ") + "Try something like <b>bought 500 PAAL at 0.12</b>, or send a screenshot of the order.");
  const { data: d } = await db.from("bot_drafts").insert({ user_id: prof.id, rows }).select("id").single();
  const lines = rows.map((r) => `${r.side === "buy" ? "🟢 Buy" : "🔴 Sell"} <b>${+(+r.quantity).toPrecision(8)} ${esc(r.symbol.toUpperCase())}</b> at ${fmt(r.price_usd)}${r.estimated ? " (market price)" : ""} · ${fmt(r.quantity * r.price_usd)}${r.executed_at.slice(0, 10) !== new Date().toISOString().slice(0, 10) ? ` · ${r.executed_at.slice(0, 10)}` : ""}`);
  return say(chat, `Save to your Desk?\n\n${lines.join("\n")}${skipped.length ? `\n\nSkipped:\n${skipped.join("\n")}` : ""}`,
    [[{ text: "✅ Save", callback_data: `ok:${d!.id}` }, { text: "✖ Cancel", callback_data: `no:${d!.id}` }]]);
}

async function onCallback(q: any) {
  const [act, id] = String(q.data || "").split(":"), msg = q.message;
  if (act === "login") {   // approve a home-screen app sign-in (tg-login hands the app its session)
    const { data: prof } = await db.from("profiles").select("id").eq("telegram_chat_id", q.from.id).maybeSingle();
    const ok = prof && !(await db.from("tg_logins").insert({ nonce: id, user_id: prof.id })).error;
    await tg("answerCallbackQuery", { callback_query_id: q.id });
    await tg("editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: ok ? "Signed in ✓ Go back to the Desk." : "That sign-in link was already used. Tap Sign in with Telegram again." });
    return;
  }
  const { data: d } = await db.from("bot_drafts").delete().eq("id", id).select().maybeSingle();   // claim once
  const { data: prof } = await db.from("profiles").select("id").eq("telegram_chat_id", q.from.id).maybeSingle();
  if (!d || d.user_id !== prof?.id) { await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Already handled." }); return; }
  let text = "Cancelled.";
  if (act === "ok") {
    const { error } = await db.from("transactions").insert(d.rows.map(({ estimated: _e, ...r }: any) => ({ ...r, user_id: d.user_id })));
    text = error ? "Couldn't save: " + error.message : `Saved ✓ ${d.rows.length} trade${d.rows.length > 1 ? "s" : ""} added to your Desk.`;
  }
  await tg("answerCallbackQuery", { callback_query_id: q.id });
  await tg("editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: msg.text + "\n\n" + text, reply_markup: act === "ok" ? { inline_keyboard: openBtn } : undefined });
}

async function inGroup(userId: number) {
  const { data } = await db.from("app_settings").select("value").eq("key", "cc_group").maybeSingle();
  if (!data?.value?.id) return null;
  const r = await tg("getChatMember", { chat_id: data.value.id, user_id: userId });
  return r.ok ? ["creator", "administrator", "member"].includes(r.result.status) || !!r.result.is_member : null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.has("setup")) return Response.json(await tg("setWebhook", { url: HOOK, secret_token: await secret(), allowed_updates: ["message", "callback_query"] }));
    if (url.searchParams.has("info")) { const r = await tg("getWebhookInfo", {}); return Response.json({ url: r.result?.url, pending: r.result?.pending_update_count, last_error: r.result?.last_error_message }); }
    return new Response("ok");
  }
  if (req.headers.get("x-telegram-bot-api-secret-token") !== await secret()) return new Response("forbidden", { status: 403 });
  try {
    const u = await req.json();
    if (u.callback_query) { await onCallback(u.callback_query); return new Response("ok"); }
    const m = u.message; if (!m?.from) return new Response("ok");
    const chat = m.chat.id, text: string = m.text || m.caption || "";
    const { data: prof } = await db.from("profiles").select("id, role, in_group").eq("telegram_chat_id", m.from.id).maybeSingle();

    if (m.chat.type !== "private") {   // in groups the bot only answers /setgroup from an admin
      if (/^\/setgroup(@\w+)?$/.test(text.trim()) && prof?.role === "admin") {
        await db.from("app_settings").upsert({ key: "cc_group", value: { id: chat, title: m.chat.title }, updated_at: new Date().toISOString() });
        await say(chat, "Done. The Desk now checks that members are in this group.");
      }
      return new Response("ok");
    }
    if (!prof) { await say(chat, "Open the Desk once with the button below to link your account. Then you can log trades right here.", openBtn); return new Response("ok"); }
    if (prof.role !== "admin" && (await inGroup(m.from.id)) === false) { await say(chat, "The Desk is for CC group members. Join the group, then try again."); return new Response("ok"); }
    if (text.startsWith("/start")) console.log("start", JSON.stringify(text.slice(0, 60)));   // debug: Sign in with Telegram
    const login = text.match(/^\/start login_([a-f0-9]{32})$/)?.[1];
    if (login) {
      await say(chat, "Tap <b>Approve</b> to sign in to the Desk app, then go back to it.\n\nOnly approve if you just tapped Sign in with Telegram yourself.", [[{ text: "✅ Approve", callback_data: `login:${login}` }]]);
      return new Response("ok");
    }
    if (/^\/(start|help)/.test(text)) {
      await say(chat, "Log a trade by typing it, like <b>bought 500 PAAL at 0.12</b>, or send a screenshot of the order. I'll show you what I read before saving anything.", openBtn);
      return new Response("ok");
    }
    const photo = m.photo?.at(-1)?.file_id || (m.document?.mime_type?.startsWith("image/") ? m.document.file_id : null);
    let image: string | undefined;
    if (photo) {
      const f = await tg("getFile", { file_id: photo });
      if (!f.ok || f.result.file_size > 5e6) { await say(chat, "That image is too big. Send a normal screenshot."); return new Response("ok"); }
      const buf = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.result.file_path}`)).arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      image = btoa(bin);
    }
    if (image || text.trim()) await handleTrade(chat, prof, text.slice(0, 1000), image, m.photo ? "image/jpeg" : m.document?.mime_type);
  } catch (e) {
    console.log("tg-bot error", String(e));
  }
  return new Response("ok");
});
