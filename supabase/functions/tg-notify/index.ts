// tg-notify: sends Telegram messages for new feedback/messages and review requests.
// Called by a database trigger with {table, id}. It re-reads the row and marks it
// notified, so calling it again (or by anyone else) never sends duplicates.
import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
function serviceKey() {
  try { const v = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0]; if (v) return String(v); } catch { /* fall back */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), {
  auth: { persistSession: false },
});
const APP = "https://zino1025.github.io/cc-portfolio-desk/";
const REVIEWER = "Dkay";
const DEFAULT_MODEL = { version: 2, fixed: [{ coin: "tectum" }, { coin: "solidus-ai-tech" }], flex: [{ coin: "paal-ai" }, { coin: "velo" }, { coin: "octokn" }], drop24: 15, drop7: 25 };

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (s: string, n = 300) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const nameOf = (p: any) => p?.display_name || (p?.telegram_handle ? "@" + p.telegram_handle : "A member");

async function send(chatId: number | string, text: string, go: string) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "Open Desk", web_app: { url: `${APP}?go=${go}` } }]] },
    }),
  });
  if (!r.ok) console.log("telegram error", r.status, await r.text());
  return r.ok;
}

async function admins(exceptId?: string) {
  const { data } = await db.from("profiles").select("id, telegram_chat_id").eq("role", "admin").not("telegram_chat_id", "is", null);
  return (data ?? []).filter((a) => a.id !== exceptId);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("ok");
    const { table, id } = await req.json();
    if (!TOKEN || (!id && table !== "price-check")) return Response.json({ skipped: true });

    if (table === "messages") {
      // Claim the message (only once).
      const { data: m } = await db.from("messages").update({ notified_at: new Date().toISOString() })
        .eq("id", id).is("notified_at", null).select().maybeSingle();
      if (!m) return Response.json({ skipped: "already" });
      const { data: member } = await db.from("profiles").select("*").eq("id", m.member_id).single();
      const body = esc(cut(m.body));
      if (m.author_id === m.member_id) {
        // Member wrote in their thread -> tell the admins.
        for (const a of await admins(m.author_id)) {
          await send(a.telegram_chat_id, `💬 <b>${esc(nameOf(member))}</b> sent a message:\n\n“${body}”`, `member-${m.member_id}`);
        }
      } else if (member?.telegram_chat_id) {
        // Admin wrote to the member -> tell the member.
        const kind = m.kind === "suggestion" ? "left you a suggestion" : m.kind === "note" ? "sent you a note" : "replied to you";
        await send(member.telegram_chat_id, `📝 <b>${REVIEWER}</b> ${kind}:\n\n“${body}”`, "feedback");
      }
      return Response.json({ ok: true });
    }

    if (table === "profiles") {
      const { data: p } = await db.from("profiles").select("*").eq("id", id).single();
      if (!p?.review_requested) return Response.json({ skipped: "not requested" });
      if (p.review_notified_at && p.review_requested_at && new Date(p.review_notified_at) >= new Date(p.review_requested_at)) {
        return Response.json({ skipped: "already" });
      }
      await db.from("profiles").update({ review_notified_at: new Date().toISOString() }).eq("id", id);
      const q = p.review_question ? `\n\n“${esc(cut(p.review_question))}”` : "";
      for (const a of await admins(p.id)) {
        await send(a.telegram_chat_id, `🔔 <b>${esc(nameOf(p))}</b> asked for a portfolio review.${q}`, `member-${p.id}`);
      }
      return Response.json({ ok: true });
    }
    if (table === "updates") {
      const { data: u } = await db.from("updates").update({ notified_at: new Date().toISOString() })
        .eq("id", id).is("notified_at", null).select().maybeSingle();
      if (!u) return Response.json({ skipped: "already" });
      const { data: people } = await db.from("profiles").select("id, telegram_chat_id").not("telegram_chat_id", "is", null);
      let text: string;
      if (u.kind === "urgent") {
        const zone = u.buy_low || u.buy_high ? `\nBid zone: ${u.buy_low ?? "…"} – ${u.buy_high ?? "…"} USD` : "";
        text = `⚡ <b>Urgent bid from ${REVIEWER}</b>\n\n<b>${esc(u.title)}</b>${zone}${u.body ? `\n\n${esc(cut(u.body, 400))}` : ""}\n\nOpen the Desk to see how much your plan suggests.`;
      } else {
        text = `📰 <b>${esc(u.title)}</b>\n\n${esc(cut(u.body || "", 700))}`;
      }
      let sent = 0;
      for (const p of people ?? []) {
        if (p.id === u.author_id) continue;
        if (await send(p.telegram_chat_id, text, "updates")) sent++;
        await new Promise((r) => setTimeout(r, 40)); // stay under Telegram's rate limit
      }
      return Response.json({ ok: true, sent });
    }

    if (table === "price-check") {
      const { data: st } = await db.from("app_settings").select("value").eq("key", "model").maybeSingle();
      const model = st?.value?.version === 2 ? st.value : DEFAULT_MODEL;
      const ids = [...new Set([...(model.fixed ?? []).map((f: any) => f.coin), ...(model.flex ?? []).map((f: any) => f.coin)])];
      if (!ids.length) return Response.json({ skipped: "no coins" });
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(",")}&price_change_percentage=24h,7d`);
      if (!r.ok) return Response.json({ skipped: "coingecko " + r.status });
      const rows = await r.json();
      const { data: seen } = await db.from("app_settings").select("value").eq("key", "drop_alerts").maybeSingle();
      const last: Record<string, string> = seen?.value ?? {};
      const d24 = Number(model.drop24 ?? 15), d7 = Number(model.drop7 ?? 25);
      const hits = rows.filter((c: any) => (c.price_change_percentage_24h ?? 0) <= -d24 || (c.price_change_percentage_7d_in_currency ?? 0) <= -d7)
        .filter((c: any) => !last[c.id] || Date.now() - new Date(last[c.id]).getTime() > 24 * 3600 * 1000);
      if (!hits.length) return Response.json({ ok: true, hits: 0 });
      const pct = (v: number | null) => (v == null ? "n/a" : (v > 0 ? "+" : "") + v.toFixed(1) + "%");
      const lines = hits.map((c: any) => `• <b>${esc(String(c.symbol).toUpperCase())}</b> ${pct(c.price_change_percentage_24h)} 24h, ${pct(c.price_change_percentage_7d_in_currency)} 7d · ${c.current_price}`);
      for (const a of await admins()) {
        await send(a.telegram_chat_id, `📉 <b>Big drop on a model coin</b>\n\n${lines.join("\n")}\n\nMembers see an automatic alert in the Desk. Post an urgent bid if you want them to act.`, "updates");
      }
      for (const c of hits) last[c.id] = new Date().toISOString();
      await db.from("app_settings").upsert({ key: "drop_alerts", value: last, updated_at: new Date().toISOString() });
      return Response.json({ ok: true, hits: hits.length });
    }
    return Response.json({ skipped: "unknown table" });
  } catch (e) {
    console.log("tg-notify error", String(e));
    return Response.json({ error: "failed" }, { status: 500 });
  }
});
