/* ===================== CHARTS ===================== */
if (window.Chart) Chart.defaults.font.family = '"Inter Tight", Inter, system-ui, sans-serif';
// h.ci (optional) pins a coin's color, so the rewind keeps colors steady as coins come and go. quick = update in place (animation frames).
function renderDonut(canvasId, holdings, totalLabel, totalValue, quick = false) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const top = holdings.slice(0, 7), rest = holdings.slice(7), col = (h, i) => { const k = h.ci ?? i; return cssVar(k >= 0 && k < 7 ? SERIES[k] : "--other"); };
  const slices = top.map((h, i) => ({ label: (h.symbol || h.name || h.coin_id).toUpperCase(), name: h.name, value: h.value, alloc: h.alloc, color: col(h, i) }));
  if (rest.length) slices.push({ label: "Other", name: `${rest.length} more coins`, value: rest.reduce((s, h) => s + h.value, 0), alloc: rest.reduce((s, h) => s + h.alloc, 0), color: cssVar("--other") });
  const c = S.charts[canvasId], ds = { data: slices.map(s => s.value), backgroundColor: slices.map(s => s.color) };
  if (c && quick) { c.data.labels = slices.map(s => s.label); Object.assign(c.data.datasets[0], ds); c.$slices = slices; c.update("none"); }
  else {
    if (c) { c.destroy(); delete S.charts[canvasId]; }
    const ch = S.charts[canvasId] = new Chart(el, {
      type: "doughnut",
      data: { labels: slices.map(s => s.label), datasets: [{ ...ds, borderColor: cssVar("--surface-1"), borderWidth: 3, hoverOffset: 4, borderRadius: 6 }] },
      options: {
        cutout: "74%", layout: { padding: 4 }, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: cssVar("--text-primary"), titleColor: cssVar("--surface-1"), bodyColor: cssVar("--surface-1"), padding: 10, displayColors: false,
          callbacks: { title: (it) => ch.$slices[it[0].dataIndex].label, label: (it) => `${fmtUsd(ch.$slices[it.dataIndex].value)} · ${ch.$slices[it.dataIndex].alloc.toFixed(1)}%` } } },
      },
    });
    ch.$slices = slices;
  }
  const center = el.parentElement.querySelector(".chart-center");
  if (center) center.innerHTML = `<div><div class="v num">${fmtUsd(totalValue, { compact: true })}</div><div class="l">${esc(totalLabel)}</div></div>`;
  const legend = document.getElementById(canvasId + "-legend");
  if (legend) legend.innerHTML = slices.map(s => `<div class="li"><span class="swatch" style="background:${s.color}"></span><span class="n" title="${esc(s.name || s.label)}">${esc(s.label)}</span><span class="p num">${s.alloc.toFixed(1)}%</span></div>`).join("");
}
function donutCard(id, title, rewind = false) {
  return `<div class="card"><h2>${esc(title)}</h2>${rewind ? `<div class="rewind"><button class="icon-btn sm" id="${id}-play" aria-label="Play allocation over time">${ICON.play}</button><input type="range" id="${id}-rw" min="0" max="1000" value="1000" aria-label="Allocation date"><span class="muted num" id="${id}-when">Now</span></div>` : ""}<div class="chart-box"><canvas id="${id}" role="img" aria-label="${esc(title)} pie chart"></canvas><div class="chart-center"></div></div><div class="legend" id="${id}-legend"></div></div>`;
}

/** Allocation rewind: drag (or play) through time and the pie shows how the portfolio was split back then. */
function bindRewind(id, txs, holdings, total) {
  const rw = $(`#${id}-rw`), play = $(`#${id}-play`), when = $(`#${id}-when`); if (!rw) return;
  const order = holdings.map(h => h.coin_id); let pts = null, timer = 0;
  const load = async () => pts ||= await portfolioHistory(txs, SINCE_JUL23).catch(() => null);
  const show = (i) => {
    if (!pts || i >= pts.length - 1) { when.textContent = "Now"; return renderDonut(id, holdings, "Total", total, true); }
    const p = pts[i], hs = Object.entries(p.by).filter(([, v]) => v > 0).map(([c, v]) => ({ coin_id: c, symbol: symOf(c), value: v, alloc: v / p.value * 100, ci: order.indexOf(c) })).sort((a, b) => b.value - a.value);
    when.textContent = new Date(p.t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
    renderDonut(id, hs, when.textContent, p.value, true);
  };
  rw.oninput = async () => { clearInterval(timer); await load(); if (pts) show(Math.round(rw.value / 1000 * (pts.length - 1))); };
  play.onclick = async () => {
    clearInterval(timer); play.disabled = true; await load(); play.disabled = false;
    if (!pts) return toast("Couldn't load price history. Try again in a minute.");
    let i = 0; timer = setInterval(() => { if (!rw.isConnected) return clearInterval(timer); rw.value = i / (pts.length - 1) * 1000; show(i); if (++i >= pts.length) clearInterval(timer); }, 70);
  };
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
    const [interval, limit] = days <= 1 ? ["15m", 96] : days <= 7 ? ["60m", 168] : days <= 30 ? ["4h", 180] : days <= 90 ? ["1d", 90] : days <= 500 ? ["1d", Math.ceil(days)] : ["1W", Math.ceil(days / 7) + 1];   // MEXC returns at most 500 candles, so long ranges use weekly ones
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
  let prices = null;
  try {
    if (EXCHANGE_CHART.CB[id]) { prices = await EXCHANGE_CHART.coinbase(id, days); }
    else if (!STABLE_IDS.includes(id)) { prices = await EXCHANGE_CHART.mexc(id, days); }
  } catch (e) { prices = null; }
  if (prices) prices = prices.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0).sort((a, b) => a[0] - b[0]);
  if (!prices || prices.length < 2) {
    const d = await this.get(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`);
    prices = (d.prices || []).filter(p => Number.isFinite(p[1]));
  }
  this.hist[k] = { prices, at: Date.now() };
  return prices;
};
function rgba(hex, a) {
  const h = String(hex).trim().replace("#", "");
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
const signed = (v) => (num(v) > 0 ? "+" : "") + fmtUsd(v);
const arrow = (v) => num(v) > 0 ? "▲" : num(v) < 0 ? "▼" : "";
/** Price at time t from a [[t, price], ...] series. Before the series starts (or no data): fallback, never today's price. */
function priceAt(s, t, fallback) {
  if (!s || !s.length || t < s[0][0] - 7 * 864e5) return fallback || s?.[0]?.[1] || 0;
  if (t <= s[0][0]) return s[0][1];
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m][0] <= t) lo = m; else hi = m - 1; }
  return s[lo][1];
}
/** Portfolio value and money invested over the last `days`, from trades + price history. */
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
  const N = 90, pos = {}, pts = []; let j = 0, realized = 0;
  for (let i = 0; i < N; i++) {
    const t = from + (now - from) * i / (N - 1);
    while (j < sorted.length && new Date(sorted[j].executed_at).getTime() <= t) {
      const x = sorted[j++], h = pos[x.coin_id] ||= { qty: 0, cost: 0, last: 0 };
      const q = num(x.quantity), pr = num(x.price_usd), fee = num(x.fee_usd); h.last = pr;
      if (x.side === "buy") { h.qty += q; h.cost += q * pr + fee; }
      else { const sq = Math.min(q, h.qty), avg = h.qty > 0 ? h.cost / h.qty : 0; realized += sq * pr - fee - sq * avg; h.cost -= sq * avg; h.qty -= sq; if (h.qty < 1e-12) { h.qty = 0; h.cost = 0; } }
    }
    let value = 0, invested = 0; const by = {};
    for (const [id, h] of Object.entries(pos)) { if (h.qty <= 0) continue; value += by[id] = h.qty * priceAt(series[id], t, h.last || CG.info(id)?.price); invested += h.cost; }
    pts.push({ t, value, invested, realized, pnl: value - invested + realized, by });
  }
  return pts;
}
function heroCard(pf, chartId = "hero", flows = null) {
  const t = pf.totals, days = S.histDays || 30, mode = S.heroMode || "value";
  return `<div class="card hero">
    <div class="hero-head"><div><div class="label" id="${chartId}-label">Portfolio value</div><div class="big num" id="${chartId}-big">${fmtUsd(t.value)}</div>
      <div class="chg" id="${chartId}-chg"><span class="pill ${signCls(t.change24Pct)}">${arrow(t.change24Pct)} ${fmtPct(t.change24Pct)}</span><span class="num ${signCls(t.change24Usd)}">${signed(t.change24Usd)}</span><span>today</span></div></div>
      <div class="periods" data-hero="${chartId}">${HIST_PERIODS.map(([d, l]) => `<button data-d="${d}" class="${d === days ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="periods hero-modes" data-hero-mode="${chartId}" role="tablist">
      <button data-m="value" class="${mode === "value" ? "on" : ""}" role="tab">Holdings</button><button data-m="pnl" class="${mode === "pnl" ? "on" : ""}" role="tab">Profit / loss</button></div>
    <div class="hero-chart" id="${chartId}-chart"></div>
    <div class="hero-key"><span style="margin-left:auto" class="num" id="${chartId}-period"></span></div>
    <div class="hero-stats">
      <div><div class="l">Invested</div><div class="v num">${fmtUsd(t.cost)}</div></div>
      <div><div class="l">Unrealized P&amp;L</div><div class="v num ${signCls(t.pnl)}">${signed(t.pnl)}</div><div class="s num ${signCls(t.pnl)}">${fmtPct(t.pnlPct)}</div></div>
      <div><div class="l">Realized P&amp;L</div><div class="v num ${signCls(t.realized)}">${signed(t.realized)}</div></div>
    </div>${flows && flows.length ? (() => { const f = flowTotals(flows), ret = t.value + f.wd - f.dep; return `<div class="hero-key" style="margin-top:12px"><span>Net in <b class="num">${fmtUsd(f.net)}</b></span><span>Total return <b class="num ${signCls(ret)}">${signed(ret)}${f.dep ? ` (${fmtPct(ret / f.dep * 100)})` : ""}</b></span></div>`; })() : ""}</div>`;
}
/* Portfolio chart, two views (like CoinGecko's portfolio):
   Holdings = what your coins were actually worth each day (quantity held × that day's price).
   Profit / loss = realized gains from sells + unrealized gain on what you still hold, at each point in time. */
async function paintHero(txs, chartId = "hero") {
  const box = document.getElementById(chartId + "-chart"); if (!box) return;
  const days = S.histDays || 30, mode = S.heroMode || "value", tok = (S.heroTok = (S.heroTok || 0) + 1);
  document.querySelectorAll(`[data-hero="${chartId}"] button`).forEach(b => b.onclick = () => {
    S.histDays = +b.dataset.d;
    b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    paintHero(txs, chartId);
  });
  document.querySelectorAll(`[data-hero-mode="${chartId}"] button`).forEach(b => b.onclick = () => {
    S.heroMode = b.dataset.m;
    b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    paintHero(txs, chartId);
  });
  if (!S.charts[chartId]) box.innerHTML = `<div class="note">Loading chart…</div>`;
  const pts = await portfolioHistory(txs, days).catch(() => null);
  if (pts && pts.length) {   // end on the live numbers shown above
    const tot = computePortfolio(txs).totals, z = pts[pts.length - 1];
    if (tot.value > 0) pts[pts.length - 1] = { ...z, t: Date.now(), value: tot.value, invested: tot.cost, realized: tot.realized, pnl: tot.value - tot.cost + tot.realized };
  }
  if (tok !== S.heroTok || !document.body.contains(box)) return;
  if (S.charts[chartId]) { S.charts[chartId].destroy(); delete S.charts[chartId]; }
  const per = document.getElementById(chartId + "-period");
  if (!pts || pts.length < 2) { box.innerHTML = `<div class="note">${CG.offline ? "The chart needs live CoinGecko prices. Try again in a minute." : "Not enough price history yet."}</div>`; if (per) per.textContent = ""; return; }
  box.innerHTML = `<canvas id="${chartId}-cv" role="img" aria-label="${mode === "pnl" ? "Profit and loss" : "Holdings value"} over time"></canvas>`;
  const a = pts[0], z = pts[pts.length - 1], label = HIST_PERIODS.find(x => x[0] === days)?.[1] || "";
  const pnl = mode === "pnl", ys = pts.map(p => pnl ? p.pnl : p.value);
  let col;
  if (pnl) {
    col = cssVar(z.pnl < 0 ? "--bad" : "--good");
    if (per) per.innerHTML = `<span class="${signCls(z.pnl)}">${signed(z.pnl)}</span> · ${signed(z.pnl - a.pnl)} in ${label}`;
  } else {
    const gain = z.pnl - a.pnl, base = a.value + Math.max(0, z.invested - a.invested);   // price moves only, not money added
    col = cssVar(gain < 0 ? "--bad" : "--good");
    if (per) per.innerHTML = `<span class="${signCls(gain)}">${signed(gain)}${base > 0 ? ` (${fmtPct(gain / base * 100)})` : ""}</span> · ${label}`;
  }
  const good = cssVar("--good"), bad = cssVar("--bad");
  const grad = (c, color) => { const ca = c.chart.chartArea; if (!ca) return "transparent"; const g = c.chart.ctx.createLinearGradient(0, ca.top, 0, ca.bottom); g.addColorStop(0, rgba(color, 0.32)); g.addColorStop(1, rgba(color, 0)); return g; };
  const fmtT = (t) => new Date(t).toLocaleString(undefined, days <= 7 ? { month: "short", day: "numeric", hour: "numeric" } : { month: "short", day: "numeric", year: days > 90 ? "2-digit" : undefined });
  const ds = pnl
    ? { data: ys, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.35,
        segment: { borderColor: (c) => (c.p1.parsed.y < 0 ? bad : good) }, borderColor: col, pointHoverBackgroundColor: col,
        fill: { target: "origin", above: rgba(good, 0.18), below: rgba(bad, 0.18) } }
    : { data: ys, borderColor: col, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: col, tension: 0.35, fill: true, backgroundColor: (c) => grad(c, col) };
  const scales = readableScales(pts.map(p => p.t), days, (v) => (pnl && v > 0 ? "+" : "") + compactUsd(v));
  if (pnl) scales.y.grid = { color: (c) => (c.tick.value === 0 ? cssVar("--text-muted") : cssVar("--grid")) };
  // Hold on the chart: the header shows that point's value, change since the period start, and date. Let go: back to live.
  const head = ["label", "big", "chg"].map(k => document.getElementById(`${chartId}-${k}`)), live = head.map(e => e && e.innerHTML);
  const onScrub = (i) => {
    if (!head[1]) return;
    if (i == null) return head.forEach((e, k) => e && (e.innerHTML = live[k]));
    const p = pts[i], d = p.pnl - a.pnl, base = a.value + Math.max(0, p.invested - a.invested);
    head[0].textContent = pnl ? "Profit / loss" : "Portfolio value";
    head[1].textContent = pnl ? signed(p.pnl) : fmtUsd(p.value);
    head[2].innerHTML = `${base > 0 ? `<span class="pill ${signCls(d)}">${arrow(d)} ${fmtPct(d / base * 100)}</span>` : ""}<span class="num ${signCls(d)}">${signed(d)}</span><span>${fmtT(p.t)}</span>`;
  };
  S.charts[chartId] = new Chart(document.getElementById(chartId + "-cv"), {
    type: "line", plugins: [lastTagPlugin, scrubPlugin],
    data: { labels: pts.map(p => p.t), datasets: [ds] },
    options: {
      ...scrubOptions(onScrub), animation: { duration: 400 }, layout: { padding: { left: 2, right: 2, top: 8 } }, scales,
      plugins: { legend: { display: false }, tooltip: { enabled: false }, lastTag: { color: col, text: (v) => (pnl ? signed(v) : fmtUsd(v, { compact: true })) } },
    },
  });
  scrubEnd(S.charts[chartId], onScrub);
}
/* ---------- Share card: a PNG of returns + allocation, percentages only (no dollar amounts) ---------- */
async function shareCard(pf) {
  const W = 1080, H = 1350, cv = Object.assign(document.createElement("canvas"), { width: W, height: H }), c = cv.getContext("2d");
  const F = (w, px) => `${w} ${px}px "Inter Tight", system-ui, sans-serif`, txt = cssVar("--text"), mut = cssVar("--muted");
  const t = pf.totals, f = S.flows.length ? flowTotals() : null, ret = f && f.dep ? (t.value + f.wd - f.dep) / f.dep * 100 : t.pnlPct;
  c.fillStyle = cssVar("--surface-1"); c.fillRect(0, 0, W, H);
  c.fillStyle = txt; c.font = F(600, 44); c.fillText(CONFIG.GROUP_NAME + " Portfolio Desk", 80, 130);
  c.fillStyle = mut; c.font = F(500, 34); c.fillText(f && f.dep ? "Total return" : "Return on open positions", 80, 250);
  c.fillStyle = cssVar(ret < 0 ? "--bad" : "--good"); c.font = F(600, 150); c.fillText(fmtPct(ret), 72, 400);
  const top = pf.holdings.slice(0, 6), other = pf.holdings.slice(6).reduce((a, h) => a + h.alloc, 0);
  const sl = [...top.map((h, i) => [symOf(h.coin_id), h.alloc, cssVar(SERIES[i])]), ...(other > 0.05 ? [["Other", other, cssVar("--other")]] : [])];
  let a0 = -Math.PI / 2; const cx = 330, cy = 820, R = 230;
  for (const [, pct, col] of sl) { const a1 = a0 + pct / 100 * Math.PI * 2; c.beginPath(); c.strokeStyle = col; c.lineWidth = 70; c.arc(cx, cy, R, a0 + 0.02, a1 - 0.02); c.stroke(); a0 = a1; }
  sl.forEach(([sym, pct, col], i) => { const y = 640 + i * 66; c.fillStyle = col; c.beginPath(); c.arc(660, y - 12, 13, 0, Math.PI * 2); c.fill(); c.fillStyle = txt; c.font = F(600, 38); c.fillText(sym, 690, y); c.fillStyle = mut; c.font = F(500, 38); c.textAlign = "right"; c.fillText(pct.toFixed(0) + "%", 1000, y); c.textAlign = "left"; });
  c.fillStyle = mut; c.font = F(500, 30); c.fillText(new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }), 80, H - 90);
  const url = cv.toDataURL("image/png");
  if (!TG && navigator.canShare) { try { const file = new File([await (await fetch(url)).blob()], "cc-portfolio.png", { type: "image/png" }); if (navigator.canShare({ files: [file] })) return await navigator.share({ files: [file] }); } catch (e) { if (e.name === "AbortError") return; } }
  saveFile(url, "cc-portfolio.png");
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

/* ---------- Chart helpers: price tag on the last point, readable axes, hold-to-scrub ---------- */
const lastTagPlugin = {
  id: "lastTag",
  afterDatasetsDraw(chart, args, o) {
    const meta = chart.getDatasetMeta(0), pt = meta && meta.data[meta.data.length - 1]; if (!pt || !o || !o.text || chart.getActiveElements().length) return;
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
// Delta-style: press and drag on a line chart → onScrub(index) with a thin line and dot, no tooltip box; let go → onScrub(null).
const scrubPlugin = {
  id: "scrub",
  afterDatasetsDraw(chart) {
    const el = chart.getActiveElements()[0]; if (!el) return;
    const { ctx, chartArea: ca } = chart, pt = el.element, col = chart.data.datasets[0].borderColor;
    ctx.save(); ctx.strokeStyle = cssVar("--muted"); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pt.x, ca.top); ctx.lineTo(pt.x, ca.bottom); ctx.stroke();
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = cssVar("--surface-1"); ctx.stroke();
    ctx.restore();
  },
};
const scrubOptions = (onScrub) => ({ maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, events: ["mousemove", "mouseout", "touchstart", "touchmove"],
  onHover: (e, els) => onScrub(els.length ? els[0].index : null) });
function scrubEnd(chart, onScrub) {
  for (const ev of ["mouseleave", "touchend", "touchcancel"]) chart.canvas.addEventListener(ev, () => { chart.setActiveElements([]); chart.update("none"); onScrub(null); });
}

/* ---------- Price charts: BTC, ETH and the group's coins (live) ---------- */
const PRICE_PERIODS = [[1, "24H"], [7, "7D"], [30, "1M"], [90, "3M"], [365, "1Y"], [SINCE_JUL23, "3Y"]];
function priceChartCoins() { return [...new Set(["bitcoin", "ethereum", ...modelCoinIds()])]; }
function priceChartCard() {
  const coins = priceChartCoins();
  if (!coins.includes(S.pcCoin)) S.pcCoin = coins[0];
  const days = S.pcDays || 1;
  return `<div class="card hero" id="pc-card">
    <div class="chips" id="pc-coins">${coins.map(id => `<button class="chip ${id === S.pcCoin ? "on" : ""}" data-c="${esc(id)}">${esc(symOf(id))}</button>`).join("")}</div>
    <div class="hero-head" style="margin-top:14px"><div><div class="label"><b id="pc-sym" style="color:var(--text-primary)">${esc(symOf(S.pcCoin))}</b> <span id="pc-live"></span></div>
      <div class="big num" id="pc-price">—</div>
      <div class="chg" id="pc-chg"></div></div>
      <div class="periods" id="pc-periods">${PRICE_PERIODS.map(([d, l]) => `<button data-d="${d}" class="${d === days ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="hero-chart" id="pc-chart" style="height:240px"></div>
  </div>`;
}
function pcHeader() {
  const id = S.pcCoin, info = CG.info(id) || {}, el = document.getElementById("pc-price"); if (!el) return;
  const live = info.price != null && !info.sample, sc = S.pcScrub;
  $("#pc-sym").textContent = symOf(id);
  if (sc) {   // holding the chart: that point's price, change since the period start, date
    el.textContent = fmtPrice(sc.v); $("#pc-live").innerHTML = "";
    return $("#pc-chg").innerHTML = `<span class="pill ${signCls(sc.chg)}">${arrow(sc.chg)} ${fmtPct(sc.chg)}</span><span>${sc.when}</span>`;
  }
  el.textContent = live ? fmtPrice(info.price) : "—";
  $("#pc-live").innerHTML = live ? `<span style="color:var(--good)">● Live</span>` : `<span class="bad">Live price unavailable</span>`;
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
  S.pcPeriodChg = S.pcScrub = null; pcHeader();
  clearInterval(S.pcTimer); S.pcTimer = setInterval(pcTick, 30000);
  if (!S.charts.pc) box.innerHTML = `<div class="note">Loading chart…</div>`;
  const fresh = (CG.info(id)?.liveAt || 0) > Date.now() - 30000;
  const [pts] = await Promise.all([CG.chart(id, days).catch(() => null), fresh ? null : CG.live(id).catch(() => null)]);
  if (tok !== S.pcTok || !document.body.contains(box)) return;
  pcHeader();
  if (S.charts.pc) { S.charts.pc.destroy(); delete S.charts.pc; }
  if (!pts || pts.length < 2) { box.innerHTML = `<div class="note">Couldn't load ${esc(symOf(id))} price history right now. Tap the period again in a minute.</div>`; return; }
  const data = pts.map(p => [p[0], p[1]]), info = CG.info(id);
  if (info && !info.sample && info.price != null) data.push([Date.now(), info.price]);   // end on the live price
  const first = data[0][1], last = data[data.length - 1][1], chg = (last - first) / first * 100;
  S.pcPeriodChg = { chg, label: PRICE_PERIODS.find(x => x[0] === days)?.[1] || "" }; pcHeader();
  box.innerHTML = `<canvas id="pc-cv" role="img" aria-label="${esc(symOf(id))} price chart"></canvas>`;
  const col = cssVar(chg < 0 ? "--bad" : "--good"), times = data.map(p => p[0]);
  const fmtT = (t) => new Date(t).toLocaleString(undefined, days <= 7 ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" });
  const onScrub = (i) => { const c = S.charts.pc; S.pcScrub = i == null || !c ? null : { v: c.data.datasets[0].data[i], chg: (c.data.datasets[0].data[i] - first) / first * 100, when: fmtT(c.data.labels[i]) }; pcHeader(); };
  S.charts.pc = new Chart(document.getElementById("pc-cv"), {
    type: "line", plugins: [lastTagPlugin, scrubPlugin],
    data: { labels: times, datasets: [{ data: data.map(p => p[1]), borderColor: col, borderWidth: 2.2, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: col, tension: 0.2, fill: true,
      backgroundColor: (c) => { const ca = c.chart.chartArea; if (!ca) return "transparent"; const g = c.chart.ctx.createLinearGradient(0, ca.top, 0, ca.bottom); g.addColorStop(0, rgba(col, 0.3)); g.addColorStop(1, rgba(col, 0)); return g; } }] },
    options: {
      ...scrubOptions(onScrub), animation: { duration: 300 }, layout: { padding: { left: 2, right: 2, top: 8 } },
      scales: readableScales(times, days, compactUsd),
      plugins: { legend: { display: false }, tooltip: { enabled: false }, lastTag: { color: col, text: (v) => fmtPrice(v) } },
    },
  });
  scrubEnd(S.charts.pc, onScrub);
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

