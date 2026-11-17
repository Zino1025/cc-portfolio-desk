// tg-link: links a signed-in member to their Telegram chat.
// The app sends Telegram's signed initData; we verify the signature with the bot
// token, verify the member's Supabase session, then store their Telegram user id.
import { createClient } from "npm:@supabase/supabase-js@2";

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
    const { initData } = await req.json();
    const tgUser = await verifyInitData(String(initData || ""));
    if (!tgUser?.id) return json({ error: "invalid telegram data" }, 400);

    const { data: me } = await db.from("profiles").select("telegram_handle").eq("id", auth.user.id).single();
    const patch: Record<string, unknown> = { telegram_chat_id: tgUser.id };
    if (!me?.telegram_handle && tgUser.username) patch.telegram_handle = tgUser.username;
    const { error } = await db.from("profiles").update(patch).eq("id", auth.user.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
