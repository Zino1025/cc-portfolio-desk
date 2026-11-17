/* ---------- Screenshot import ---------- */
// Member picks screenshots → we slice tall ones so text stays sharp → edge function reads them with
// Claude → we match each coin to CoinGecko here (member's own connection) → member confirms → buys saved.
const IMPORT_MAX_FILES = 5, IMPORT_MAX_SLICES = 10;
function loadImageFile(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(`Couldn't open ${file.name || "that image"}. Use a normal screenshot (PNG or JPG).`)); };
    img.src = url;
  });
}
async function screenshotSlices(file) {
  const img = await loadImageFile(file);
  const W = Math.min(img.naturalWidth, 1200), scale = W / img.naturalWidth, H = Math.round(img.naturalHeight * scale);
  const sliceH = Math.round(W * 1.3), overlap = Math.round(sliceH * 0.12), out = [];
  for (let y = 0; ; y += sliceH - overlap) {
    const h = Math.min(sliceH, H - y);
    const c = document.createElement("canvas"); c.width = W; c.height = h;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, h);
    ctx.drawImage(img, 0, y / scale, img.naturalWidth, h / scale, 0, 0, W, h);
    out.push(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
    if (y + h >= H) break;
  }
  return out;
}
async function importSearch(q) {
  for (let i = 0; i < 3; i++) {
    try { const d = await CG.get(`/search?query=${encodeURIComponent(q)}`); return (d.coins || []).slice(0, 8).map(c => ({ id: c.id, name: c.name, symbol: c.symbol, image: c.thumb, rank: c.market_cap_rank })); }
    catch (e) { if (!/429/.test(e.message) || i === 2) return []; await new Promise(r => setTimeout(r, 2500 * (i + 1))); }
  }
  return [];
}
const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
async function matchImportedCoins(rows, onProgress) {
  // Rows of the same coin (e.g. a transaction history) are matched once and share the result.
  const groups = new Map();
  for (const r of rows) { r.key = [r.coingecko_id_guess || "", String(r.symbol || "").toLowerCase(), normName(r.name)].join("|"); if (!groups.has(r.key)) groups.set(r.key, []); groups.get(r.key).push(r); }
  const reps = [...groups.values()].map(g => g[0]);
  await matchCoinsInner(reps, onProgress);
  for (const g of groups.values()) for (const r of g.slice(1)) { r.match = g[0].match; r.sure = g[0].sure; }
  return rows;
}
async function matchCoinsInner(rows, onProgress) {
  // 1) Claude's CoinGecko id guesses: verified in one batched call.
  const guesses = [...new Set(rows.map(r => r.coingecko_id_guess).filter(Boolean))];
  if (guesses.length) await CG.ensure(guesses, 5 * 60000);
  const priceOk = (id, r) => { const p = CG.info(id)?.price; if (!r.current_price || !p || CG.info(id)?.sample) return null; return Math.abs(p - r.current_price) / r.current_price < 0.25; };
  const toCoin = (id) => { const i = CG.info(id); return i && !i.sample ? { id, name: i.name, symbol: i.symbol, image: i.image } : null; };
  const pending = [];
  for (const r of rows) {
    const sym = String(r.symbol || "").toLowerCase(), g = r.coingecko_id_guess, info = g && toCoin(g);
    if (info && (!sym || info.symbol.toLowerCase() === sym) && priceOk(g, r) !== false) { r.match = info; r.sure = true; }
    else pending.push(r);
  }
  // 2) Everything else: search CoinGecko by name, then ticker; score; break ties with the price in the screenshot.
  let done = rows.length - pending.length; onProgress?.(done, rows.length);
  const allCand = new Set();
  for (const r of pending) {
    const sym = String(r.symbol || "").toLowerCase();
    let res = r.name ? await importSearch(r.name) : [];
    if (sym && !res.some(c => c.symbol.toLowerCase() === sym)) { const more = await importSearch(sym); res = res.concat(more.filter(c => !res.some(x => x.id === c.id))); }
    r.candidates = res.slice(0, 6); r.candidates.forEach(c => allCand.add(c.id));
    onProgress?.(++done, rows.length);
  }
  if (allCand.size) await CG.ensure([...allCand], 5 * 60000);
  for (const r of pending) {
    const sym = String(r.symbol || "").toLowerCase(), nm = normName(r.name);
    const scored = (r.candidates || []).map(c => {
      let s = 0;
      if (sym && c.symbol.toLowerCase() === sym) s += 4;
      const cn = normName(c.name);
      if (nm && cn === nm) s += 4; else if (nm && cn && (cn.includes(nm) || nm.includes(cn))) s += 1.5;
      s += c.rank ? 2 - Math.min(c.rank, 2000) / 1000 : 0;
      const po = priceOk(c.id, r); if (po === true) s += 4; else if (po === false) s -= 3;
      return { c, s, po };
    }).sort((a, b) => b.s - a.s);
    const best = scored[0];
    if (!best || best.s < 4) { r.match = null; r.sure = false; continue; }
    r.match = best.c;
    const symOk = !sym || best.c.symbol.toLowerCase() === sym, close = scored[1] && best.s - scored[1].s < 2;
    r.sure = symOk && (best.po === true || !close);
  }
  return rows;
}

// Trades paid in crypto (e.g. "0.05 ETH"): convert to USD with that coin's CoinGecko price on the trade day.
const IMPORT_STABLES = new Set(["USDT", "USDC", "DAI", "BUSD", "FDUSD", "TUSD", "USDE", "PYUSD", "USDS"]);
const IMPORT_BASE_IDS = { ETH: "ethereum", WETH: "weth", BTC: "bitcoin", WBTC: "wrapped-bitcoin", SOL: "solana", BNB: "binancecoin", AVAX: "avalanche-2", TON: "the-open-network", TRX: "tron", MATIC: "matic-network", POL: "polygon-ecosystem-token", ARB: "arbitrum", OP: "optimism", SUI: "sui" };
const importRateCache = {};
// Full daily history (no 1-year limit): Binance public market data first, then Coinbase. Average of the day's open and close (UTC).
async function exchangeDayPrice(cur, date) {
  const sym = { WETH: "ETH", WBTC: "BTC" }[cur] || cur;
  const [y, m, d] = date.split("-").map(Number), t0 = Date.UTC(y, m - 1, d);
  try {
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=1d&startTime=${t0}&limit=1`);
    if (r.ok) { const k = (await r.json())[0]; if (k && k[0] === t0) return (Number(k[1]) + Number(k[4])) / 2; }
  } catch (e) {}
  try {
    const iso = (t) => new Date(t).toISOString();
    const r = await fetch(`https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=86400&start=${iso(t0)}&end=${iso(t0 + 86400000)}`);
    if (r.ok) { const c = (await r.json()).find(x => x[0] * 1000 === t0); if (c) return (c[3] + c[4]) / 2; }
  } catch (e) {}
  return null;
}
async function usdRateOn(cur, date) {
  if (IMPORT_STABLES.has(cur)) return 1;
  const key = cur + "|" + date;
  if (key in importRateCache) return importRateCache[key];
  const ex = await exchangeDayPrice(cur, date);
  if (ex > 0) return (importRateCache[key] = ex);
  let id = IMPORT_BASE_IDS[cur];
  if (!id) id = (await importSearch(cur)).find(c => c.symbol.toUpperCase() === cur)?.id;
  let rate = null;
  if (id) for (let i = 0; i < 3; i++) {
    try { rate = await CG.historical(id, new Date(date + "T12:00")); break; }
    catch (e) { if (!/429/.test(e.message) || i === 2) break; await new Promise(r => setTimeout(r, 2500 * (i + 1))); }
  }
  return (importRateCache[key] = rate);
}
async function convertPaidTrades(rows) {
  for (const r of rows) {
    if (!r.paid || r.manualPrice) continue;
    const q = num(r.quantity);
    if (!r.date || !(q > 0)) { r.conv = { ok: false }; continue; }
    const rate = await usdRateOn(r.paid.currency, r.date);
    if (rate > 0) { r.avg_buy_price = r.paid.amount * rate / q; r.conv = { ok: true, rate }; }
    else { r.avg_buy_price = null; r.conv = { ok: false }; }
  }
}

/* ---------- CSV import ---------- */
// Parsed in the browser, then goes through the same coin matching and confirm step as screenshots.
// Accepts our own "Export CSV" file, CoinGecko/exchange exports, or a simple sheet: coin, quantity, buy price, date.
function parseCsvText(text) {
  text = String(text || "").replace(/^﻿/, "");
  const first = text.split(/\r?\n/).find(l => l.trim()) || "";
  const delim = [",", ";", "\t"].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c));
}
const CSV_COLS = {
  coin_id: ["coinid", "coingeckoid", "id", "apiid"],
  symbol: ["symbol", "ticker", "asset", "token", "currency"],
  name: ["name", "coinname", "assetname", "tokenname"],
  coin: ["coin", "crypto", "cryptocurrency"],
  quantity: ["quantity", "qty", "amount", "holdings", "balance", "units", "coins", "size"],
  price: ["priceusd", "price", "buyprice", "avgbuyprice", "averagebuyprice", "avgprice", "averageprice", "costpercoin", "pricepercoin", "entryprice", "entry", "avgcost"],
  total: ["totalusd", "total", "cost", "totalcost", "costbasis", "invested", "totalspent", "spent"],
  value: ["value", "valueusd", "currentvalue"],
  date: ["executedat", "date", "datetime", "time", "timestamp", "dateutc", "buydate", "purchasedate", "bought"],
  side: ["side", "type", "action", "transactiontype"],
  fee: ["feeusd", "fee", "fees"],
  exchange: ["exchange", "wallet", "platform"],
  note: ["note", "notes", "memo"],
};
function csvDate(s) {
  s = String(s || "").trim(); if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let [a, b, y] = [+m[1], +m[2], m[3].length === 2 ? "20" + m[3] : m[3]];
    const [mo, d] = a > 12 ? [b, a] : [a, b];   // 25/03/2024 → day first; otherwise month first
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const t = Date.parse(s); if (Number.isNaN(t)) return null;
  const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function csvToImport(text) {
  const grid = parseCsvText(text);
  if (grid.length < 2) throw new Error("That CSV looks empty. It needs a header row and at least one coin.");
  const head = grid[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const col = {}; for (const [k, names] of Object.entries(CSV_COLS)) { const i = names.map(n => head.indexOf(n)).find(i => i >= 0); if (i != null) col[k] = i; }
  if (col.quantity == null) throw new Error("Couldn't find a quantity column. Name it \"quantity\" (or use the template).");
  if (col.coin_id == null && col.symbol == null && col.name == null && col.coin == null) throw new Error("Couldn't find a coin column. Name it \"coin\" (ticker or name), or use the template.");
  const get = (r, k) => col[k] != null ? (r[col[k]] ?? "").trim() : "";
  const n = (v) => { const x = dec(v); return v !== "" && Number.isFinite(x) ? Math.abs(x) : null; };
  const warnings = []; let skipped = 0;
  const items = grid.slice(1).map(r => {
    let symbol = get(r, "symbol"), name = get(r, "name");
    const coin = get(r, "coin");
    if (coin) { if (/^\$?[A-Z0-9.]{1,10}$/.test(coin) && !symbol) symbol = coin.replace(/^\$/, ""); else if (!name) name = coin; }
    const quantity = n(get(r, "quantity")), total = n(get(r, "total"));
    let price = n(get(r, "price")); if (price == null && total != null && quantity) price = total / quantity;
    const sideRaw = get(r, "side");
    return { name, symbol: symbol.toUpperCase(), coingecko_id_guess: get(r, "coin_id").toLowerCase() || null, quantity, price, value: n(get(r, "value")),
      date: csvDate(get(r, "date")), side: /sell/i.test(sideRaw) ? "sell" : "buy", fee: n(get(r, "fee")) || 0, exchange: get(r, "exchange") || null, note: get(r, "note") || null };
  }).filter(x => { const ok = (x.name || x.symbol || x.coingecko_id_guess) && x.quantity > 0; if (!ok) skipped++; return ok; });
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? " was" : "s were"} skipped (no coin or no quantity).`);
  if (!items.length) throw new Error("No coins with a quantity found in that CSV.");
  const dated = items.filter(x => x.date).length;
  if (col.date != null && dated >= items.length * 0.8) {
    return { source_app: "CSV", warnings, trades: items.map(x => ({ ...x, price_usd: x.price, total_usd: null, paid: null })) };
  }
  return { source_app: "CSV", warnings, holdings: items.map(x => ({ ...x, avg_buy_price: x.price, current_price: null })) };
}
function downloadCsvTemplate() {
  const csv = "coin,quantity,buy_price,date\nBTC,0.05,62000,2024-03-10\nPAAL,100000,0.12,2024-05-02\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "cc-portfolio-template.csv"; a.click();
}

function openImportModal() {
  const ov = document.createElement("div"); ov.className = "overlay";
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="max-width:560px"><h2>Import coins <button class="x" aria-label="Close">×</button></h2><div id="imp-body"></div></div>`;
  document.body.appendChild(ov);
  let busy = false;
  const close = () => { if (!busy || confirm("Stop the import?")) ov.remove(); };
  ov.querySelector(".x").onclick = close;
  const body = $("#imp-body", ov);
  let result = null, rows = [], mode = "holdings";
  const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };
  // Transaction already logged (same coin, side, day and amount)? Untick it.
  const CC_START = "2023-06-01";   // CC started June 2023: older trades come in unticked
  function applyDup(r) {
    r.preCC = !!(r.date && r.date < CC_START);
    if (r.preCC) { r.include = false; r.dup = false; return; }
    r.dup = !!(r.match && r.date && S.txs.some(t => t.coin_id === r.match.id && t.side === r.side && dayKey(t.executed_at) === dayKey(r.date + "T12:00") && Math.abs(num(t.quantity) - num(r.quantity)) <= num(r.quantity) * 0.005));
    if (r.dup) r.include = false;
  }

  // Already logged this coin? Only import the extra the screenshot shows, so nothing is counted twice.
  function applyHeld(r) {
    const h = r.match && computePortfolio(S.txs).holdings.find(x => x.coin_id === r.match.id);
    r.heldQty = h ? h.qty : 0; r.alreadyHeld = !!h; r.topUp = false;
    if (!h) return;
    const shot = num(r.shotQty ?? r.quantity); r.shotQty = shot;
    if (shot > h.qty * 1.0001) { r.quantity = +(shot - h.qty).toPrecision(10); r.topUp = true; r.include = true; }
    else { r.quantity = shot; r.include = false; }
  }
  function stepPick(msg = "") {
    body.innerHTML = `
      <label class="btn primary" style="display:flex;justify-content:center;cursor:pointer">Choose screenshots<input type="file" id="imp-file" accept="image/*" multiple style="display:none"></label>
      <div style="display:flex;align-items:center;gap:10px;margin:16px 0 12px;color:var(--text-muted);font-size:12px"><span style="flex:1;border-top:1px solid var(--grid)"></span>or<span style="flex:1;border-top:1px solid var(--grid)"></span></div>
      <label class="btn" style="display:flex;justify-content:center;cursor:pointer">Upload a CSV file<input type="file" id="imp-csv" accept=".csv,text/csv,.txt,text/plain" style="display:none"></label>
      <div class="hint">Columns: coin, quantity, buy price, date. <button class="link-btn" type="button" id="imp-tpl" style="font-size:12px">Download template</button></div>
      <div class="err" id="imp-err">${esc(msg)}</div>`;
    $("#imp-file", ov).onchange = (e) => { const files = [...e.target.files]; if (files.length) run(files); };
    $("#imp-csv", ov).onchange = (e) => { const f = e.target.files[0]; if (f) runCsv(f); };
    $("#imp-tpl", ov).onclick = downloadCsvTemplate;
  }

  async function runCsv(file) {
    if (file.size > 2e6) return stepPick("That CSV is too big (max 2 MB).");
    busy = true;
    body.innerHTML = `<div class="spinner"></div><p class="secondary" style="text-align:center">Reading CSV…</p>`;
    try { result = csvToImport(await file.text()); await prepareRows(); }
    catch (e) { busy = false; stepPick(e.message || "Couldn't read that CSV."); }
  }
  async function prepareRows() {
    const status = (t) => body.innerHTML = `<div class="spinner"></div><p class="secondary" style="text-align:center">${t}</p>`;
    mode = (result.trades || []).length ? "trades" : "holdings";
    rows = mode === "trades"
      ? result.trades.map(t => ({ name: t.name, symbol: t.symbol, quantity: t.quantity, avg_buy_price: t.price_usd, total_usd: t.total_usd, current_price: null, coingecko_id_guess: t.coingecko_id_guess, side: t.side, date: t.date, paid: t.paid || null, fee: t.fee, exchange: t.exchange, note: t.note, include: true }))
      : (result.holdings || []).map(h => ({ ...h, include: true }));
    if (!rows.length) throw new Error((result.warnings || [])[0] || "No holdings found in that screenshot. Try one that shows your coin list with amounts.");
    status("Matching coins on CoinGecko…");
    await matchImportedCoins(rows, (d, t) => { const p = body.querySelector("p"); if (p) p.textContent = `Matching coins on CoinGecko… ${d}/${t}`; });
    for (const r of rows) { if (mode === "trades") applyDup(r); else applyHeld(r); if (!r.quantity) r.include = false; }
    const paidCurs = [...new Set(rows.filter(r => r.paid && r.avg_buy_price == null).map(r => r.paid.currency))];
    if (paidCurs.length) { status(`Converting ${paidCurs.join(", ")} amounts to USD…`); await convertPaidTrades(rows); }
    busy = false; stepConfirm();
  }

  async function run(files) {
    if (files.length > IMPORT_MAX_FILES) return stepPick(`Pick up to ${IMPORT_MAX_FILES} screenshots at a time.`);
    busy = true;
    const status = (t) => body.innerHTML = `<div class="spinner"></div><p class="secondary" style="text-align:center">${t}</p>`;
    try {
      status("Preparing screenshots…");
      let slices = [];
      for (const f of files) slices = slices.concat(await screenshotSlices(f));
      if (slices.length > IMPORT_MAX_SLICES) throw new Error("Those screenshots are very long. Try fewer at a time (or crop them).");
      status("Reading your holdings… (10–20 seconds)");
      result = await api.parseScreenshots(slices, /tx|trade|history/i.test(files[0]?.name || "") ? "trades" : "");
      await prepareRows();
    } catch (e) { busy = false; stepPick(e.message || "Something went wrong. Try again."); }
  }

  function stepConfirm() {
    const isCsv = result.source_app === "CSV";
    const src = !isCsv && result.source_app && !/unknown/i.test(result.source_app) ? result.source_app : "";
    const nonUsd = result.currency && !/^usd$/i.test(result.currency);
    const warns = [...(result.warnings || [])];
    if (nonUsd) warns.unshift(`Prices in this screenshot look like ${result.currency}, not USD. Buy prices were left out, so enter them in USD.`);
    if (nonUsd) rows.forEach(r => { r.avg_buy_price = null; });
    body.innerHTML = `
      <p class="secondary" style="margin-top:0">${mode === "trades"
        ? `Found <b>${rows.length}</b> transaction${rows.length === 1 ? "" : "s"}${isCsv ? " in your CSV" : src ? ` in your ${esc(src)} screenshot` : ""}.`
        : `Found <b>${rows.length}</b> coin${rows.length === 1 ? "" : "s"}${isCsv ? " in your CSV" : src ? ` in your ${esc(src)} screenshot` : ""}.`}</p>
      ${warns.length ? `<div class="card" style="padding:10px 12px;margin-bottom:12px;font-size:13px">⚠️ ${warns.map(esc).join("<br>⚠️ ")}</div>` : ""}
      <div id="imp-rows"></div>
      <div class="row" style="margin-top:6px">
        ${mode === "trades" ? "" : `<label class="field"><span>Bought around</span><input type="datetime-local" id="imp-when" value="${toLocalInput(new Date())}"></label>`}
        <label class="field"><span>Exchange / wallet</span><input type="text" id="imp-exch" maxlength="60" value="${esc(src && !/coingecko|coinmarketcap/i.test(src) ? src : "")}" placeholder="MEXC, Binance, Phantom…"></label>
      </div>
      <div class="err" id="imp-err"></div>
      <div class="row" style="justify-content:space-between;align-items:center"><button class="link-btn" id="imp-again" type="button">${isCsv ? "Use a different file" : "Use different screenshots"}</button>
        <button class="btn primary" id="imp-save" style="flex:none"></button></div>`;
    paintRows();
    $("#imp-again", ov).onclick = () => stepPick();
    $("#imp-save", ov).onclick = save;
  }

  const isCsvR = () => result?.source_app === "CSV";
  function paintRows() {
    const list = $("#imp-rows", ov);
    list.innerHTML = rows.map((r, i) => {
      const shot = [r.symbol && String(r.symbol).toUpperCase(), r.name].filter(Boolean).join(" · ");
      const coin = r.match
        ? `<div class="picked" style="padding:6px 9px">${coinCell({ ...r.match, coin_id: r.match.id })}<button class="link-btn" type="button" data-change="${i}">Change</button></div>`
        : `<button class="btn" type="button" data-change="${i}" style="width:100%">Pick the coin</button>`;
      const flag = !r.match ? `<div class="hint" style="color:var(--bad)">Couldn't match “${esc(shot)}”. Pick it, or untick to skip.</div>`
        : !r.sure ? `<div class="hint" style="color:var(--bad)">Check this coin.</div>`
        : r.topUp ? `<div class="hint">You have ${fmtQty(r.heldQty)} logged and the screenshot shows ${fmtQty(r.shotQty)}, so only the extra ${fmtQty(r.quantity)} will be added.</div>`
        : r.alreadyHeld ? `<div class="hint">Already logged (you have ${fmtQty(r.heldQty)}), so it's unticked. Tick it only if this is a new buy on top.</div>` : "";
      if (mode === "trades") {
        const firstOfCoin = i === 0 || rows[i - 1].key !== r.key;
        const coinFlag = !r.match ? `<div class="hint" style="color:var(--bad);margin:-4px 0 8px">Couldn't match “${esc(shot)}”. Pick the coin.</div>`
          : !r.sure ? `<div class="hint" style="color:var(--bad);margin:-4px 0 8px">Check this coin.</div>` : "";
        const tot = num(r.quantity) * num(r.avg_buy_price);
        const paidHint = !r.paid ? "" : r.manualPrice ? `<div class="hint">Paid ${fmtQty(r.paid.amount)} ${esc(r.paid.currency)}</div>`
          : r.conv?.ok ? `<div class="hint">Paid ${fmtQty(r.paid.amount)} ${esc(r.paid.currency)} ≈ ${fmtUsd(r.paid.amount * r.conv.rate)} (${esc(r.paid.currency)} price that day)</div>`
          : `<div class="hint" style="color:var(--bad)">Paid ${fmtQty(r.paid.amount)} ${esc(r.paid.currency)}. Couldn't get that day's ${esc(r.paid.currency)} price, so enter the USD price per coin.</div>`;
        return `${firstOfCoin ? `<div style="margin:4px 0 8px">${coin}</div>${coinFlag}` : ""}<div class="card" style="padding:10px 12px;margin-bottom:10px;${r.include ? "" : "opacity:.6"}">
          <div style="display:flex;gap:10px;align-items:flex-start">
            <input type="checkbox" data-inc="${i}" ${r.include ? "checked" : ""} style="width:auto;margin-top:10px" aria-label="Import this trade">
            <div style="flex:1;min-width:0">
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><span class="tag" style="color:var(--${r.side === "sell" ? "bad" : "good"})">${r.side === "sell" ? "Sell" : "Buy"}</span><input type="date" data-date="${i}" value="${esc(r.date || "")}" style="flex:1"></div>
              ${r.dup ? `<div class="hint" style="margin-bottom:6px">Looks already logged (same coin, day and amount), so it's unticked.</div>` : ""}
              ${r.preCC ? `<div class="hint" style="margin-bottom:6px">Before CC started (June 2023), so it's unticked. Tick it if you still want it.</div>` : ""}
              <div class="row">
                <label class="field" style="margin-bottom:0"><span>Quantity</span><input type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" data-qty="${i}" value="${r.quantity != null ? esc(+Number(r.quantity).toPrecision(10)) : ""}"></label>
                <label class="field" style="margin-bottom:0"><span>Price per coin (USD)</span><input type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" data-price="${i}" value="${r.avg_buy_price != null ? esc(+Number(r.avg_buy_price).toPrecision(8)) : ""}">${r.paid ? paidHint : tot ? `<div class="hint">Total ${fmtUsd(tot)}</div>` : ""}</label>
              </div>
            </div>
          </div></div>`;
      }
      const priceHint = r.avg_buy_price == null ? `<div class="hint">Not in ${isCsvR() ? "file" : "screenshot"}. Leave empty to use today's price.</div>` : "";
      return `<div class="card" style="padding:10px 12px;margin-bottom:10px;${r.include ? "" : "opacity:.6"}">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <input type="checkbox" data-inc="${i}" ${r.include ? "checked" : ""} style="width:auto;margin-top:10px" aria-label="Import this coin">
          <div style="flex:1;min-width:0">
            ${coin}
            <div class="muted" style="font-size:12px;margin:4px 0 6px">${isCsvR() ? "From CSV" : "From screenshot"}: ${esc(shot)}${r.value ? ` · ${fmtUsd(r.value)}` : ""}</div>
            ${flag}
            <div class="row" style="margin-top:6px">
              <label class="field" style="margin-bottom:0"><span>Quantity</span><input type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" data-qty="${i}" value="${r.quantity != null ? esc(+Number(r.quantity).toPrecision(10)) : ""}" placeholder="0.00">${r.quantity_estimated ? `<div class="hint">Worked out from value ÷ price. Check it.</div>` : ""}</label>
              <label class="field" style="margin-bottom:0"><span>Avg buy price (USD)</span><input type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" data-price="${i}" value="${r.avg_buy_price != null ? esc(+Number(r.avg_buy_price).toPrecision(8)) : ""}" placeholder="${r.match && CG.info(r.match.id)?.price ? "today: " + esc(fmtPrice(CG.info(r.match.id).price)) : "0.00"}">${priceHint}</label>
            </div>
          </div>
        </div></div>`;
    }).join("");
    list.querySelectorAll("[data-inc]").forEach(cb => cb.onchange = () => { rows[+cb.dataset.inc].include = cb.checked; paintRows(); });
    list.querySelectorAll("[data-qty]").forEach(inp => inp.oninput = () => { rows[+inp.dataset.qty].quantity = inp.value; });
    list.querySelectorAll("[data-price]").forEach(inp => inp.oninput = () => { const r = rows[+inp.dataset.price]; r.avg_buy_price = inp.value === "" ? null : inp.value; r.manualPrice = inp.value !== ""; });
    list.querySelectorAll("[data-date]").forEach(inp => inp.onchange = async () => {
      const r = rows[+inp.dataset.date]; r.date = inp.value || null;
      applyDup(r); if (!r.dup && !r.preCC && r.match) r.include = true;
      if (r.paid && !r.manualPrice) await convertPaidTrades([r]);   // re-price with the new day's rate
      paintRows();
    });
    list.querySelectorAll("[data-change]").forEach(b => b.onclick = () => openCoinPicker(async (c) => {
      const r = rows[+b.dataset.change], m = { id: c.id, name: c.name, symbol: c.symbol, image: c.image };
      if (mode === "trades") { for (const x of rows) if (x.key === r.key) { x.match = m; x.sure = true; x.include = true; applyDup(x); } }
      else {
        r.match = m; r.sure = true;
        if (r.shotQty != null) r.quantity = r.shotQty;
        applyHeld(r); if (!r.alreadyHeld) r.include = true;
      }
      await CG.ensure([c.id]); paintRows();
    }));
    const n = rows.filter(r => r.include).length, btn = $("#imp-save", ov);
    if (btn) { btn.textContent = n ? `Import ${n} ${mode === "trades" ? "trade" : "coin"}${n === 1 ? "" : "s"}` : "Nothing selected"; btn.disabled = !n; }
  }

  async function save() {
    const err = $("#imp-err", ov); err.textContent = "";
    const when = mode === "trades" ? null : $("#imp-when", ov).value;
    if (mode !== "trades") {
      if (!when) return err.textContent = "Enter roughly when you bought.";
      if (new Date(when) > new Date(Date.now() + 5 * 60000)) return err.textContent = "The date can't be in the future.";
    }
    const picked = rows.filter(r => r.include);
    await CG.ensure(picked.filter(r => r.match).map(r => r.match.id));
    const out = [];
    for (const r of picked) {
      const label = String(r.match?.symbol || r.symbol || r.name || "a coin").toUpperCase();
      if (!r.match) return err.textContent = `Pick the right coin for ${label}, or untick it.`;
      const q = dec(r.quantity);
      if (!(q > 0)) return err.textContent = `Enter the quantity for ${label} as a number (e.g. 1500 or 0.25).`;
      let p = r.avg_buy_price == null || r.avg_buy_price === "" ? null : dec(r.avg_buy_price), usedToday = false;
      if (p != null && (Number.isNaN(p) || p < 0)) return err.textContent = `Enter ${label}'s buy price as a number (e.g. 0.67).`;
      let at = when ? new Date(when) : null;
      if (mode === "trades") {
        if (!r.date) return err.textContent = `Enter the date for the ${label} ${r.side} of ${fmtQty(q)}.`;
        at = new Date(r.date + "T12:00");
        if (at > new Date(Date.now() + 86400000)) return err.textContent = `The ${label} trade on ${r.date} is in the future.`;
        if (p == null) return err.textContent = `Enter the price for the ${label} ${r.side} on ${r.date}.`;
      }
      if (p == null) { p = CG.info(r.match.id)?.price; usedToday = true; if (!(p > 0)) return err.textContent = `No live price for ${label} right now. Enter its buy price.`; }
      out.push({ coin_id: r.match.id, symbol: r.match.symbol, name: r.match.name, side: mode === "trades" ? r.side : "buy", quantity: q, price_usd: p, fee_usd: num(r.fee),
        executed_at: at.toISOString(), exchange: r.exchange || $("#imp-exch", ov).value.trim() || null,
        note: r.note || (isCsvR() ? `Imported from CSV${usedToday ? " (no buy price; used price on import day)" : ""}`
          : `Imported from ${result.source_app && !/unknown/i.test(result.source_app) ? result.source_app + " " : ""}screenshot${usedToday ? " (buy price not shown; used price on import day)" : ""}`) });
    }
    const btn = $("#imp-save", ov); btn.disabled = true; btn.textContent = "Importing…";
    try {
      const saved = await api.addTxs(out);
      S.txs.push(...saved); ov.remove();
      toast(`Imported ${saved.length} ${mode === "trades" ? "trade" : "coin"}${saved.length === 1 ? "" : "s"}`);
      if (location.hash.replace("#", "") === "overview") render(); else location.hash = "overview";
    } catch (e) { btn.disabled = false; paintRows(); err.textContent = e.message || "Couldn't save. Try again."; }
  }

  stepPick();
}
function confirmModal(title, body, onYes) {
  const ov = document.createElement("div"); ov.className = "overlay";
  ov.innerHTML = `<div class="modal" style="max-width:380px"><h2>${esc(title)}</h2><p class="secondary">${esc(body)}</p><div class="row" style="justify-content:flex-end"><button class="btn" style="flex:none" id="no">Cancel</button><button class="btn primary" style="flex:none" id="yes">Confirm</button></div></div>`;
  document.body.appendChild(ov);
  $("#no", ov).onclick = () => ov.remove();
  $("#yes", ov).onclick = async () => { ov.remove(); await onYes(); };
}

