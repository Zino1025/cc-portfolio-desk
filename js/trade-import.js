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
const importSearch = (q) => CG.search(q, 8, 2);
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
  const id = IMPORT_BASE_IDS[cur] || (await importSearch(cur)).find(c => c.symbol.toUpperCase() === cur)?.id;
  return (importRateCache[key] = id ? await CG.historical(id, new Date(date + "T12:00")) : null);
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
// Accepts our own export (Delta format), Delta, CoinStats, CoinTracker, Koinly/Coinpanda, CoinTracking, or a simple sheet: coin, quantity, buy price, date.
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
// Column names used by Delta, CoinStats, CoinTracker, Koinly/Coinpanda, CoinTracking and simple sheets (lowercased, letters/digits only).
const CSV_COLS = {
  coin_id: ["coinid", "coingeckoid", "id", "apiid"],
  symbol: ["symbol", "coinsymbol", "ticker", "basecurrencyname", "basecurrency", "asset", "token", "currency"],
  name: ["name", "coinname", "assetname", "tokenname"],
  coin: ["coin", "crypto", "cryptocurrency"],
  quantity: ["quantity", "baseamount", "qty", "amount", "holdings", "balance", "units", "coins", "size"],
  price: ["priceusd", "price", "buyprice", "avgbuyprice", "averagebuyprice", "avgprice", "averageprice", "costpercoin", "pricepercoin", "entryprice", "entry", "avgcost"],
  total: ["totalusd", "quoteamount", "total", "cost", "totalcost", "costbasis", "invested", "totalspent", "spent"],
  quote: ["quotecurrency", "pair", "quoteasset", "pricecurrency"],
  value: ["value", "valueusd", "currentvalue"],
  date: ["executedat", "date", "datetime", "time", "timestamp", "dateutc", "buydate", "purchasedate", "bought"],
  side: ["side", "way", "type", "action", "transactiontype", "tag", "label"],
  basetype: ["basetype", "assettype", "assetclass"],
  in_qty: ["receivedquantity", "receivedamount", "buyamount", "inamount", "incomingamount"],
  in_cur: ["receivedcurrency", "buycurrency", "incurrency", "incomingcurrency"],
  out_qty: ["sentquantity", "sentamount", "sellamount", "outamount", "outgoingamount"],
  out_cur: ["sentcurrency", "sellcurrency", "outcurrency", "outgoingcurrency"],
  fee: ["feeusd", "feeamount", "fee", "fees"],
  fee_cur: ["feecurrencyname", "feecurrency", "feeasset", "feecoin"],
  exchange: ["exchange", "wallet", "platform"],
  note: ["note", "notes", "memo", "comment", "description"],
};
const CSV_FIAT = /^(USD|EUR|GBP|CAD|AUD|NZD|CHF|JPY|SGD|HKD|INR|KRW|BRL|TRY|NGN|ZAR|MXN|SEK|NOK|DKK|PLN)$/;
const csvUsd = (s) => s === "USD" || IMPORT_STABLES.has(s);
// "SOL (Solana)" → SOL + Solana; "PAAL" → ticker; "Paal AI" → name.
function csvCur(s) {
  s = String(s || "").trim(); const m = s.match(/^\$?([^()\s]+)\s*\((.+)\)$/);
  if (m) return { symbol: m[1].toUpperCase(), name: m[2].trim() };
  return /^\$?[A-Za-z0-9.]{1,10}$/.test(s) ? { symbol: s.replace(/^\$/, "").toUpperCase(), name: "" } : { symbol: "", name: s };
}
// → [YYYY-MM-DD, HH:MM | null] in local time. Timestamps with a zone (Z, +02:00, UTC) are converted.
function csvWhen(s) {
  s = String(s || "").trim(); if (!s) return [null, null];
  const p2 = (v) => String(v).padStart(2, "0"), local = (x) => [`${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`, `${p2(x.getHours())}:${p2(x.getMinutes())}`];
  if (/\d:\d\d(:\d\d(\.\d+)?)?\s*(Z|[+-]\d\d:?\d\d|UTC|GMT)$/i.test(s)) { const x = new Date(s.replace(/\s*UTC$/i, "Z")); if (!Number.isNaN(+x)) return local(x); }
  const tm = s.match(/[ T](\d{1,2}):(\d\d)/), time = tm ? `${p2(tm[1])}:${tm[2]}` : null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return [`${m[1]}-${p2(m[2])}-${p2(m[3])}`, time];
  m = s.match(/^(\d{1,2})([-/.])(\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const [a, b, y] = [+m[1], +m[3], m[4].length === 2 ? "20" + m[4] : m[4]];
    const [mo, d] = a > 12 || (m[2] === "." && b <= 12) ? [b, a] : [a, b];   // 25/03/2024 and 04.10.2018 → day first; otherwise month first
    return [`${y}-${p2(mo)}-${p2(d)}`, time];
  }
  const x = new Date(s); return Number.isNaN(+x) ? [null, null] : local(x);
}
function csvToImport(text) {
  const grid = parseCsvText(text), norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
  let col, h = -1;
  // Header = first row with a coin and an amount column (skips Delta's instruction lines).
  while (++h < Math.min(grid.length, 40)) {
    const head = grid[h].map(norm);
    head.forEach((x, i) => { if (x === "cur" && i) { const b = head[i - 1].replace(/(amount|quantity)$/, ""); head[i - 1] = b + "amount"; head[i] = b + "currency"; } });   // CoinTracking: Buy, Cur., Sell, Cur.
    col = {}; for (const [k, names] of Object.entries(CSV_COLS)) { const i = names.map(n => head.indexOf(n)).find(i => i >= 0); if (i != null) col[k] = i; }
    if ((col.quantity != null && (col.coin_id ?? col.symbol ?? col.name ?? col.coin) != null) || (col.in_qty ?? col.out_qty) != null) break;
  }
  if (h >= Math.min(grid.length, 40)) throw new Error("Couldn't find the coin and quantity columns. Use the template, or a Delta, CoinStats, CoinTracker or Koinly export.");
  const get = (r, k) => col[k] != null ? (r[col[k]] ?? "").trim() : "";
  const n = (v) => { const x = dec(v); return v !== "" && Number.isFinite(x) ? Math.abs(x) : null; };
  const warnings = [], items = []; let skipped = 0;
  for (const r of grid.slice(h + 1)) {
    const way = get(r, "side").toLowerCase(), [date, time] = csvWhen(get(r, "date"));
    if ((get(r, "basetype") && !/crypto/i.test(get(r, "basetype"))) || /transfer|dividend/.test(way)) { skipped++; continue; }
    let inL = null, outL = null;
    if ((col.in_qty ?? col.out_qty) != null) {   // received / sent columns
      const leg = (q, c) => n(get(r, q)) && get(r, c) ? { qty: n(get(r, q)), ...csvCur(get(r, c)) } : null;
      inL = leg("in_qty", "in_cur"); outL = leg("out_qty", "out_cur");
    } else {   // one coin per row (+ optional quote currency, e.g. Delta "Quote currency", CoinStats "Pair")
      const coin = { qty: n(get(r, "quantity")), ...csvCur(get(r, "symbol") || get(r, "coin")) };
      if (get(r, "name")) coin.name = get(r, "name");
      coin.id = get(r, "coin_id").toLowerCase() || null;
      const qcur = csvCur(get(r, "quote") || "USD").symbol || "USD", price = n(get(r, "price"));
      const qty = n(get(r, "total")) ?? (price != null && coin.qty ? price * coin.qty : null);
      const quote = qty != null ? { qty, symbol: qcur, name: "" } : null;
      if (/sell|withdraw|send|sent/.test(way)) { outL = coin; inL = quote; }
      else if (/deposit|receive|airdrop|reward|staking|income/.test(way)) inL = coin;
      else { inL = coin; outL = quote; }
    }
    const fee = !get(r, "fee_cur") || csvUsd(csvCur(get(r, "fee_cur")).symbol) ? n(get(r, "fee")) || 0 : 0;
    const before = items.length;
    for (const [c, other, side] of [[inL, outL, "buy"], [outL, inL, "sell"]]) {
      if (!c || !c.qty || CSV_FIAT.test(c.symbol) || (IMPORT_STABLES.has(c.symbol) && other)) continue;
      const usd = other && csvUsd(other.symbol);
      items.push({ name: c.name, symbol: c.symbol, coingecko_id_guess: c.id || null, quantity: c.qty, price: usd ? other.qty / c.qty : null,
        paid: other && !usd ? { amount: other.qty, currency: other.symbol } : null, value: n(get(r, "value")), date, time, side,
        fee: items.length === before ? fee : 0, exchange: get(r, "exchange") || null, note: get(r, "note") || null });
    }
    if (items.length === before) skipped++;
  }
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? " was" : "s were"} skipped (transfers, cash, stocks, or no coin/quantity).`);
  if (!items.length) throw new Error("No coins with a quantity found in that CSV.");
  if (col.date != null && items.filter(x => x.date).length >= items.length * 0.8) {
    return { source_app: "CSV", warnings, trades: items.map(x => ({ ...x, price_usd: x.price, total_usd: null })) };
  }
  return { source_app: "CSV", warnings, holdings: items.map(x => ({ ...x, avg_buy_price: x.price, current_price: null })) };
}
// Same columns as Delta's CSV import, so files move between Delta and the desk both ways.
const CSV_HEAD = "Date,Way,Base amount,Base currency (name),Base type,Quote amount,Quote currency,Exchange,Sent/Received from,Sent to,Fee amount,Fee currency (name),Broker,Notes";
function downloadCsvTemplate() {
  saveFile(`${CSV_HEAD}\n2024-03-10 14:30:00,BUY,0.05,BTC (Bitcoin),CRYPTO,3100,USD,Coinbase,,,,,,\n2024-05-02 09:15:00,BUY,100000,PAAL (PAAL AI),CRYPTO,12000,USD,MEXC,,,10,USD,,\n`, "cc-portfolio-template.csv");
}

function openImportModal() {
  const { ov } = openModal(`<div id="imp-body"></div>`, { title: "Import coins", style: "max-width:560px", backdrop: false });
  let busy = false;
  ov.querySelector(".x").onclick = () => { if (!busy || confirm("Stop the import?")) ov.remove(); };
  const body = $("#imp-body", ov), status = (t) => body.innerHTML = `<div class="spinner"></div><p class="secondary" style="text-align:center">${t}</p>`;
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
      <div style="display:flex;align-items:center;gap:10px;margin:16px 0 12px;color:var(--muted);font-size:12px"><span style="flex:1;border-top:1px solid var(--track)"></span>or<span style="flex:1;border-top:1px solid var(--track)"></span></div>
      <label class="btn" style="display:flex;justify-content:center;cursor:pointer">Upload CSV<input type="file" id="imp-csv" accept=".csv,text/csv,.txt,text/plain" style="display:none"></label>
      <div class="hint">Delta, CoinStats, CoinTracker or Koinly. <button class="link-btn" type="button" id="imp-tpl" style="font-size:12px">Download template</button></div>
      <div class="err" id="imp-err">${esc(msg)}</div>`;
    $("#imp-file", ov).onchange = (e) => { const files = [...e.target.files]; if (files.length) run(files); };
    $("#imp-csv", ov).onchange = (e) => { const f = e.target.files[0]; if (f) runCsv(f); };
    $("#imp-tpl", ov).onclick = downloadCsvTemplate;
  }

  async function runCsv(file) {
    if (file.size > 2e6) return stepPick("That CSV is too big (max 2 MB).");
    busy = true; status("Reading CSV…");
    try { result = csvToImport(await file.text()); await prepareRows(); }
    catch (e) { busy = false; stepPick(e.message || "Couldn't read that CSV."); }
  }
  async function prepareRows() {
    mode = (result.trades || []).length ? "trades" : "holdings";
    rows = mode === "trades"
      ? result.trades.map(t => ({ name: t.name, symbol: t.symbol, quantity: t.quantity, avg_buy_price: t.price_usd, total_usd: t.total_usd, current_price: null, coingecko_id_guess: t.coingecko_id_guess, side: t.side, date: t.date, time: t.time, paid: t.paid || null, fee: t.fee, exchange: t.exchange, note: t.note, include: true }))
      : (result.holdings || []).map(h => ({ ...h, include: true }));
    if (!rows.length) throw new Error((result.warnings || [])[0] || "No holdings found. Use a screenshot showing coins and amounts.");
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
    try {
      status("Preparing screenshots…");
      let slices = [];
      for (const f of files) slices = slices.concat(await screenshotSlices(f));
      if (slices.length > IMPORT_MAX_SLICES) throw new Error("Screenshots too long. Try fewer, or crop them.");
      status("Reading your holdings… (10–20 seconds)");
      result = await api.parseScreenshots(slices, /tx|trade|history/i.test(files[0]?.name || "") ? "trades" : "");
      await prepareRows();
    } catch (e) { busy = false; stepPick(e.message || "Couldn't read those screenshots. Check your connection and try again."); }
  }

  function stepConfirm() {
    const isCsv = result.source_app === "CSV";
    const src = !isCsv && result.source_app && !/unknown/i.test(result.source_app) ? result.source_app : "";
    const nonUsd = result.currency && !/^usd$/i.test(result.currency);
    const warns = [...(result.warnings || [])];
    if (nonUsd) warns.unshift(`Prices in this screenshot look like ${result.currency}, not USD. Buy prices were left out, so enter them in USD.`);
    if (nonUsd) rows.forEach(r => { r.avg_buy_price = null; });
    body.innerHTML = `
      <p class="secondary" style="margin-top:0">Found <b>${rows.length}</b> ${mode === "trades" ? "transaction" : "coin"}${rows.length === 1 ? "" : "s"}${isCsv ? " in your CSV" : src ? ` in your ${esc(src)} screenshot` : ""}.</p>
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
      const flag = !r.match ? `<div class="hint" style="color:var(--bad)">Couldn't match “${esc(shot)}”.</div>`
        : !r.sure ? `<div class="hint" style="color:var(--bad)">Check this coin.</div>`
        : r.topUp ? `<div class="hint">Adds only the extra ${fmtQty(r.quantity)} (you have ${fmtQty(r.heldQty)}).</div>`
        : r.alreadyHeld ? `<div class="hint">Already logged. Tick only if it's a new buy.</div>` : "";
      if (mode === "trades") {
        const firstOfCoin = i === 0 || rows[i - 1].key !== r.key;
        const coinFlag = !r.match ? `<div class="hint" style="color:var(--bad);margin:-4px 0 8px">Couldn't match “${esc(shot)}”.</div>`
          : !r.sure ? `<div class="hint" style="color:var(--bad);margin:-4px 0 8px">Check this coin.</div>` : "";
        const tot = num(r.quantity) * num(r.avg_buy_price);
        const paidHint = !r.paid ? "" : r.manualPrice ? `<div class="hint">Paid ${fmtQty(r.paid.amount)} ${esc(r.paid.currency)}</div>`
          : r.conv?.ok ? `<div class="hint">Paid ${fmtQty(r.paid.amount)} ${esc(r.paid.currency)} ≈ ${fmtUsd(r.paid.amount * r.conv.rate)}</div>`
          : `<div class="hint" style="color:var(--bad)">Couldn't convert ${fmtQty(r.paid.amount)} ${esc(r.paid.currency)}. Enter the USD price.</div>`;
        return `${firstOfCoin ? `<div style="margin:4px 0 8px">${coin}</div>${coinFlag}` : ""}<div class="card" style="padding:10px 12px;margin-bottom:10px;${r.include ? "" : "opacity:.6"}">
          <div style="display:flex;gap:10px;align-items:flex-start">
            <input type="checkbox" data-inc="${i}" ${r.include ? "checked" : ""} style="width:auto;margin-top:10px" aria-label="Import this trade">
            <div style="flex:1;min-width:0">
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><span class="tag" style="color:var(--${r.side === "sell" ? "bad" : "good"})">${r.side === "sell" ? "Sell" : "Buy"}</span><input type="date" data-date="${i}" value="${esc(r.date || "")}" style="flex:1"></div>
              ${r.dup ? `<div class="hint" style="margin-bottom:6px">Looks already logged.</div>` : ""}
              ${r.preCC ? `<div class="hint" style="margin-bottom:6px">Before CC started.</div>` : ""}
              <div class="row">
                <label class="field" style="margin-bottom:0"><span>Quantity</span><input type="text" inputmode="decimal" autocomplete="off" data-qty="${i}" value="${r.quantity != null ? esc(+Number(r.quantity).toPrecision(10)) : ""}"></label>
                <label class="field" style="margin-bottom:0"><span>Price (USD)</span><input type="text" inputmode="decimal" autocomplete="off" data-price="${i}" value="${r.avg_buy_price != null ? esc(+Number(r.avg_buy_price).toPrecision(8)) : ""}">${r.paid ? paidHint : tot ? `<div class="hint">Total ${fmtUsd(tot)}</div>` : ""}</label>
              </div>
            </div>
          </div></div>`;
      }
      const priceHint = r.avg_buy_price == null ? `<div class="hint">Not in ${isCsvR() ? "file" : "screenshot"}. Empty = today's price.</div>` : "";
      return `<div class="card" style="padding:10px 12px;margin-bottom:10px;${r.include ? "" : "opacity:.6"}">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <input type="checkbox" data-inc="${i}" ${r.include ? "checked" : ""} style="width:auto;margin-top:10px" aria-label="Import this coin">
          <div style="flex:1;min-width:0">
            ${coin}
            <div class="muted" style="font-size:12px;margin:4px 0 6px">${esc(shot)}${r.value ? ` · ${fmtUsd(r.value)}` : ""}</div>
            ${flag}
            <div class="row" style="margin-top:6px">
              <label class="field" style="margin-bottom:0"><span>Quantity</span><input type="text" inputmode="decimal" autocomplete="off" data-qty="${i}" value="${r.quantity != null ? esc(+Number(r.quantity).toPrecision(10)) : ""}" placeholder="0.00">${r.quantity_estimated ? `<div class="hint">Estimated. Check it.</div>` : ""}</label>
              <label class="field" style="margin-bottom:0"><span>Avg buy price (USD)</span><input type="text" inputmode="decimal" autocomplete="off" data-price="${i}" value="${r.avg_buy_price != null ? esc(+Number(r.avg_buy_price).toPrecision(8)) : ""}" placeholder="${r.match && CG.info(r.match.id)?.price ? "today: " + esc(fmtPrice(CG.info(r.match.id).price)) : "0.00"}">${priceHint}</label>
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
    if (btn) { btn.textContent = n ? `Import ${plural(n, mode === "trades" ? "trade" : "coin")}` : "Nothing selected"; btn.disabled = !n; }
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
        at = new Date(`${r.date}T${r.time || "12:00"}`);
        if (at > new Date(Date.now() + 86400000)) return err.textContent = `The ${label} trade on ${r.date} is in the future.`;
      }
      if (p == null) { p = await CG.historical(r.match.id, at || Date.now()).catch(() => null); usedToday = true; if (!(p > 0)) return err.textContent = `No price found for ${label} on that date. Enter its buy price.`; }
      out.push({ coin_id: r.match.id, symbol: r.match.symbol, name: r.match.name, side: mode === "trades" ? r.side : "buy", quantity: q, price_usd: p, fee_usd: num(r.fee),
        executed_at: at.toISOString(), exchange: r.exchange || $("#imp-exch", ov).value.trim() || null,
        note: r.note || (isCsvR() ? `Imported from CSV${usedToday ? " (no buy price; used market price on that date)" : ""}`
          : `Imported from ${result.source_app && !/unknown/i.test(result.source_app) ? result.source_app + " " : ""}screenshot${usedToday ? " (buy price not shown; used market price on that date)" : ""}`) });
    }
    const btn = $("#imp-save", ov); btn.disabled = true; btn.textContent = "Importing…";
    try {
      const saved = await api.addTxs(out);
      S.txs.push(...saved); ov.remove();
      toast(`Imported ${plural(saved.length, mode === "trades" ? "trade" : "coin")}`);
      if (location.hash.replace("#", "") === "overview") render(); else location.hash = "overview";
    } catch (e) { btn.disabled = false; paintRows(); err.textContent = e.message || "Couldn't save. Try again."; }
  }

  stepPick();
}
