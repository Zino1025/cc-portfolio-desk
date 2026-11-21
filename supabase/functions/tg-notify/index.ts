// tg-notify: sends Telegram messages for new feedback/messages, review requests, bug/idea tickets (new -> ticket admins, done -> the reporter),
// market updates, and Signals (new signal + analyst updates -> Signals/Both members, Signals Admins and admins).
// "tp-check" (hourly cron): exit-plan step pings for members who opted in + CC group membership re-check.
// Called by a database trigger with {table, id}. It re-reads the row and marks it
// notified, so calling it again (or by anyone else) never sends duplicates.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

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
const DEFAULT_MODEL = { version: 2, fixed: [{ coin: "tectum" }, { coin: "solidus-aitech" }], flex: [{ coin: "paal-ai" }, { coin: "velo" }, { coin: "octo-gaming" }], drop24: 15, drop7: 25 };
// CoinGecko renamed these ids; a saved model may still use the old ones.
const COIN_ID_RENAMES: Record<string, string> = { "solidus-ai-tech": "solidus-aitech", "octokn": "octo-gaming" };

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (s: string, n = 300) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
// Label attachments by kind, e.g. "🎙️ Voice note attached · 📷 2 photos attached".
const attNote = (a: unknown) => {
  if (!Array.isArray(a) || !a.length) return "";
  const kinds: [RegExp, string, string, string][] = [
    [/^audio/, "🎙️", "Voice note", "voice notes"], [/^video/, "🎬", "Video", "videos"],
    [/^image/, "📷", "Photo", "photos"], [/pdf/, "📄", "PDF", "PDFs"]];
  const parts = kinds.map(([re, ic, one, many]) => {
    const n = a.filter((x: any) => re.test(String(x?.type ?? ""))).length;
    return n ? `${ic} ${n === 1 ? one : n + " " + many} attached` : "";
  }).filter(Boolean);
  return parts.length ? `\n\n${parts.join(" · ")}` : `\n\n📎 File attached`;
};
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

// Send one text to many people, staying under Telegram's rate limit.
async function broadcast(people: any[], text: string, go: string, exceptId?: string) {
  let sent = 0;
  for (const p of people) {
    if (p.id === exceptId) continue;
    if (await send(p.telegram_chat_id, text, go)) sent++;
    await new Promise((r) => setTimeout(r, 40));
  }
  return sent;
}
const fp = (v: number) => "$" + (+Number(v).toPrecision(4)).toLocaleString("en-US", { maximumFractionDigits: 12 });
// Signals: % is measured from the entry (middle of the zone for zone entries).
const sigRef = (s: any) => s.entry_high ? (Number(s.entry_low) + Number(s.entry_high)) / 2 : Number(s.entry_low);
const sigPct = (s: any, p: number) => { const v = (p / sigRef(s) - 1) * 100; return (v > 0 ? "+" : "") + v.toFixed(0) + "%"; };
const SIG_TF: Record<string, string> = { scalp: "Scalp (days)", swing: "Swing (2–8 weeks)", long: "Mid/long term (months)" };
const SIG_OUT: Record<string, string> = { won: "Won", stopped: "Stopped out", early: "Closed early", expired: "Expired" };
async function signalPeople() {
  const { data } = await db.from("profiles").select("id, telegram_chat_id").not("telegram_chat_id", "is", null)
    .or("role.eq.admin,signals_admin.eq.true,tier.in.(signals,both)");
  return data ?? [];
}

async function admins(exceptId?: string) {
  const { data } = await db.from("profiles").select("id, telegram_chat_id").eq("role", "admin").not("telegram_chat_id", "is", null);
  return (data ?? []).filter((a) => a.id !== exceptId);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("ok");
    const { table, id } = await req.json();
    if (!TOKEN || (!id && table !== "price-check" && table !== "tp-check")) return Response.json({ skipped: true });

    if (table === "messages") {
      // Claim the message (only once).
      const { data: m } = await db.from("messages").update({ notified_at: new Date().toISOString() })
        .eq("id", id).is("notified_at", null).select().maybeSingle();
      if (!m) return Response.json({ skipped: "already" });
      const { data: member } = await db.from("profiles").select("*").eq("id", m.member_id).single();
      const body = m.body ? `\n\n“${esc(cut(m.body))}”` : "";
      if (m.author_id === m.member_id) {
        // Member wrote in their thread -> tell the admins.
        for (const a of await admins(m.author_id)) {
          await send(a.telegram_chat_id, `💬 <b>${esc(nameOf(member))}</b> sent a message:${body}${attNote(m.attachments)}`, `member-${m.member_id}`);
        }
      } else if (member?.telegram_chat_id) {
        // Admin wrote to the member -> tell the member.
        const kind = m.kind === "suggestion" ? "left you a suggestion" : m.kind === "note" ? "sent you a note" : "replied to you";
        await send(member.telegram_chat_id, `📝 <b>${REVIEWER}</b> ${kind}:${body}${attNote(m.attachments)}`, "feedback");
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
    if (table === "tickets") {
      const { data: row } = await db.from("tickets").select("status").eq("id", id).maybeSingle();
      if (row?.status === "done") {
        // Marked done -> tell the member who reported it (once).
        const { data: t } = await db.from("tickets").update({ done_notified_at: new Date().toISOString() })
          .eq("id", id).is("done_notified_at", null).select().maybeSingle();
        if (!t) return Response.json({ skipped: "already" });
        const { data: p } = await db.from("profiles").select("telegram_chat_id").eq("id", t.user_id).single();
        if (p?.telegram_chat_id) await send(p.telegram_chat_id, `✅ <b>${t.kind === "idea" ? "Your idea was added" : "Your bug report was fixed"}</b>\n\n“${esc(cut(t.body))}”\n\nThanks for helping improve the Desk.`, "overview");
        return Response.json({ ok: true });
      }
      // New ticket -> only admins with gets_tickets (not every admin).
      const { data: t } = await db.from("tickets").update({ notified_at: new Date().toISOString() })
        .eq("id", id).is("notified_at", null).select().maybeSingle();
      if (!t) return Response.json({ skipped: "already" });
      const { data: p } = await db.from("profiles").select("*").eq("id", t.user_id).single();
      const { data: to } = await db.from("profiles").select("telegram_chat_id").eq("gets_tickets", true).not("telegram_chat_id", "is", null);
      for (const a of to ?? []) await send(a.telegram_chat_id, `${t.kind === "idea" ? "💡 <b>New idea</b>" : "🐞 <b>New bug report</b>"} from <b>${esc(nameOf(p))}</b>\n\n“${esc(cut(t.body, 1500))}”`, "profile");
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
        text = `⚡ <b>Urgent bid from ${REVIEWER}</b>\n\n<b>${esc(u.title)}</b>${zone}${u.body ? `\n\n${esc(cut(u.body, 400))}` : ""}${attNote(u.attachments)}\n\nOpen the Desk to see how much your plan suggests.`;
      } else {
        text = `📰 <b>${esc(u.title)}</b>${u.body ? `\n\n${esc(cut(u.body, 700))}` : ""}${attNote(u.attachments)}`;
      }
      return Response.json({ ok: true, sent: await broadcast(people ?? [], text, "updates", u.author_id) });
    }
    if (table === "signals") {
      const { data: s } = await db.from("signals").update({ notified_at: new Date().toISOString() })
        .eq("id", id).is("notified_at", null).select("*, signal_targets(n, price)").maybeSingle();
      if (!s) return Response.json({ skipped: "already" });
      const entry = s.entry_type === "zone" ? `Zone ${fp(s.entry_low)} – ${fp(s.entry_high)}` : `${s.entry_type === "now" ? "Now" : "Buy limit"} ${fp(s.entry_low)}`;
      const tps = [...s.signal_targets].sort((a: any, b: any) => a.n - b.n).map((t: any) => `TP${t.n}: ${fp(t.price)} (${sigPct(s, t.price)})`).join("\n");
      const stop = s.stop_type === "none" ? "Stop: none, we'll call it" : `${s.stop_type === "close" ? "Invalidation: daily close below" : "Stop:"} ${fp(s.stop_price)} (${sigPct(s, s.stop_price)})`;
      const text = `🚨 <b>New signal: $${esc(s.symbol)}</b>\n${esc(s.exchange)}${s.risk === "high" ? " · High risk, small allocation" : ""} · ${SIG_TF[s.timeframe]}\n\nEntry: ${entry}\n${tps}\n${stop}${s.note ? `\n\n${esc(cut(s.note, 600))}` : ""}${attNote(s.attachments)}\n\n${s.analyst_name ? `By ${esc(s.analyst_name)} · ` : ""}Not financial advice. Never go all-in on one signal.`;
      return Response.json({ ok: true, sent: await broadcast(await signalPeople(), text, "signals", s.analyst_id) });
    }
    if (table === "signal_updates") {
      const { data: u } = await db.from("signal_updates").update({ notified_at: new Date().toISOString() })
        .eq("id", id).is("notified_at", null).select("*, signals(*, signal_targets(n, price))").maybeSingle();
      if (!u) return Response.json({ skipped: "already" });
      const s = u.signals, sym = `$${esc(s.symbol)}`, tp = s.signal_targets.find((t: any) => t.n === u.tp_n);
      const head = {
        entry: `✅ <b>${sym} entry filled</b> at ${fp(s.entry_low)}${s.entry_high ? ` – ${fp(s.entry_high)}` : ""}`,
        tp: `🎯 <b>${sym} TP${u.tp_n} hit</b>${tp ? ` at ${fp(tp.price)} (${sigPct(s, tp.price)})` : ""}`,
        breakeven: `🛡️ <b>${sym}: move your stop to entry</b> (${fp(s.entry_low)})`,
        close: `🏁 <b>${sym} closed: ${SIG_OUT[u.outcome]}</b>`,
        note: `📝 <b>${sym} update</b>`,
      }[u.kind as string];
      const text = `${head}${u.body ? `\n\n${esc(cut(u.body, 700))}` : ""}${u.author_name ? `\n\n— ${esc(u.author_name)}` : ""}`;
      return Response.json({ ok: true, sent: await broadcast(await signalPeople(), text, "signals", u.author_id) });
    }

    if (table === "price-check") {
      const { data: st } = await db.from("app_settings").select("value").eq("key", "model").maybeSingle();
      const model = st?.value?.version === 2 ? st.value : DEFAULT_MODEL;
      const ids = [...new Set([...(model.fixed ?? []).map((f: any) => f.coin), ...(model.flex ?? []).map((f: any) => f.coin)].map((id: string) => COIN_ID_RENAMES[id] ?? id))];
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
    if (table === "tp-check") {
      // 1) Members who opted in: ping when a coin reaches one of their exit-plan steps (each step once).
      const { data: ps } = await db.from("profiles").select("id, telegram_chat_id, exit_plan, tp_pinged").eq("tp_alerts", true).not("telegram_chat_id", "is", null).not("exit_plan", "is", null);
      const ids = [...new Set((ps ?? []).flatMap((p) => Object.keys(p.exit_plan?.coins ?? {})))];
      let pings = 0;
      if (ids.length) {
        const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(",")}`);
        const mk: Record<string, any> = Object.fromEntries((r.ok ? await r.json() : []).map((c: any) => [c.id, c]));
        for (const p of ps ?? []) {
          const done = p.tp_pinged ?? {}, lines: string[] = [];
          for (const [id, cp] of Object.entries<any>(p.exit_plan.coins ?? {})) {
            const c = mk[id]; if (!c) continue;
            (cp.steps ?? []).forEach((st: any, i: number) => {
              const at = Number(st.at), k = `${id}:${i}:${at}`;
              if (!(at > 0) || c.current_price < at || done[k]) return;
              done[k] = new Date().toISOString();
              lines.push(`• <b>${esc(String(c.symbol).toUpperCase())}</b> is at ${fp(c.current_price)}. Step ${i + 1}: sell ${Number(st.pct)}% at ${fp(at)}`);
            });
          }
          if (!lines.length) continue;
          await db.from("profiles").update({ tp_pinged: done }).eq("id", p.id);
          if (await send(p.telegram_chat_id, `🎯 <b>Your exit plan says sell</b>\n\n${lines.join("\n")}\n\nStick to the plan.`, "exit")) pings++;
        }
      }
      // 2) Re-check CC group membership, so people who left lose access.
      const { data: grp } = await db.from("app_settings").select("value").eq("key", "cc_group").maybeSingle();
      let changed = 0;
      if (grp?.value?.id) {
        const { data: mem } = await db.from("profiles").select("id, telegram_chat_id, in_group").eq("role", "member").not("telegram_chat_id", "is", null);
        for (const m of mem ?? []) {
          const r = await (await fetch(`https://api.telegram.org/bot${TOKEN}/getChatMember?chat_id=${grp.value.id}&user_id=${m.telegram_chat_id}`)).json();
          if (!r.ok) continue;
          const inG = ["creator", "administrator", "member"].includes(r.result.status) || !!r.result.is_member;
          if (inG !== m.in_group) { await db.from("profiles").update({ in_group: inG, group_checked_at: new Date().toISOString() }).eq("id", m.id); changed++; }
          await new Promise((res) => setTimeout(res, 40));
        }
      }
      return Response.json({ ok: true, pings, changed });
    }
    return Response.json({ skipped: "unknown table" });
  } catch (e) {
    console.log("tg-notify error", String(e));
    return Response.json({ error: "failed" }, { status: 500 });
  }
});
