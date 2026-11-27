// tg-notify: sends Telegram messages for new feedback/messages, review requests, bug/idea tickets (new -> ticket admins, done -> the reporter),
// market updates, and Signals (new signal + analyst updates -> Signals/Both members, Signals Admins and admins, incl. the poster as a receipt).
// "fill-check" (cron, every 5 min): Waiting signals whose limit/zone price was reached get an "entry" update (-> Active + ping).
// "sell-check" (cron, every 5 min): exit-plan step pings + 5x spike pings for members with Sell pings on.
// "tp-check" (hourly cron): CC group membership re-check + digest of sign-ups waiting for approval.
// Called by a database trigger with {table, id}. It re-reads the row and marks it
// notified, so calling it again never sends duplicates. Requests without the x-notify-secret header are refused.
// Every ping also goes out as an app notification (Web Push) to the member's installed Desk; members can mute Telegram (profiles.tg_mute).
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import webpush from "npm:web-push@3.6.7";

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

const VAPID = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
if (VAPID) webpush.setVapidDetails(APP, "BHo2b77LHnbBLsvk-yPenB38gtjb8bdW9XqV46evxka2FQqOB4e2rNyRxNaaoAO53_Sdh-gRlUNQ8W8mCKs7VO4", VAPID);
// App notification: first line = title, the rest = body (HTML stripped). Dead subscriptions are removed.
async function push(subs: any[], text: string, go: string) {
  if (!VAPID || !subs.length) return;
  const plain = text.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const [title, ...rest] = plain.split("\n");
  const payload = JSON.stringify({ title, body: cut(rest.join("\n").trim().replace(/\n{2,}/g, "\n"), 180), go });
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(s.sub, payload, { TTL: 86400, urgency: "high" }); }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subs").delete().eq("id", s.id); else console.log("push error", e?.statusCode, e?.body); }
  }));
}

async function send(chatId: number | string, text: string, go: string) {
  // One Telegram account can be linked to several Desk accounts (e.g. an admin + a test member): push to all of them.
  const { data: ps } = await db.from("profiles").select("tg_mute, push_subs(id, sub)").eq("telegram_chat_id", chatId);
  await push((ps ?? []).flatMap((p) => p.push_subs), text, go);
  if (ps?.length && ps.every((p) => p.tg_mute)) return true;
  const post = () => fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
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
  let r = await post();
  for (let i = 0; r.status === 429 && i < 3; i++) {   // Telegram rate limit (e.g. an admin broadcast to everyone): wait and retry
    const wait = Number((await r.json())?.parameters?.retry_after ?? 2);
    await new Promise((res) => setTimeout(res, (wait + Math.random()) * 1000));
    r = await post();
  }
  if (!r.ok) console.log("telegram error", r.status, await r.text());
  return r.ok;
}

// Send one text to many people: 25 at a time, about 1 batch per second (Telegram allows ~30 msgs/s),
// so 1,000 members take ~40s, well inside the function time limit. One message per Telegram account.
async function broadcast(people: any[], text: string, go: string, exceptId?: string) {
  const chats = [...new Set(people.filter((p) => p.id !== exceptId).map((p) => p.telegram_chat_id))];
  let sent = 0;
  for (let i = 0; i < chats.length; i += 25) {
    const t = Date.now();
    sent += (await Promise.all(chats.slice(i, i + 25).map((c) => send(c, text, go)))).filter(Boolean).length;
    if (i + 25 < chats.length) await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - t))));
  }
  return sent;
}
const fp = (v: number) => "$" + (+Number(v).toPrecision(4)).toLocaleString("en-US", { maximumFractionDigits: 12 });
// Signals: % is measured from the entry (middle of the zone for zone entries).
const sigRef = (s: any) => s.entry_high ? (Number(s.entry_low) + Number(s.entry_high)) / 2 : Number(s.entry_low);
const sigPct = (s: any, p: number) => { const v = (p / sigRef(s) - 1) * 100; return (v > 0 ? "+" : "") + v.toFixed(0) + "%"; };
const SIG_TF: Record<string, string> = { scalp: "Scalp (days)", swing: "Swing (2–8 weeks)", long: "Mid/long term (months)" };
const SIG_OUT: Record<string, string> = { won: "Won", stopped: "Stopped out", early: "Closed early", expired: "Expired" };
// Entry, targets and stop, one per line (new signal + edit pings).
const sigLevels = (s: any) => [
  `Entry: ${s.entry_type === "zone" ? `Zone ${fp(s.entry_low)} – ${fp(s.entry_high)}` : `${s.entry_type === "now" ? "Now" : "Buy limit"} ${fp(s.entry_low)}`}`,
  ...[...s.signal_targets].sort((a: any, b: any) => a.n - b.n).map((t: any) => `TP${t.n}: ${fp(t.price)} (${sigPct(s, t.price)})`),
  s.stop_type === "none" ? "Stop: none, we'll call it" : `${s.stop_type === "close" ? "Invalidation: daily close below" : "Stop:"} ${fp(s.stop_price)} (${sigPct(s, s.stop_price)})`,
].join("\n");
async function signalPeople() {
  const { data } = await db.from("profiles").select("id, telegram_chat_id").not("telegram_chat_id", "is", null)
    .or("role.eq.admin,signals_admin.eq.true,tier.in.(signals,both)");
  return data ?? [];
}

async function admins(exceptId?: string, signalsToo = false) {   // signalsToo: Signals Admins also handle Signals-only members' threads
  const { data } = await db.from("profiles").select("id, telegram_chat_id").or(signalsToo ? "role.eq.admin,signals_admin.eq.true" : "role.eq.admin").not("telegram_chat_id", "is", null);
  return (data ?? []).filter((a) => a.id !== exceptId);
}

// Only our DB triggers and cron jobs know this secret (Vault "tg_notify_secret", read via notify_secret()).
let SECRET = "";
async function authorized(got: string) {
  SECRET ||= (await db.rpc("notify_secret")).data ?? "";
  if (!SECRET || got.length !== SECRET.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ SECRET.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("ok");
    if (!(await authorized(req.headers.get("x-notify-secret") ?? ""))) return new Response("forbidden", { status: 403 });
    const { table, id } = await req.json();
    if (!TOKEN || (!id && !["price-check", "tp-check", "fill-check", "sell-check"].includes(table))) return Response.json({ skipped: true });

    if (table === "messages") {
      // Claim the message (only once).
      const { data: m } = await db.from("messages").update({ notified_at: new Date().toISOString() })
        .eq("id", id).is("notified_at", null).select().maybeSingle();
      if (!m) return Response.json({ skipped: "already" });
      const { data: member } = await db.from("profiles").select("*").eq("id", m.member_id).single();
      const body = m.body ? `\n\n“${esc(cut(m.body))}”` : "";
      if (m.author_id === m.member_id) {
        // Member wrote in their thread -> tell the admins.
        const sigOnly = member?.tier === "signals" && member.role !== "admin" && !member.signals_admin;
        for (const a of await admins(m.author_id, sigOnly)) {
          await send(a.telegram_chat_id, `💬 <b>${esc(nameOf(member))}</b> sent a message:${body}${attNote(m.attachments)}`, sigOnly ? `inbox-${m.member_id}` : `member-${m.member_id}`);
        }
      } else if (member?.telegram_chat_id) {
        // Admin wrote to the member -> tell the member.
        const kind = m.kind === "suggestion" ? "left you a suggestion" : m.kind === "note" ? "sent you a note" : "replied to you";
        await send(member.telegram_chat_id, `📝 <b>${esc(m.author_name || REVIEWER)}</b> ${kind}:${body}${attNote(m.attachments)}`, "feedback");
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
      const text = `🚨 <b>New signal: $${esc(s.symbol)}</b>\n${esc(s.exchange)}${s.risk === "high" ? " · High risk, small allocation" : ""} · ${SIG_TF[s.timeframe]}\n\n${sigLevels(s)}${s.note ? `\n\n${esc(cut(s.note, 600))}` : ""}${attNote(s.attachments)}\n\n${s.analyst_name ? `By ${esc(s.analyst_name)} · ` : ""}Not financial advice. Never go all-in on one signal.`;
      return Response.json({ ok: true, sent: await broadcast(await signalPeople(), text, "signals") });
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
        edit: `✏️ <b>${sym} levels changed</b>\n\n${sigLevels(s)}`,
      }[u.kind as string];
      const text = `${head}${u.body ? `\n\n${esc(cut(u.body, 700))}` : ""}${u.author_name ? `\n\n— ${esc(u.author_name)}` : ""}`;
      return Response.json({ ok: true, sent: await broadcast(await signalPeople(), text, "signals") });
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
    if (table === "fill-check") {
      // Lowest MEXC price since the signal was posted (5m candles); CoinGecko price if MEXC doesn't list it.
      const { data: sigs } = await db.from("signals").select("id, symbol, coin_id, entry_low, entry_high, created_at").eq("status", "waiting");
      let filled = 0;
      for (const s of sigs ?? []) {
        const since = new Date(s.created_at).getTime() - 300000;
        const r = await fetch(`https://api.mexc.com/api/v3/klines?symbol=${s.symbol}USDT&interval=5m&limit=3`);
        const rows = r.ok ? await r.json() : [];
        let low = Math.min(...(Array.isArray(rows) ? rows : []).filter((k: any[]) => k[0] >= since).map((k: any[]) => Number(k[3])));
        if (!Number.isFinite(low) && s.coin_id) {
          const g = await fetch(`https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=${s.coin_id}`);
          low = Number((g.ok ? await g.json() : {})[s.coin_id]?.usd);
        }
        if (!(low > 0) || low > Number(s.entry_high ?? s.entry_low)) continue;
        await db.from("signal_updates").insert({ signal_id: s.id, kind: "entry" });   // triggers set Active and ping members
        filled++;
      }
      return Response.json({ ok: true, filled });
    }
    if (table === "sell-check") {
      // "hi" = highest MEXC price in the last 10 min (5m candles), so a spike between checks still counts.
      const { data: ps } = await db.from("profiles").select("id, telegram_chat_id, exit_plan, tp_pinged").eq("tp_alerts", true).not("telegram_chat_id", "is", null);
      const { data: held } = await db.rpc("held_coins");
      const holds = new Set((held ?? []).map((h: any) => `${h.user_id}:${h.coin_id}`));
      const ids = [...new Set([...(ps ?? []).flatMap((p) => Object.keys(p.exit_plan?.coins ?? {})), ...(held ?? []).map((h: any) => h.coin_id)])];
      if (!ids.length || !ps?.length) return Response.json({ ok: true, pings: 0 });
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(",")}&price_change_percentage=24h&per_page=250`);
      const mk: Record<string, any> = Object.fromEntries((r.ok ? await r.json() : []).map((c: any) => [c.id, c]));
      for (const c of Object.values<any>(mk)) {
        const k = await fetch(`https://api.mexc.com/api/v3/klines?symbol=${String(c.symbol).toUpperCase()}USDT&interval=5m&limit=2`);
        const rows = k.ok ? await k.json() : [];
        c.hi = Math.max(c.current_price, ...(Array.isArray(rows) ? rows : []).map((x: any[]) => Number(x[2])).filter((h) => h < c.current_price * 2));   // guard: a different coin with the same MEXC ticker
        const ago = c.current_price / (1 + (c.price_change_percentage_24h ?? 0) / 100);
        c.spike = ago > 0 ? c.hi / ago : 0;   // x vs 24h ago
      }
      const { data: seen } = await db.from("app_settings").select("value").eq("key", "spike_alerts").maybeSingle();
      const spiked: Record<string, string> = seen?.value ?? {};
      const fresh = Object.values<any>(mk).filter((c) => c.spike >= 5 && (!spiked[c.id] || Date.now() - new Date(spiked[c.id]).getTime() > 24 * 3600 * 1000));
      let pings = 0;
      for (const p of ps) {
        const done = p.tp_pinged ?? {}, lines: string[] = [];
        for (const [id, cp] of Object.entries<any>(p.exit_plan?.coins ?? {})) {
          const c = mk[id]; if (!c) continue;
          (cp.steps ?? []).forEach((st: any, i: number) => {
            const at = Number(st.at), k = `${id}:${i}:${at}`;
            if (!(at > 0) || c.hi < at || done[k]) return;
            done[k] = new Date().toISOString();
            lines.push(`• <b>${esc(String(c.symbol).toUpperCase())}</b> hit ${fp(at)}${c.current_price < at ? ` (now ${fp(c.current_price)})` : ""}. Step ${i + 1}: sell ${Number(st.pct)}%`);
          });
        }
        const sp = fresh.filter((c) => holds.has(`${p.id}:${c.id}`))
          .map((c) => `🚀 <b>${esc(String(c.symbol).toUpperCase())}</b> is up ${c.spike.toFixed(1)}x in 24h (high ${fp(c.hi)}, now ${fp(c.current_price)}). Consider taking profit.`);
        if (!lines.length && !sp.length) continue;
        if (lines.length) await db.from("profiles").update({ tp_pinged: done }).eq("id", p.id);
        const text = [lines.length ? `🎯 <b>Your exit plan says sell</b>\n\n${lines.join("\n")}\n\nStick to the plan.` : "", ...sp].filter(Boolean).join("\n\n");
        if (await send(p.telegram_chat_id, text, "exit")) pings++;
      }
      if (fresh.length) {
        for (const c of fresh) spiked[c.id] = new Date().toISOString();
        await db.from("app_settings").upsert({ key: "spike_alerts", value: spiked, updated_at: new Date().toISOString() });
      }
      return Response.json({ ok: true, pings, spikes: fresh.length });
    }
    if (table === "tp-check") {
      // Re-check CC group membership, so people who left lose access.
      const { data: grp } = await db.from("app_settings").select("value").eq("key", "cc_group").maybeSingle();
      let changed = 0;
      if (grp?.value?.id) {
        const { data: mem } = await db.from("profiles").select("id, telegram_chat_id, in_group").eq("role", "member").not("telegram_chat_id", "is", null);
        const check = async (m: any) => {
          const r = await (await fetch(`https://api.telegram.org/bot${TOKEN}/getChatMember?chat_id=${grp.value.id}&user_id=${m.telegram_chat_id}`)).json();
          if (!r.ok) return;
          const inG = ["creator", "administrator", "member"].includes(r.result.status) || !!r.result.is_member;
          if (inG !== m.in_group) { await db.from("profiles").update({ in_group: inG, group_checked_at: new Date().toISOString() }).eq("id", m.id); changed++; }
        };
        for (let i = 0; i < (mem ?? []).length; i += 20) {   // 20 at a time, ~1 batch per second
          await Promise.all(mem!.slice(i, i + 20).map(check));
          await new Promise((res) => setTimeout(res, 1000));
        }
      }
      // New sign-ups still waiting (not in the group, not approved): one digest to admins, each person once.
      const { data: wait } = await db.from("profiles").select("id, display_name, telegram_handle").eq("role", "member").eq("approved", false)
        .eq("signals_admin", false).eq("tier", "elite").or("in_group.is.null,in_group.eq.false").is("pending_pinged_at", null)
        .lt("created_at", new Date(Date.now() - 600000).toISOString());
      if (wait?.length) {
        const text = `🕓 <b>${wait.length === 1 ? "1 person is" : `${wait.length} people are`} waiting for approval</b>\n\n${wait.slice(0, 20).map((p) => `• ${esc(nameOf(p))}`).join("\n")}${wait.length > 20 ? "\n…" : ""}\n\nApprove them in their member page.`;
        for (const a of await admins()) await send(a.telegram_chat_id, text, "members");
        await db.from("profiles").update({ pending_pinged_at: new Date().toISOString() }).in("id", wait.map((p) => p.id));
      }
      return Response.json({ ok: true, changed, waiting: wait?.length ?? 0 });
    }
    return Response.json({ skipped: "unknown table" });
  } catch (e) {
    console.log("tg-notify error", String(e));
    return Response.json({ error: "failed" }, { status: 500 });
  }
});
