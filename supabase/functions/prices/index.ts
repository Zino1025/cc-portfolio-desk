// Supabase Edge Function: "prices"
// Live spot prices for the group's alts straight from MEXC (free, no key).
// The app calls it every ~10 seconds while open. One MEXC request is shared by
// everyone for 5 seconds (in-memory cache), so 250 members ≈ 1 MEXC call / 5s.
//
// Request:  POST { "symbols": ["TET", "ACN", "PAAL"] }   (or GET ?symbols=TET,ACN)
// Response: { "at": 1731850000000, "source": "MEXC", "prices": { "TET": { "price": 1.31, "change24": -2.4, "high24": 1.4, "low24": 1.2 } } }
// Tickers MEXC doesn't list are simply missing from "prices"; the app falls back to CoinGecko for those.
//
// Chart candles: POST { "klines": { "symbol": "TET", "interval": "60m", "limit": 168 } }
// Response: { "symbol": "TET", "interval": "60m", "source": "MEXC", "prices": [[openTimeMs, close], ...] }
// Cached 60s per symbol+interval so all members share one MEXC call.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type Tick = { price: number; change24: number | null; high24: number | null; low24: number | null };
let cache: { at: number; map: Map<string, Tick> } = { at: 0, map: new Map() };
let inflight: Promise<void> | null = null;

const INTERVALS = new Set(["1m", "5m", "15m", "30m", "60m", "4h", "1d", "1W"]);
const klineCache = new Map<string, { at: number; prices: [number, number][] }>();
async function klines(symbol: string, interval: string, limit: number) {
  const key = `${symbol}:${interval}:${limit}`, hit = klineCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.prices;
  const r = await fetch(`https://api.mexc.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`);
  if (!r.ok) throw new Error("MEXC " + r.status);
  const rows = await r.json();
  const prices = (Array.isArray(rows) ? rows : []).map((k: unknown[]) => [Number(k[0]), Number(k[4])] as [number, number])
    .filter(([t, c]) => Number.isFinite(t) && Number.isFinite(c) && c > 0);
  if (klineCache.size > 300) klineCache.clear();
  klineCache.set(key, { at: Date.now(), prices });
  return prices;
}

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
      if (b && b.klines) {
        const symbol = String(b.klines.symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
        const interval = String(b.klines.interval || "60m");
        const limit = Math.max(2, Math.min(1000, Number(b.klines.limit) || 200));
        if (!symbol || !INTERVALS.has(interval)) return new Response(JSON.stringify({ error: "bad klines request" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
        const prices = await klines(symbol, interval, limit);
        return new Response(JSON.stringify({ symbol, interval, source: "MEXC", prices }), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }
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
