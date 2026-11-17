// Supabase Edge Function: "prices"
// Live spot prices for the group's alts straight from MEXC (free, no key).
// The app calls it every ~10 seconds while open. One MEXC request is shared by
// everyone for 5 seconds (in-memory cache), so 250 members ≈ 1 MEXC call / 5s.
//
// Request:  POST { "symbols": ["TET", "ACN", "PAAL"] }   (or GET ?symbols=TET,ACN)
// Response: { "at": 1731850000000, "source": "MEXC", "prices": { "TET": { "price": 1.31, "change24": -2.4, "high24": 1.4, "low24": 1.2 } } }
// Tickers MEXC doesn't list are simply missing from "prices"; the app falls back to CoinGecko for those.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type Tick = { price: number; change24: number | null; high24: number | null; low24: number | null };
let cache: { at: number; map: Map<string, Tick> } = { at: 0, map: new Map() };
let inflight: Promise<void> | null = null;

async function refresh() {
  const r = await fetch("https://api.mexc.com/api/v3/ticker/24hr");
  if (!r.ok) throw new Error("MEXC " + r.status);
  const rows = await r.json();
  const map = new Map<string, Tick>();
  for (const t of rows) {
    const sym = String(t.symbol || "");
    if (!sym.endsWith("USDT")) continue;
    const price = Number(t.lastPrice), open = Number(t.openPrice);
    if (!Number.isFinite(price) || price <= 0) continue;
    map.set(sym.slice(0, -4), {
      price,
      change24: Number.isFinite(open) && open > 0 ? ((price - open) / open) * 100 : null,
      high24: Number(t.highPrice) || null,
      low24: Number(t.lowPrice) || null,
    });
  }
  cache = { at: Date.now(), map };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    let syms: string[] = (new URL(req.url).searchParams.get("symbols") || "").split(",");
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (Array.isArray(b.symbols)) syms = b.symbols;
    }
    syms = [...new Set(syms.map((s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean))].slice(0, 60);

    if (Date.now() - cache.at > 5000) {
      inflight ||= refresh().finally(() => { inflight = null; });
      try { await inflight; } catch (e) { if (!cache.at) throw e; }   // serve slightly stale data if MEXC hiccups
    }
    const prices: Record<string, Tick> = {};
    for (const s of syms) { const t = cache.map.get(s); if (t) prices[s] = t; }
    return new Response(JSON.stringify({ at: cache.at, source: "MEXC", prices }), {
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 502, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
