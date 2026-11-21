// tg-login: "Sign in with Telegram" for the home-screen app (outside the Mini App).
// The app makes a random nonce and opens t.me/CCPortfolioManagerBot?start=login_<nonce>.
// The member taps Approve in the bot (tg-bot writes tg_logins), and the app polls here with the nonce.
// Once approved we hand back a one-time magic-link token_hash; the app swaps it for a session (verifyOtp).
// Nonces are single-use and expire after 10 minutes. No email is sent.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

function serviceKey() {
  try { const v = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0]; if (v) return String(v); } catch { /* fall back */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { nonce } = await req.json();
    if (!/^[a-f0-9]{32}$/.test(nonce || "")) return json({ error: "bad nonce" });
    const cutoff = new Date(Date.now() - 6e5).toISOString();
    // Claim this nonce and sweep expired ones in the same delete.
    const { data } = await db.from("tg_logins").delete().or(`nonce.eq.${nonce},created_at.lt.${cutoff}`).select();
    const row = data?.find((r) => r.nonce === nonce && r.created_at >= cutoff);
    if (!row) return json({ pending: true });
    const { data: u } = await db.auth.admin.getUserById(row.user_id);
    if (!u?.user?.email) return json({ error: "no account" });
    const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
    if (error) throw error;
    return json({ token_hash: link.properties.hashed_token });
  } catch (e) {
    console.log("tg-login error", String(e));
    return json({ error: "failed" });
  }
});
