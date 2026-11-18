/* ===================== CHARTS ===================== */
if (window.Chart) Chart.defaults.font.family = '"Inter Tight", Inter, system-ui, sans-serif';
function renderDonut(canvasId, holdings, totalLabel, totalValue) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); delete S.charts[canvasId]; }
  const top = holdings.slice(0, 7);
  const rest = holdings.slice(7);
  const slices = top.map((h, i) => ({ label: (h.symbol || h.name || h.coin_id).toUpperCase(), name: h.name, value: h.value, alloc: h.alloc, color: cssVar(SERIES[i]) }));
  if (rest.length) slices.push({ label: "Other", name: `${rest.length} more coins`, value: rest.reduce((s, h) => s + h.value, 0), alloc: rest.reduce((s, h) => s + h.alloc, 0), color: cssVar("--other") });
  S.charts[canvasId] = new Chart(el, {
    type: "doughnut",
    data: { labels: slices.map(s => s.label), datasets: [{ data: slices.map(s => s.value), backgroundColor: slices.map(s => s.color), borderColor: cssVar("--surface-1"), borderWidth: 3, hoverOffset: 4, borderRadius: 6 }] },
    options: {
      cutout: "74%", layout: { padding: 4 }, maintainAspectRatio: false, animation: { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: cssVar("--text-primary"), titleColor: cssVar("--surface-1"), bodyColor: cssVar("--surface-1"), padding: 10, displayColors: false,
        callbacks: { title: (it) => slices[it[0].dataIndex].label, label: (it) => `${fmtUsd(slices[it.dataIndex].value)} · ${slices[it.dataIndex].alloc.toFixed(1)}%` } } },
    },
  });
  const center = el.parentElement.querySelector(".chart-center");
  if (center) center.innerHTML = `<div><div class="v num">${fmtUsd(totalValue, { compact: true })}</div><div class="l">${esc(totalLabel)}</div></div>`;
  const legend = document.getElementById(canvasId + "-legend");
  if (legend) legend.innerHTML = slices.map(s => `<div class="li"><span class="swatch" style="background:${s.color}"></span><span class="n" title="${esc(s.name || s.label)}">${esc(s.label)}</span><span class="p num">${s.alloc.toFixed(1)}%</span></div>`).join("");
}
function donutCard(id, title) {
  return `<div class="card"><h2>${esc(title)}</h2><div class="chart-box"><canvas id="${id}" role="img" aria-label="${esc(title)} pie chart"></canvas><div class="chart-center"></div></div><div class="legend" id="${id}-legend"></div></div>`;
}


/* ===================== DELTA-STYLE CHARTS ===================== */
// Longest range starts July 2023 so the run-up to CC's start (Nov 2023) and everything since is visible.
const SINCE_JUL23 = Math.ceil((Date.now() - Date.UTC(2023, 6, 1)) / 864e5);
const HIST_PERIODS = [[7, "7D"], [30, "1M"], [90, "3M"], [365, "1Y"], [SINCE_JUL23, "3Y"]];
CG.hist = {};
/* Price history for charts: exchange candles first (Coinbase for BTC/ETH, MEXC via our Supabase "prices"
   function for the alts), CoinGecko as the fallback. Returns [[timeMs, price], ...] oldest first. */
const EXCHANGE_CHART = {
  CB: { bitcoin: "BTC-USD", ethereum: "ETH-USD" },
  async coinbase(id, days) {
    const gran = days <= 1 ? 300 : days <= 7 ? 3600 : days <= 30 ? 21600 : 86400;
    const end = Date.now(), start = end - days * 864e5, step = 300 * gran * 1000, out = [];
    for (let to = end; to > start; to -= step) {   // Coinbase returns max 300 candles per call
      const from = Math.max(start, to - step);
      const r = await fetch(`https://api.exchange.coinbase.com/products/${this.CB[id]}/candles?granularity=${gran}&start=${new Date(from).toISOString()}&end=${new Date(to).toISOString()}`);
      if (!r.ok) throw new Error("Coinbase " + r.status);
      for (const c of await r.json()) out.push([c[0] * 1000, +c[4]]);   // [time, low, high, open, close, volume]
    }
    return out;
  },
  async mexc(id, days) {
    if (api.demo || !sb) throw new Error("no relay");
    const [interval, limit] = days <= 1 ? ["15m", 96] : days <= 7 ? ["60m", 168] : days <= 30 ? ["4h", 180] : days <= 90 ? ["1d", 90] : ["1d", Math.min(1000, Math.ceil(days))];
    const { data, error } = await sb.functions.invoke("prices", { body: { klines: { symbol: symOf(id), interval, limit } } });
    if (error || !data || !Array.isArray(data.prices)) throw error || new Error("no candles");
    const pts = data.prices, last = pts.length && pts[pts.length - 1][1], ref = CG.info(id)?.cgPrice;
    // Same-token check: model coins are verified; anything else must sit within 30% of CoinGecko's price.
    if (!modelCoinIds().includes(id) && !(ref && last && Math.abs(last / ref - 1) <= 0.3)) throw new Error("unverified ticker");
    return pts;
  },
};
CG.chart = async function (id, days) {
  const k = id + ":" + days, c = this.hist[k];
  if (c && Date.now() - c.at < (days <= 1 ? 2 : 10) * 60000) return c.prices;
  let prices = null, src = null;
  try {
    if (EXCHANGE_CHART.CB[id]) { prices = await EXCHANGE_CHART.coinbase(id, days); src = "Coinbase"; }
    else if (!STABLE_IDS.includes(id)) { prices = await EXCHANGE_CHART.mexc(id, days); src = "MEXC"; }
  } catch (e) { prices = null; }
  if (prices) prices = prices.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0).sort((a, b) => a[0] - b[0]);
  if (!prices || prices.length < 2) {
    const d = await this.get(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`);
    prices = (d.prices || []).filter(p => Number.isFinite(p[1])); src = "CoinGecko";
  }
  this.hist[k] = { prices, at: Date.now(), src };
  return prices;
};
CG.chartSrc = function (id, days) { return this.hist[id + ":" + days]?.src || ""; };
function rgba(hex, a) {
  const h = String(hex).trim().replace("#", "");
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
const signed = (v) => (num(v) > 0 ? "+" : "") + fmtUsd(v);
const arrow = (v) => num(v) > 0 ? "▲" : num(v) < 0 ? "▼" : "";
/** Portfolio value and money invested over the last `days`, from trades + CoinGecko price history. */
async function portfolioHistory(txs, days) {
  const sorted = [...txs].sort((a, b) => new Date(a.executed_at) - new Date(b.executed_at));
  if (!sorted.length) return null;
  const now = Date.now();
  const from = Math.max(now - days * 864e5, new Date(sorted[0].executed_at).getTime());
  const cur = computePortfolio(txs);
  const val = (id) => cur.holdings.find(h => h.coin_id === id)?.value || 0;
  const ids = [...new Set(sorted.map(t => t.coin_id))].sort((a, b) => val(b) - val(a)).slice(0, 12);
  const series = {}; let ok = 0;
  for (const id of ids) { try { series[id] = await CG.chart(id, days); if (series[id].length) ok++; } catch (e) {} }
  if (!ok) return null;
  const priceAt = (id, t, fallback) => {
    const s = series[id];
    if (!s || !s.length) return CG.info(id)?.price ?? fallback;
    let lo = 0, hi = s.length - 1;
    if (t <= s[0][0]) return s[0][1];
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m][0] <= t) lo = m; else hi = m - 1; }
    return s[lo][1];
  };
  const N = 90, pos = {}, pts = []; let j = 0;
  for (let i = 0; i < N; i++) {
    const t = from + (now - from) * i / (N - 1);
    while (j < sorted.length && new Date(sorted[j].executed_at).getTime() <= t) {
      const x = sorted[j++], h = pos[x.coin_id] ||= { qty: 0, cost: 0, last: 0 };
      const q = num(x.quantity), pr = num(x.price_usd), fee = num(x.fee_usd); h.last = pr;
      if (x.side === "buy") { h.qty += q; h.cost += q * pr + fee; }
      else { const sq = Math.min(q, h.qty), avg = h.qty > 0 ? h.cost / h.qty : 0; h.cost -= sq * avg; h.qty -= sq; if (h.qty < 1e-12) { h.qty = 0; h.cost = 0; } }
    }
    let value = 0, invested = 0;
    for (const [id, h] of Object.entries(pos)) { if (h.qty <= 0) continue; value += h.qty * priceAt(id, t, h.last); invested += h.cost; }
    pts.push({ t, value, invested });
  }
  return pts;
}
function heroCard(pf, chartId = "hero") {
  const t = pf.totals, days = S.histDays || 30;
  return `<div class="card hero">
    <div class="hero-head"><div><div class="label">Portfolio value</div><div class="big num">${fmtUsd(t.value)}</div>
      <div class="chg"><span class="pill ${signCls(t.change24Pct)}">${arrow(t.change24Pct)} ${fmtPct(t.change24Pct)}</span><span class="num ${signCls(t.change24Usd)}">${signed(t.change24Usd)}</span><span>today</span></div></div>
      <div class="periods" data-hero="${chartId}">${HIST_PERIODS.map(([d, l]) => `<button data-d="${d}" class="${d === days ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="hero-chart" id="${chartId}-chart"></div>
    <div class="hero-key"><span><i style="background:var(--good)" id="${chartId}-key"></i>Value</span><span><i style="background:repeating-linear-gradient(90deg,var(--text-muted) 0 4px,transparent 4px 7px)"></i>Invested</span><span style="margin-left:auto" class="num" id="${chartId}-period"></span></div>
    <div class="hero-stats">
      <div><div class="l">Invested</div><div class="v num">${fmtUsd(t.cost)}</div></div>
      <div><div class="l">Unrealized P&amp;L</div><div class="v num ${signCls(t.pnl)}">${signed(t.pnl)}</div><div class="s num ${signCls(t.pnl)}">${fmtPct(t.pnlPct)}</div></div>
      <div><div class="l">Realized P&amp;L</div><div class="v num ${signCls(t.realized)}">${signed(t.realized)}</div></div>
    </div></div>`;
}
async function paintHero(txs, chartId = "hero") {
  const box = document.getElementById(chartId + "-chart"); if (!box) return;
  const days = S.histDays || 30, tok = (S.heroTok = (S.heroTok || 0) + 1);
  document.querySelectorAll(`[data-hero="${chartId}"] button`).forEach(b => b.onclick = () => {
    S.histDays = +b.dataset.d;
    b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    paintHero(txs, chartId);
  });
  if (!S.charts[chartId]) box.innerHTML = `<div class="note">Loading chart…</div>`;
  const pts = await portfolioHistory(txs, days).catch(() => null);
  if (pts && pts.length) { const live = computePortfolio(txs).totals.value; if (live > 0) pts[pts.length - 1] = { ...pts[pts.length - 1], t: Date.now(), value: live }; }   // end on the live value shown above
  if (tok !== S.heroTok || !document.body.contains(box)) return;
  if (S.charts[chartId]) { S.charts[chartId].destroy(); delete S.charts[chartId]; }
  const per = document.getElementById(chartId + "-period");
  if (!pts || pts.length < 2) { box.innerHTML = `<div class="note">${CG.offline ? "The chart needs live CoinGecko prices. Try again in a minute." : "Not enough price history yet."}</div>`; if (per) per.textContent = ""; return; }
  box.innerHTML = `<canvas id="${chartId}-cv" role="img" aria-label="Portfolio value over time"></canvas>`;
  const a = pts[0], z = pts[pts.length - 1];
  const gain = (z.value - z.invested) - (a.value - a.invested);
  const base = a.value + Math.max(0, z.invested - a.invested);
  const label = HIST_PERIODS.find(x => x[0] === days)?.[1] || "";
  if (per) per.innerHTML = `<span class="${signCls(gain)}">${signed(gain)}${base > 0 ? ` (${fmtPct(gain / base * 100)})` : ""}</span> · ${label}`;
  const col = cssVar(gain < 0 ? "--bad" : "--good"), muted = cssVar("--text-muted");
  const key = document.getElementById(chartId + "-key"); if (key) key.style.background = col;
  const fmtT = (t) => new Date(t).toLocaleString(undefined, days <= 7 ? { month: "short", day: "numeric", hour: "numeric" } : { month: "short", day: "numeric", year: days > 90 ? "2-digit" : undefined });
  S.charts[chartId] = new Chart(document.getElementById(chartId + "-cv"), {
    type: "line", plugins: [lastTagPlugin],
    data: { labels: pts.map(p => p.t), datasets: [
      { data: pts.map(p => p.value), borderColor: col, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: col, tension: 0.35, fill: true,
        backgroundColor: (c) => { const ca = c.chart.chartArea; if (!ca) return "transparent"; const g = c.chart.ctx.createLinearGradient(0, ca.top, 0, ca.bottom); g.addColorStop(0, rgba(col, 0.32)); g.addColorStop(1, rgba(col, 0)); return g; } },
      { data: pts.map(p => p.invested), borderColor: muted, borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, pointHoverRadius: 0, tension: 0, fill: false, stepped: true },
    ] },
    options: {
      maintainAspectRatio: false, animation: { duration: 400 }, interaction: { mode: "index", intersect: false }, events: TAP_EVENTS,
      layout: { padding: { left: 2, right: 2, top: 8 } },
      scales: readableScales(pts.map(p => p.t), days, compactUsd),
      plugins: { legend: { display: false }, lastTag: { color: col, text: (v) => fmtUsd(v, { compact: true }) }, tooltip: { backgroundColor: cssVar("--text-primary"), titleColor: cssVar("--surface-1"), bodyColor: cssVar("--surface-1"), padding: 10, displayColors: false,
        callbacks: { title: (it) => fmtT(pts[it[0].dataIndex].t), label: (it) => (it.datasetIndex ? "Invested " : "Value ") + fmtUsd(it.raw) } } },
    },
  });
}
/* ---------- LIVE PRICES: Coinbase (BTC, ETH) + MEXC via Supabase (alts), CoinGecko as fallback ---------- */
const LIVE = {
  CB: { "BTC-USD": "bitcoin", "ETH-USD": "ethereum" },
  ws: null, wsRetry: 0, altTimer: null, altOff: 0, listeners: new Set(),
  /** Store a live price, skipping it if it disagrees wildly with CoinGecko (a different token with the same ticker). */
  set(id, price, change24, src) {
    if (!Number.isFinite(price) || price <= 0) return;
    const c = CG.cache[id] || {};
    if (src === "MEXC" && (!c.cgPrice || Math.abs(price / c.cgPrice - 1) > 0.3)) return;   // need CoinGecko's price to check it's the same token
    CG.cache[id] = { ...c, price, change24: change24 ?? c.change24, at: Date.now(), liveAt: Date.now(), sample: false, src };
    CG.offline = false;
    this.listeners.forEach(fn => { try { fn(id); } catch (e) {} });
  },
  start() { this.startCoinbase(); this.startAlts(); },
  stop() { try { this.ws && this.ws.close(); } catch (e) {} this.ws = null; clearInterval(this.altTimer); this.altTimer = null; },
  startCoinbase() {
    if (this.ws && this.ws.readyState < 2) return;
    try {
      const ws = new WebSocket("wss://ws-feed.exchange.coinbase.com"); this.ws = ws;
      ws.onopen = () => { this.wsRetry = 0; ws.send(JSON.stringify({ type: "subscribe", product_ids: Object.keys(this.CB), channels: ["ticker"] })); };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch (_) { return; }
        if (m.type !== "ticker" || !this.CB[m.product_id]) return;
        const p = +m.price, open = +m.open_24h;
        this.set(this.CB[m.product_id], p, open > 0 ? (p - open) / open * 100 : null, "Coinbase");
      };
      ws.onclose = () => { if (this.ws === ws) this.ws = null; if (!document.hidden && S.me) setTimeout(() => this.startCoinbase(), Math.min(30000, 2000 * 2 ** this.wsRetry++)); };
      ws.onerror = () => { try { ws.close(); } catch (_) {} };
    } catch (e) {}
  },
  altIds() {
    const ids = new Set([...modelCoinIds(), ...(S.txs || []).map(t => t.coin_id)]);
    Object.values(this.CB).forEach(id => ids.delete(id)); STABLE_IDS.forEach(id => ids.delete(id));
    return [...ids].filter(Boolean);
  },
  async pollAlts() {
    if (api.demo || !sb || document.hidden || Date.now() < this.altOff) return;
    const ids = this.altIds(); if (!ids.length) return;
    const bySym = {}; ids.forEach(id => { const sy = symOf(id); if (sy && sy.length <= 12) (bySym[sy] ||= []).push(id); });
    try {
      const { data, error } = await sb.functions.invoke("prices", { body: { symbols: Object.keys(bySym) } });
      if (error || !data || !data.prices) throw error || new Error("no data");
      for (const [sy, t] of Object.entries(data.prices)) (bySym[sy] || []).forEach(id => this.set(id, t.price, t.change24, "MEXC"));
    } catch (e) { this.altOff = Date.now() + 5 * 60000; }   // function not deployed / MEXC down: CoinGecko only, try again in 5 min
  },
  startAlts() { if (this.altTimer) return; this.pollAlts(); this.altTimer = setInterval(() => this.pollAlts(), 10000); },
};
document.addEventListener("visibilitychange", () => { if (!S.me) return; if (document.hidden) LIVE.stop(); else LIVE.start(); });

/* ---------- Chart helpers: price tag on the last point, readable axes, tap tooltips ---------- */
const lastTagPlugin = {
  id: "lastTag",
  afterDatasetsDraw(chart, args, o) {
    const meta = chart.getDatasetMeta(0), pt = meta && meta.data[meta.data.length - 1]; if (!pt || !o || !o.text) return;
    const { ctx, chartArea: ca } = chart, text = o.text(chart.data.datasets[0].data[meta.data.length - 1]);
    ctx.save(); ctx.font = '600 12px "Inter Tight", system-ui, -apple-system, sans-serif';
    const w = ctx.measureText(text).width + 14, h = 22, x = Math.min(ca.right - w, pt.x - w / 2 > ca.left ? ca.right - w : ca.left), y = Math.max(ca.top, Math.min(ca.bottom - h, pt.y - h / 2));
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); ctx.fillStyle = o.color; ctx.fill();
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y - h - 6 > ca.top ? y - h - 6 : y + 10, w, h, 11); else ctx.rect(x, y - h - 6 > ca.top ? y - h - 6 : y + 10, w, h);
    ctx.fillStyle = o.color; ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(text, x + 7, (y - h - 6 > ca.top ? y - h - 6 : y + 10) + h / 2);
    ctx.restore();
  },
};
const compactUsd = (v) => Math.abs(v) >= 1000 ? "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: Math.abs(v) >= 1e5 ? 0 : 1 }).format(v) : fmtPrice(v);
function readableScales(times, days, yFmt) {
  const fmtX = (t) => new Date(t).toLocaleString(undefined, days <= 1 ? { hour: "numeric", minute: "2-digit" } : days <= 7 ? { weekday: "short" } : days <= 90 ? { month: "short", day: "numeric" } : { month: "short", year: "2-digit" });
  return {
    x: { grid: { display: false }, border: { display: false }, ticks: { color: cssVar("--text-muted"), font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 4, callback: (v, i) => fmtX(times[i]) } },
    y: { position: "right", grace: "8%", grid: { color: cssVar("--grid") }, border: { display: false }, ticks: { color: cssVar("--text-muted"), font: { size: 11 }, maxTicksLimit: 4, callback: yFmt } },
  };
}
const tapTooltip = (title, label) => ({ backgroundColor: cssVar("--text-primary"), titleColor: cssVar("--surface-1"), bodyColor: cssVar("--surface-1"), padding: 10, displayColors: false, callbacks: { title, label } });
const TAP_EVENTS = ["mousemove", "mouseout", "click", "touchstart", "touchmove"];

/* ---------- Price charts: BTC, ETH and the group's coins (live) ---------- */
const PRICE_PERIODS = [[1, "24H"], [7, "7D"], [30, "1M"], [90, "3M"], [365, "1Y"], [SINCE_JUL23, "3Y"]];
function priceChartCoins() { return [...new Set(["bitcoin", "ethereum", ...modelCoinIds()])]; }
function priceChartCard() {
  const coins = priceChartCoins();
  if (!coins.includes(S.pcCoin)) S.pcCoin = coins[0];
  const days = S.pcDays || 1;
  return `<div class="card hero" id="pc-card">
    <div class="chips" id="pc-coins">${coins.map(id => `<button class="chip ${id === S.pcCoin ? "on" : ""}" data-c="${esc(id)}">${esc(symOf(id))}</button>`).join("")}</div>
    <div class="hero-head" style="margin-top:14px"><div><div class="label"><b id="pc-sym" style="color:var(--text-primary)">${esc(symOf(S.pcCoin))}</b> · <span id="pc-live">loading live price…</span></div>
      <div class="big num" id="pc-price">—</div>
      <div class="chg" id="pc-chg"></div></div>
      <div class="periods" id="pc-periods">${PRICE_PERIODS.map(([d, l]) => `<button data-d="${d}" class="${d === days ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="hero-chart" id="pc-chart" style="height:240px"></div>
    <div class="hero-key"><span class="num" id="pc-range"></span><a style="margin-left:auto;color:var(--text-muted)" id="pc-cg" target="_blank" rel="noopener">CoinGecko ↗</a></div>
  </div>`;
}
function pcHeader() {
  const id = S.pcCoin, info = CG.info(id) || {}, el = document.getElementById("pc-price"); if (!el) return;
  const live = info.price != null && !info.sample;
  el.textContent = live ? fmtPrice(info.price) : "—";
  $("#pc-sym").textContent = symOf(id);
  const ago = info.liveAt || info.at; const secs = ago ? Math.max(0, Math.round((Date.now() - ago) / 1000)) : null;
  const src = info.liveAt && Date.now() - info.liveAt < 60000 ? info.src : "CoinGecko";
  $("#pc-live").innerHTML = live ? `<span style="color:var(--good)">● Live</span> · ${esc(src)} · ${secs < 5 ? "just now" : secs < 60 ? secs + "s ago" : Math.round(secs / 60) + "m ago"}` : `<span class="bad">Live price unavailable</span> · retrying`;
  const ch = info.change24;
  const per = S.pcPeriodChg;
  $("#pc-chg").innerHTML = (live && ch != null ? `<span class="pill ${signCls(ch)}">${arrow(ch)} ${fmtPct(ch)}</span><span>24h</span>` : "") +
    (per && (S.pcDays || 1) !== 1 ? `<span class="pill ${signCls(per.chg)}" style="margin-left:6px">${arrow(per.chg)} ${fmtPct(per.chg)}</span><span>${per.label}</span>` : "");
}
function pcPushLive() {
  const id = S.pcCoin, c = S.charts.pc, info = CG.info(id);
  if (c && info && !info.sample && info.price != null) {   // extend the line with the live price
    const ds = c.data.datasets[0], last = c.data.labels[c.data.labels.length - 1];
    if (Date.now() - last > 60000) { c.data.labels.push(Date.now()); ds.data.push(info.price); }
    else { ds.data[ds.data.length - 1] = info.price; c.data.labels[c.data.labels.length - 1] = Date.now(); }
    c.update("none");
  }
  pcHeader();
}
async function pcTick() {   // every 30s: CoinGecko only for coins with no live exchange feed
  const id = S.pcCoin; if (!document.getElementById("pc-card") || document.hidden) return;
  const i = CG.info(id);
  if (!(i && i.liveAt && Date.now() - i.liveAt < 30000)) { try { await CG.live(id); } catch (e) {} }
  if (id === S.pcCoin) pcPushLive();
}
let pcLast = 0;
LIVE.listeners.add((id) => {   // exchange tick → update the open chart, at most once a second
  if (id !== S.pcCoin || !document.getElementById("pc-card")) return;
  const now = Date.now(); if (now - pcLast < 1000) return; pcLast = now; pcPushLive();
});
async function paintPriceChart() {
  const box = document.getElementById("pc-chart"); if (!box) return;
  const id = S.pcCoin, days = S.pcDays || 1, tok = (S.pcTok = (S.pcTok || 0) + 1);
  document.querySelectorAll("#pc-coins [data-c]").forEach(b => { b.classList.toggle("on", b.dataset.c === id); b.onclick = () => { S.pcCoin = b.dataset.c; paintPriceChart(); }; });
  document.querySelectorAll("#pc-periods [data-d]").forEach(b => { b.classList.toggle("on", +b.dataset.d === days); b.onclick = () => { S.pcDays = +b.dataset.d; paintPriceChart(); }; });
  $("#pc-cg").href = coinLink(id);
  S.pcPeriodChg = null; pcHeader();
  clearInterval(S.pcTimer); S.pcTimer = setInterval(pcTick, 30000);
  clearInterval(S.pcAgo); S.pcAgo = setInterval(() => { if (document.getElementById("pc-card")) pcHeader(); else clearInterval(S.pcAgo); }, 1000);
  if (!S.charts.pc) box.innerHTML = `<div class="note">Loading chart…</div>`;
  const fresh = (CG.info(id)?.liveAt || 0) > Date.now() - 30000;
  const [pts] = await Promise.all([CG.chart(id, days).catch(() => null), fresh ? null : CG.live(id).catch(() => null)]);
  if (tok !== S.pcTok || !document.body.contains(box)) return;
  pcHeader();
  if (S.charts.pc) { S.charts.pc.destroy(); delete S.charts.pc; }
  if (!pts || pts.length < 2) { box.innerHTML = `<div class="note">Couldn't load ${esc(symOf(id))} price history right now. Tap the period again in a minute.</div>`; $("#pc-range").textContent = ""; return; }
  const data = pts.map(p => [p[0], p[1]]), info = CG.info(id);
  if (info && !info.sample && info.price != null) data.push([Date.now(), info.price]);   // end on the live price
  const first = data[0][1], last = data[data.length - 1][1], chg = (last - first) / first * 100;
  const lo = Math.min(...data.map(p => p[1])), hi = Math.max(...data.map(p => p[1]));
  S.pcPeriodChg = { chg, label: PRICE_PERIODS.find(x => x[0] === days)?.[1] || "" }; pcHeader();
  $("#pc-range").textContent = `Low ${fmtPrice(lo)} · High ${fmtPrice(hi)} · chart: ${CG.chartSrc(id, days) || "CoinGecko"}`;
  box.innerHTML = `<canvas id="pc-cv" role="img" aria-label="${esc(symOf(id))} price chart"></canvas>`;
  const col = cssVar(chg < 0 ? "--bad" : "--good"), times = data.map(p => p[0]);
  const fmtT = (t) => new Date(t).toLocaleString(undefined, days <= 7 ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" });
  S.charts.pc = new Chart(document.getElementById("pc-cv"), {
    type: "line", plugins: [lastTagPlugin],
    data: { labels: times, datasets: [{ data: data.map(p => p[1]), borderColor: col, borderWidth: 2.2, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: col, tension: 0.2, fill: true,
      backgroundColor: (c) => { const ca = c.chart.chartArea; if (!ca) return "transparent"; const g = c.chart.ctx.createLinearGradient(0, ca.top, 0, ca.bottom); g.addColorStop(0, rgba(col, 0.3)); g.addColorStop(1, rgba(col, 0)); return g; } }] },
    options: {
      maintainAspectRatio: false, animation: { duration: 300 }, interaction: { mode: "index", intersect: false }, events: TAP_EVENTS,
      layout: { padding: { left: 2, right: 2, top: 8 } },
      scales: readableScales(times, days, compactUsd),
      plugins: { legend: { display: false }, lastTag: { color: col, text: (v) => fmtPrice(v) },
        tooltip: tapTooltip((it) => fmtT(S.charts.pc.data.labels[it[0].dataIndex]), (it) => symOf(id) + " " + fmtPrice(it.raw)) },
    },
  });
}
function perfCard(id) {
  return `<div class="card"><div class="card-h"><h2>Performance by coin</h2><span class="sub">P&amp;L vs avg buy</span></div><div class="perf-box" id="${id}-box"><canvas id="${id}" role="img" aria-label="Profit and loss by coin bar chart"></canvas></div></div>`;
}
function renderPerf(id, holdings) {
  const el = document.getElementById(id); if (!el) return;
  if (S.charts[id]) { S.charts[id].destroy(); delete S.charts[id]; }
  const hs = holdings.filter(h => h.cost > 0).slice(0, 10).sort((a, b) => b.pnlPct - a.pnlPct);
  document.getElementById(id + "-box").style.height = Math.max(150, hs.length * 40 + 30) + "px";
  const good = cssVar("--good"), bad = cssVar("--bad");
  S.charts[id] = new Chart(el, {
    type: "bar",
    data: { labels: hs.map(h => (h.symbol || h.coin_id).toUpperCase()), datasets: [{ data: hs.map(h => h.pnlPct), backgroundColor: hs.map(h => rgba(h.pnlPct < 0 ? bad : good, 0.85)), borderRadius: 6, borderSkipped: false, barThickness: 16 }] },
    options: {
      indexAxis: "y", maintainAspectRatio: false, animation: { duration: 300 },
      scales: {
        x: { grid: { color: cssVar("--grid") }, border: { display: false }, ticks: { color: cssVar("--text-muted"), callback: (v) => v + "%" } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: cssVar("--text-primary"), font: { weight: 600 } } },
      },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: cssVar("--text-primary"), titleColor: cssVar("--surface-1"), bodyColor: cssVar("--surface-1"), padding: 10, displayColors: false,
        callbacks: { title: (it) => (hs[it[0].dataIndex].symbol || hs[it[0].dataIndex].coin_id).toUpperCase(), label: (it) => `${fmtPct(hs[it.dataIndex].pnlPct)} · ${signed(hs[it.dataIndex].pnl)}` } } },
    },
  });
}

