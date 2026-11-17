// CC Portfolio Desk — screenshot import
// Reads portfolio screenshots (CoinGecko, CMC, exchanges, wallets, notes…) with Claude
// and returns the holdings it sees. Coin matching + saving happens in the app, after the
// member confirms everything.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   required — from platform.claude.com (Console org linked to your Max plan)
//   ANTHROPIC_MODEL     optional — defaults to claude-haiku-5-5
//   IMPORT_DAILY_LIMIT  optional — imports per member per day (default 20; admins unlimited)
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MAX_IMAGES = 10;
const MAX_IMAGE_B64 = 3_000_000; // ~2.2 MB per image chunk

const SYSTEM = `You read screenshots of crypto portfolios and list the holdings in them.
Screenshots can come from CoinGecko, CoinMarketCap, exchanges (Binance, Bybit, MEXC, OKX, Coinbase…),
wallets (MetaMask, Phantom, Trust Wallet…), spreadsheets or plain notes.
Several images may be slices of one long screenshot (they overlap) or several screenshots of the same
portfolio: list each coin once. Never add up the same row seen twice in overlapping slices.

For each coin:
- quantity = number of coins/tokens held (NOT the dollar value). If only the USD value and the price are
  visible, set quantity to null and fill value and current price instead.
- avg_buy_price = average buy / entry / cost price per coin, only if the screenshot shows it. If it only
  shows total cost, put that in total_cost. Never guess a buy price.
- current_price = price per coin shown in the screenshot, if any.
- coingecko_id_guess = the CoinGecko API id you believe this coin has (e.g. "bitcoin", "ethereum",
  "solana", "pepe"), or null if unsure. Small caps: only guess when confident.
- Copy symbol and name exactly as shown (symbol without "$").
Skip fiat cash balances (USD, EUR…) but keep stablecoins (USDT, USDC…). Skip rows whose amount is 0.
Numbers: plain numbers, no commas or currency signs. Expand K/M/B suffixes (1.2K → 1200).
TRANSACTION HISTORY: if the screenshot lists individual buys/sells with dates (e.g. a CoinGecko coin's
transaction list), put each row in "trades" instead of "holdings" and leave holdings empty. Per trade:
side (buy/sell), quantity of coins, total_amount + total_currency (the amount paid/received shown for that
row and its currency: "USD" for $ amounts, or the crypto's symbol such as "ETH" if it shows e.g. 0.05 ETH),
price_usd only if a per-coin dollar price is shown, date as YYYY-MM-DD. Never convert currencies yourself. Use the coin named in the page header for every row.
If the image isn't a portfolio, holdings list or transaction history, return nothing and say so in warnings.
Always answer by calling the report_holdings tool.`;

const TOOL = {
  name: "report_holdings",
  description: "Report the holdings visible in the screenshots.",
  input_schema: {
    type: "object",
    properties: {
      source_app: { type: "string", description: "App or site the screenshot is from, e.g. CoinGecko, Binance, Phantom, Unknown" },
      currency: { type: "string", description: "Fiat currency the prices are shown in, e.g. USD, EUR" },
      holdings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: ["string", "null"] },
            symbol: { type: ["string", "null"] },
            quantity: { type: ["number", "null"] },
            avg_buy_price: { type: ["number", "null"] },
            total_cost: { type: ["number", "null"] },
            current_price: { type: ["number", "null"] },
            value: { type: ["number", "null"] },
            coingecko_id_guess: { type: ["string", "null"] },
          },
          required: ["name", "symbol", "quantity", "avg_buy_price", "current_price", "value", "coingecko_id_guess"],
        },
      },
      trades: {
        type: "array",
        description: "Individual transactions, only when the screenshot is a transaction history",
        items: {
          type: "object",
          properties: {
            name: { type: ["string", "null"] },
            symbol: { type: ["string", "null"] },
            side: { type: "string", enum: ["buy", "sell"] },
            quantity: { type: ["number", "null"] },
            total_amount: { type: ["number", "null"] },
            total_currency: { type: ["string", "null"], description: "USD, or crypto symbol like ETH" },
            price_usd: { type: ["number", "null"] },
            date: { type: ["string", "null"], description: "YYYY-MM-DD" },
            coingecko_id_guess: { type: ["string", "null"] },
          },
          required: ["name", "symbol", "side", "quantity", "total_amount", "total_currency", "price_usd", "date", "coingecko_id_guess"],
        },
      },
      warnings: { type: "array", items: { type: "string" }, description: "Anything the member should double-check (blurry rows, cut-off numbers, non-USD prices, hidden balances…)" },
    },
    required: ["source_app", "currency", "holdings", "warnings"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Screenshot import isn't set up yet (missing ANTHROPIC_API_KEY)." }, 500);

  // --- who is calling? (members only; protects your API credit) ---
  const url = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: u, error: uErr } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (uErr || !u?.user) return json({ error: "Please sign in again." }, 401);
  const userId = u.user.id;

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // --- daily limit ---
  const limit = Number(Deno.env.get("IMPORT_DAILY_LIMIT") ?? 20);
  const { data: prof } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (prof?.role !== "admin") {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin.from("screenshot_imports").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
    if ((count ?? 0) >= limit) return json({ error: `You've hit today's limit of ${limit} screenshot imports. Try again tomorrow, or add trades by hand.` }, 429);
  }

  // --- validate input ---
  let body: { images?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const images = Array.isArray(body.images) ? body.images : [];
  if (!images.length) return json({ error: "No screenshot received." }, 400);
  if (images.length > MAX_IMAGES) return json({ error: `Too many images (max ${MAX_IMAGES}). Send fewer screenshots.` }, 400);
  for (const img of images) {
    if (typeof img !== "string" || img.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(img.slice(0, 200))) {
      return json({ error: "One of the images couldn't be read. Try a normal screenshot (PNG or JPG)." }, 400);
    }
  }

  // --- ask Claude ---
  const content = [
    ...images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
    { type: "text", text: images.length > 1 ? `These ${images.length} images are slices/screenshots of one member's portfolio. List every holding once.` : "List the holdings in this screenshot." },
  ];
  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-5-5",
        max_tokens: 4000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "report_holdings" },
        messages: [{ role: "user", content }],
      }),
    });
  } catch (e) {
    return json({ error: "Couldn't reach the screenshot reader. Try again in a minute." }, 502);
  }
  const out = await r.json().catch(() => null);
  if (!r.ok) {
    console.error("Anthropic error", r.status, JSON.stringify(out));
    const msg = out?.error?.message || "";
    if (r.status === 401) return json({ error: "Screenshot import is misconfigured (the API key is invalid). Tell the admin." }, 503);
    if (/credit|billing|balance/i.test(msg)) return json({ error: "Screenshot import is paused (out of API credit). Tell the admin, or add trades by hand." }, 503);
    return json({ error: "The screenshot reader had a problem. Try again, or add trades by hand." }, 502);
  }
  const tool = out?.content?.find((c: { type: string }) => c.type === "tool_use");
  const result = tool?.input ?? { source_app: "Unknown", currency: "USD", holdings: [], warnings: ["Couldn't read this screenshot."] };

  // --- clean up numbers ---
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  result.holdings = (Array.isArray(result.holdings) ? result.holdings : [])
    .map((h: Record<string, unknown>) => {
      const quantity = n(h.quantity), value = n(h.value), current_price = n(h.current_price);
      let avg = n(h.avg_buy_price);
      const totalCost = n(h.total_cost);
      const qty = quantity ?? (value && current_price ? value / current_price : null);
      if (avg == null && totalCost && qty) avg = totalCost / qty;
      return {
        name: typeof h.name === "string" ? h.name.slice(0, 80) : null,
        symbol: typeof h.symbol === "string" ? h.symbol.replace(/^\$/, "").slice(0, 20) : null,
        quantity: qty,
        quantity_estimated: quantity == null && qty != null,
        avg_buy_price: avg,
        current_price,
        value,
        coingecko_id_guess: typeof h.coingecko_id_guess === "string" ? h.coingecko_id_guess.toLowerCase().slice(0, 80) : null,
      };
    })
    .filter((h: { name: string | null; symbol: string | null }) => h.name || h.symbol);

  result.trades = (Array.isArray(result.trades) ? result.trades : [])
    .map((t: Record<string, unknown>) => {
      const quantity = n(t.quantity), amount = n(t.total_amount);
      const cur = String(t.total_currency || "USD").toUpperCase().replace(/[^A-Z0-9]/g, "") || "USD";
      const isUsd = cur === "USD" || cur === "US";
      const total = isUsd ? amount : null;
      const price = n(t.price_usd) ?? (total != null && quantity ? total / quantity : null);
      const paid = !isUsd && amount != null ? { amount, currency: cur.slice(0, 12) } : null;
      const date = typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null;
      return {
        name: typeof t.name === "string" ? t.name.slice(0, 80) : null,
        symbol: typeof t.symbol === "string" ? t.symbol.replace(/^\$/, "").slice(0, 20) : null,
        side: t.side === "sell" ? "sell" : "buy",
        quantity, total_usd: total, price_usd: price, paid, date,
        coingecko_id_guess: typeof t.coingecko_id_guess === "string" ? t.coingecko_id_guess.toLowerCase().slice(0, 80) : null,
      };
    })
    .filter((t: { quantity: number | null; name: string | null; symbol: string | null }) => t.quantity && (t.name || t.symbol));

  await admin.from("screenshot_imports").insert({
    user_id: userId,
    images: images.length,
    coins: result.holdings.length + result.trades.length,
    source_app: String(result.source_app || "").slice(0, 60),
    input_tokens: out?.usage?.input_tokens ?? null,
    output_tokens: out?.usage?.output_tokens ?? null,
  });

  return json(result);
});
