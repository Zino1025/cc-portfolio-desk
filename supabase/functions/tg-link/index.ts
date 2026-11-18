// tg-link: links a signed-in member to their Telegram chat.
// The app sends Telegram's signed initData; we verify the signature with the bot
// token, verify the member's Supabase session, then store their Telegram user id.
// Also re-checks CC group membership (once an admin has run /setgroup in the group).
// With { csv | png, filename } it instead sends that file to the member's bot chat
// (Telegram's in-app browser can't download files).
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
function serviceKey() {
  try { const v = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0]; if (v) return String(v); } catch { /* fall back */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), {
  auth: { persistSession: false },
});
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function hmac(key: ArrayBuffer | Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}
const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

async function verifyInitData(initData: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), TOKEN);
  if (hex(await hmac(secret, check)) !== hash) return null;
  const age = Date.now() / 1000 - Number(params.get("auth_date") || 0);
  if (!(age >= 0 && age < 86400)) return null;
  try { return JSON.parse(params.get("user") || "null"); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!TOKEN) return json({ error: "not configured" }, 500);
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(jwt);
    if (!auth?.user) return json({ error: "not signed in" }, 401);
    const { initData, csv, png, filename } = await req.json();
    const tgUser = await verifyInitData(String(initData || ""));
    if (!tgUser?.id) return json({ error: "invalid telegram data" }, 400);
    if (csv || png) {
      if (String(csv || png).length > 8e6) return json({ error: "file too big" }, 413);
      const fd = new FormData(), name = String(filename || "export").replace(/[^\w.-]/g, "") || "export";
      fd.append("chat_id", String(tgUser.id));
      if (png) fd.append("photo", new Blob([Uint8Array.from(atob(String(png)), (c) => c.charCodeAt(0))], { type: "image/png" }), name);
      else fd.append("document", new Blob([String(csv)], { type: "text/csv" }), name);
      const r = await (await fetch(`https://api.telegram.org/bot${TOKEN}/${png ? "sendPhoto" : "sendDocument"}`, { method: "POST", body: fd })).json();
      return r.ok ? json({ ok: true }) : json({ error: r.description || "send failed" }, 502);
    }

    const { data: me } = await db.from("profiles").select("telegram_handle").eq("id", auth.user.id).single();
    const patch: Record<string, unknown> = { telegram_chat_id: tgUser.id };
    if (!me?.telegram_handle && tgUser.username) patch.telegram_handle = tgUser.username;
    const { data: grp } = await db.from("app_settings").select("value").eq("key", "cc_group").maybeSingle();
    if (grp?.value?.id) {
      const r = await (await fetch(`https://api.telegram.org/bot${TOKEN}/getChatMember?chat_id=${grp.value.id}&user_id=${tgUser.id}`)).json();
      if (r.ok) Object.assign(patch, { in_group: ["creator", "administrator", "member"].includes(r.result.status) || !!r.result.is_member, group_checked_at: new Date().toISOString() });
    }
    const { error } = await db.from("profiles").update(patch).eq("id", auth.user.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, in_group: patch.in_group ?? null });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
