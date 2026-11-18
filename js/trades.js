/* ===================== MEMBER: TRADES ===================== */
function tradesTable(txs, editable) {
  if (!txs.length) return `<div class="empty"><div class="big">No trades logged</div>${editable ? "Use “Add trade” to log your buys and sells with the exact time." : ""}</div>`;
  const rows = [...txs].sort((a, b) => new Date(b.executed_at) - new Date(a.executed_at));
  return `<div class="table-wrap"><table><thead><tr>${editable ? "<th></th>" : ""}<th>Date &amp; time</th><th>Side</th><th>Coin</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th><th class="r hide-sm">Fee</th><th class="hide-sm">Exchange</th><th class="hide-sm">Note</th>${editable ? "<th></th>" : ""}</tr></thead><tbody>
    ${rows.map(t => `<tr>
      ${editable ? `<td><button class="btn small" data-edit="${esc(t.id)}">Edit</button></td>` : ""}
      <td class="num" style="font-size:13px">${fmtDate(t.executed_at)}</td>
      <td><span class="tag ${t.side}">${t.side}</span></td>
      <td>${coinCell({ ...t, image: CG.info(t.coin_id)?.image })}</td>
      <td class="r num">${fmtQty(t.quantity)}</td>
      <td class="r num">${fmtPrice(t.price_usd)}</td>
      <td class="r num">${fmtUsd(num(t.quantity) * num(t.price_usd))}</td>
      <td class="r num hide-sm">${num(t.fee_usd) ? fmtUsd(t.fee_usd) : "—"}</td>
      <td class="hide-sm secondary">${esc(t.exchange || "—")}</td>
      <td class="hide-sm secondary" style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${esc(t.note || "")}">${esc(t.note || "")}</td>
      ${editable ? `<td class="r"><button class="link-btn" style="color:var(--bad)" data-del="${esc(t.id)}">Delete</button></td>` : ""}
    </tr>`).join("")}</tbody></table></div>`;
}
const TRADE_SORTS = { value: "Value", trades: "Most trades", name: "Name A–Z", recent: "Last trade", pnl: "P&L" };
function tradesByCoin() {
  const pf = computePortfolio(S.txs), groups = new Map();
  for (const t of S.txs) { if (!groups.has(t.coin_id)) groups.set(t.coin_id, []); groups.get(t.coin_id).push(t); }
  const list = [...groups.entries()].map(([id, txs]) => {
    txs.sort((a, b) => new Date(b.executed_at) - new Date(a.executed_at));
    const h = pf.holdings.find(x => x.coin_id === id), t0 = txs[0], info = CG.info(id);
    const bought = txs.filter(t => t.side === "buy").reduce((a, t) => a + num(t.quantity) * num(t.price_usd), 0);
    return { id, txs, h, symbol: t0.symbol, name: t0.name, image: info?.image, last: new Date(t0.executed_at), value: h?.value || 0, pnl: h?.pnl ?? null, pnlPct: h?.pnlPct, bought };
  });
  const k = S.tradeSort || "value";
  const cmp = { value: (a, b) => b.value - a.value, trades: (a, b) => b.txs.length - a.txs.length, name: (a, b) => String(a.name).localeCompare(b.name), recent: (a, b) => b.last - a.last, pnl: (a, b) => (b.pnl ?? -1e18) - (a.pnl ?? -1e18) }[k];
  return list.sort(cmp);
}
function coinTradesHtml(g) {
  const open = S.tradeOpen.has(g.id);
  const sumCell = (l, v) => `<div><span>${l}</span><b class="num">${v}</b></div>`;
  return `<div class="tc ${open ? "open" : ""}" data-tc="${esc(g.id)}">
    <button class="tc-head" type="button" data-toggle="${esc(g.id)}" aria-expanded="${open}">
      ${coinCell({ ...g, coin_id: g.id })}
      <div class="tc-stats num"><div>${g.h ? fmtUsd(g.value) : "Sold"}</div>${g.pnl != null ? `<div class="${signCls(g.pnl)}" style="font-size:12px">${fmtUsd(g.pnl)} (${fmtPct(g.pnlPct)})</div>` : `<div class="muted" style="font-size:12px">${g.txs.length} trade${g.txs.length === 1 ? "" : "s"}</div>`}</div>
      <span class="tc-chev" aria-hidden="true">›</span>
    </button>
    <div class="tc-sum">
      ${sumCell("Holdings", g.h ? fmtQty(g.h.qty) : "0")}
      ${sumCell("Avg buy", g.h ? fmtPrice(g.h.avg) : "—")}
      ${sumCell("Invested", fmtUsd(g.bought))}
      ${sumCell("Trades", `${g.txs.length}`)}
    </div>
    ${open ? `<div class="tc-tx">${g.txs.map(t => `<button type="button" class="tc-row tc-tap" data-edit="${esc(t.id)}">
        <div class="main"><div style="font-weight:550">${t.side === "sell" ? "Sell" : "Buy"}</div><div class="meta">${new Date(t.executed_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div></div>
        <div class="r num" style="flex:none"><div class="${t.side === "sell" ? "bad" : "good"}">${t.side === "sell" ? "−" : "+"} ${fmtQty(t.quantity)} ${esc(String(g.symbol || "").toUpperCase())}</div><div>${fmtUsd(num(t.quantity) * num(t.price_usd))}</div></div>
      </button>`).join("")}
      <div class="tc-row" style="justify-content:flex-end"><button class="link-btn" data-addfor="${esc(g.id)}">+ Add trade for ${esc(String(g.symbol || "").toUpperCase())}</button></div></div>` : ""}
  </div>`;
}
async function viewTrades(v) {
  await CG.ensure(S.txs.map(t => t.coin_id));
  if (!S.tradeOpen) S.tradeOpen = new Set();
  if (S.tradeFilter) { S.tradeView = "coin"; S.tradeOpen.add(S.tradeFilter); }
  const view = S.tradeView || "coin", groups = view === "coin" ? tradesByCoin() : [];
  const coins = [...new Map(S.txs.map(t => [t.coin_id, t])).values()].sort((a, b) => String(a.name).localeCompare(b.name));
  v.innerHTML = `
    <div class="page-head"><div><h1>Trades</h1><div class="secondary">${S.txs.length} trade${S.txs.length === 1 ? "" : "s"} · ${coins.length} coin${coins.length === 1 ? "" : "s"}</div></div>
      <div class="row" style="flex:0 1 auto;flex-wrap:wrap;justify-content:flex-end"><button class="btn" id="csv">Export CSV</button><button class="btn" id="import-shot">Import</button><button class="btn primary" id="add">+ Add trade</button></div></div>
    ${S.txs.length ? `<div class="tr-tools">
      <div class="seg"><button class="${view === "coin" ? "on" : ""}" data-view="coin">By coin</button><button class="${view === "all" ? "on" : ""}" data-view="all">All trades</button></div>
      ${view === "coin"
        ? `<select id="tr-sort" aria-label="Sort coins">${Object.entries(TRADE_SORTS).map(([k, l]) => `<option value="${k}" ${(S.tradeSort || "value") === k ? "selected" : ""}>Sort: ${l}</option>`).join("")}</select>
           <button class="link-btn" id="tr-expand">${groups.every(g => S.tradeOpen.has(g.id)) ? "Collapse all" : "Expand all"}</button>`
        : `<select id="tr-coin" aria-label="Filter by coin"><option value="">All coins</option>${coins.map(t => `<option value="${esc(t.coin_id)}" ${S.tradeCoin === t.coin_id ? "selected" : ""}>${esc(nameSym(t.name, t.symbol))}</option>`).join("")}</select>`}
    </div>` : ""}
    ${view === "coin" && S.txs.length ? `<div class="tc-list">${groups.map(coinTradesHtml).join("")}</div>`
      : `<div class="card">${tradesTable(S.tradeCoin ? S.txs.filter(t => t.coin_id === S.tradeCoin) : S.txs, true)}</div>`}`;
  S.tradeFilter = null;
  $("#add").onclick = () => openTradeModal();
  $("#import-shot").onclick = openImportModal;
  $("#csv").onclick = exportCsv;
  v.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { S.tradeView = b.dataset.view; render(); });
  $("#tr-sort") && ($("#tr-sort").onchange = (e) => { S.tradeSort = e.target.value; render(); });
  $("#tr-coin") && ($("#tr-coin").onchange = (e) => { S.tradeCoin = e.target.value || null; render(); });
  $("#tr-expand") && ($("#tr-expand").onclick = () => { const all = groups.every(g => S.tradeOpen.has(g.id)); groups.forEach(g => all ? S.tradeOpen.delete(g.id) : S.tradeOpen.add(g.id)); render(); });
  v.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => { const id = b.dataset.toggle; S.tradeOpen.has(id) ? S.tradeOpen.delete(id) : S.tradeOpen.add(id); render(); });
  v.querySelectorAll("[data-addfor]").forEach(b => b.onclick = () => openTradeModal(null, b.dataset.addfor));
  v.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openTradeModal(S.txs.find(t => t.id === b.dataset.edit)));
  v.querySelectorAll("[data-del]").forEach(b => b.onclick = () => confirmModal("Delete this trade?", "This can't be undone.", async () => {
    await api.deleteTx(b.dataset.del); S.txs = S.txs.filter(t => t.id !== b.dataset.del); toast("Trade deleted"); render();
  }));
}
function exportCsv() {
  const head = ["executed_at","side","coin_id","symbol","name","quantity","price_usd","fee_usd","exchange","note"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  saveCsv([head.join(","), ...S.txs.map(t => head.map(k => q(t[k])).join(","))].join("\n"), "cc-portfolio-trades.csv");
}

/* ---------- Trade modal ---------- */
function openTradeModal(existing, presetCoinId) {
  const t = existing ? { ...existing } : { side: "buy", executed_at: new Date().toISOString(), fee_usd: 0 };
  const src = existing || (presetCoinId && S.txs.find(x => x.coin_id === presetCoinId));
  let coin = src ? { id: src.coin_id, name: src.name, symbol: src.symbol, image: CG.info(src.coin_id)?.image } : null;
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <h2>${existing ? "Edit trade" : "Add trade"} <button class="x" aria-label="Close">×</button></h2>
    <div style="margin-bottom:16px"><div class="seg" id="side"><button data-s="buy" class="buy">Buy</button><button data-s="sell" class="sell">Sell</button></div></div>
    <div class="field-div"><span>Coin</span><div id="coin-slot"></div></div>
    <div class="row">
      <label class="field"><span>Quantity</span><input type="text" enterkeyhint="done" inputmode="decimal" autocomplete="off" id="qty" value="${existing ? esc(+Number(existing.quantity).toPrecision(12)) : ""}" placeholder="0.00"></label>
      <label class="field"><span>Price per coin</span><input type="text" enterkeyhint="done" inputmode="decimal" autocomplete="off" id="price" value="${existing ? esc(+Number(existing.price_usd).toPrecision(6)) : ""}" placeholder="$0.00"></label>
    </div>
    <label class="field"><span>Total</span><input type="text" enterkeyhint="done" inputmode="decimal" autocomplete="off" id="total" placeholder="$0.00"></label>
    <label class="field"><span>Date</span><input type="datetime-local" id="when" value="${toLocalInput(t.executed_at)}"></label>
    ${num(t.fee_usd) || t.note ? "" : `<button class="link-btn more-btn" type="button" id="show-extra">+ Add fee or note</button>`}
    <div id="extra" class="${num(t.fee_usd) || t.note ? "" : "hidden"}">
      <label class="field"><span>Fee <span class="muted">(optional)</span></span><input type="text" enterkeyhint="done" inputmode="decimal" autocomplete="off" id="fee" value="${num(t.fee_usd) ? esc(t.fee_usd) : ""}" placeholder="$0.00"></label>
      <label class="field"><span>Notes <span class="muted">(optional)</span></span><textarea id="note" maxlength="500">${esc(t.note || "")}</textarea></label>
    </div>
    <div class="err" id="trade-err"></div>
    <div class="row" style="justify-content:space-between;align-items:center">${existing ? `<button class="link-btn" id="del-trade" type="button" style="color:var(--bad)">Delete</button>` : "<span></span>"}
      <div class="row" style="flex:none;gap:8px"><button class="btn" id="cancel" style="flex:none">Cancel</button><button class="btn primary" id="save" style="flex:none">${existing ? "Save" : "Add trade"}</button></div></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector(".x").onclick = close; $("#cancel", ov).onclick = close;
  ov.addEventListener("click", e => { if (e.target === ov) close(); });
  $("#show-extra", ov) && ($("#show-extra", ov).onclick = (e) => { e.target.remove(); $("#extra", ov).classList.remove("hidden"); $("#fee", ov).focus(); });
  let side = t.side;
  const paintSide = () => ov.querySelectorAll("#side button").forEach(b => b.classList.toggle("on", b.dataset.s === side));
  ov.querySelectorAll("#side button").forEach(b => b.onclick = () => { side = b.dataset.s; paintSide(); });
  paintSide();
  const qty = $("#qty", ov), price = $("#price", ov), total = $("#total", ov);
  let priceTouched = !!existing, lastMoney = "price";   // which of price/total the user typed last
  const syncTotal = () => { const q = decOr0(qty.value), p = decOr0(price.value); if (q && p) total.value = +(q * p).toFixed(2); };
  const syncPrice = () => { const q = decOr0(qty.value), tt = decOr0(total.value); if (q && tt) price.value = +(tt / q).toPrecision(8); };
  qty.oninput = () => { lastMoney === "total" ? syncPrice() : syncTotal(); };
  price.oninput = () => { priceTouched = true; lastMoney = "price"; syncTotal(); };
  total.oninput = () => { priceTouched = true; lastMoney = "total"; syncPrice(); };
  syncTotal();

  const slot = $("#coin-slot", ov);
  function paintCoin() {
    if (coin) {
      slot.innerHTML = `<div class="picked">${coinCell({ ...coin, coin_id: coin.id })}<button class="link-btn" type="button" id="change-coin">Change</button></div>`;
      $("#change-coin", ov).onclick = () => { coin = null; paintCoin(); };
      if (!existing) prefillPrice();
      return;
    }
    slot.innerHTML = `<div class="search-wrap"><input type="search" enterkeyhint="done" id="coin-q" placeholder="Search coin" autocomplete="off"><div class="dropdown hidden" id="coin-dd"></div></div>`;
    const q = $("#coin-q", ov), dd = $("#coin-dd", ov);
    q.focus();
    const run = debounce(async () => {
      let s = q.value.trim();
      const m = s.match(/coingecko\.com\/(?:[a-z]{2}\/)?coins\/([a-z0-9-]+)/i);
      if (m) s = m[1];
      if (s.length < 2) { dd.classList.add("hidden"); return; }
      dd.classList.remove("hidden"); dd.innerHTML = `<div class="opt muted">Searching…</div>`;
      const res = await CG.search(s);
      if (!res.length) { dd.innerHTML = `<div class="opt muted">No coins found. Try the ticker or paste the CoinGecko page link.</div>`; return; }
      dd.innerHTML = res.map((c, i) => `<div class="opt" data-i="${i}">${coinCell({ ...c, coin_id: c.id }, true)}<span class="muted" style="font-size:12px">${c.rank ? "#" + c.rank : ""}</span></div>`).join("");
      dd.querySelectorAll(".opt[data-i]").forEach(o => o.onclick = () => { coin = res[+o.dataset.i]; paintCoin(); });
    }, 350);
    q.oninput = run;
  }
  // New trades: fill in the coin's price on the chosen date (until the user types their own).
  async function prefillPrice() {
    if (priceTouched || !coin) return;
    const p = await CG.historical(coin.id, $("#when", ov).value || Date.now()).catch(() => null);
    if (!priceTouched) { price.value = p ? +p.toPrecision(6) : ""; syncTotal(); }
  }
  $("#when", ov).addEventListener("change", prefillPrice);
  paintCoin();

  $("#del-trade", ov) && ($("#del-trade", ov).onclick = () => { close(); confirmModal("Delete this trade?", "This can't be undone.", async () => {
    await api.deleteTx(existing.id); S.txs = S.txs.filter(x => x.id !== existing.id); toast("Trade deleted"); render();
  }); });

  $("#save", ov).onclick = async () => {
    const err = $("#trade-err", ov); err.textContent = "";
    if (!coin) return err.textContent = "Pick a coin.";
    const q = dec(qty.value), p = dec(price.value), feeV = $("#fee", ov).value.trim() === "" ? 0 : dec($("#fee", ov).value);
    if (!(q > 0)) return err.textContent = "Quantity must be a number above 0 (e.g. 1500 or 0.25).";
    if (Number.isNaN(p) || p < 0 || price.value.trim() === "") return err.textContent = "Enter the price per coin as a number (e.g. 0.67).";
    if (Number.isNaN(feeV) || feeV < 0) return err.textContent = "Fee must be a number (or 0).";
    const when = $("#when", ov).value;
    if (!when) return err.textContent = "Enter the date and time.";
    if (new Date(when) > new Date(Date.now() + 5 * 60000)) return err.textContent = "Trade time can't be in the future.";
    if (side === "sell") {
      const held = computePortfolio(S.txs.filter(x => x.id !== existing?.id)).holdings.find(h => h.coin_id === coin.id)?.qty || 0;
      if (q > held + 1e-9) return err.textContent = `You only hold ${fmtQty(held)} ${String(coin.symbol || "").toUpperCase()} before this trade.`;
    }
    const row = { coin_id: coin.id, symbol: coin.symbol, name: coin.name, side, quantity: q, price_usd: p, fee_usd: feeV, executed_at: new Date(when).toISOString(), exchange: t.exchange || null, note: $("#note", ov).value.trim() || null };
    const btn = $("#save", ov); btn.disabled = true;
    try {
      if (existing) { const u = await api.updateTx(existing.id, row); S.txs = S.txs.map(x => x.id === existing.id ? u : x); toast("Trade updated"); }
      else { const n = await api.addTx(row); S.txs.push(n); toast("Trade added"); }
      close(); render();
    } catch (e) { btn.disabled = false; err.textContent = e.message || "Couldn't save."; }
  };
}
