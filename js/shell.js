/* ===================== SHELL ===================== */
function routes() {
  const r = [["overview", "Portfolio"], ["trades", "Trades"], ["rebalance", "Rebalance"], ["exit", "Exit plan"], ["projections", "Projections"], ["updates", "Market updates"], ["feedback", "Feedback from " + CONFIG.REVIEWER_NAME]];
  if (isAdmin()) r.push(["sep"], ["members", "Review queue"], ["insights", "Group insights"], ["model", "Model portfolio"]);
  r.push(["profile", "Profile"]);
  return r;
}
function currentRoute() {
  const h = location.hash.replace("#", "");
  if (h.startsWith("member-") && isAdmin()) return h;
  const valid = routes().map(r => r[0]);
  return valid.includes(h) ? h : (isAdmin() ? "members" : "overview");
}
function unreadCount() {
  const seen = S.me?.feedback_seen_at ? new Date(S.me.feedback_seen_at) : new Date(0);
  return S.msgs.filter(m => m.author_id !== S.me.id && new Date(m.created_at) > seen).length;
}
function openReviewCount() { return S.admin.profiles.filter(p => p.review_requested && p.role !== "admin").length; }

function renderShell() {
  const route = currentRoute();
  const unread = unreadCount();
  const demoBar = api.demo ? `<div class="banner">Demo mode with sample members<span id="price-src">${CG.offline ? " and sample prices (CoinGecko unreachable here)" : ""}</span>. Viewing as
      <select id="demo-user" style="width:auto;padding:3px 6px;margin-left:4px">${["u1","u2","u3","u4","dkay"].map(id => `<option value="${id}" ${api.currentId() === id ? "selected" : ""}>${id === "dkay" ? CONFIG.REVIEWER_NAME + " (reviewer)" : "Member: " + ({u1:"Alex",u2:"Mo",u3:"Sara",u4:"Jules"})[id]}</option>`).join("")}</select></div>` : "";
  $("#app").innerHTML = `
    ${demoBar}
    <header class="top"><div class="top-inner">
      <div class="brand"><span class="logo">${esc(CONFIG.GROUP_NAME)}</span><span class="hide-sm">Portfolio Desk</span></div>
      <nav class="tabs">${routes().map(([k, l]) => k === "sep" ? `<span class="sep"></span>` :
        `<a href="#${k}" class="${route === k || (k === "members" && route.startsWith("member-")) ? "active" : ""}">${esc(l)}${k === "feedback" && unread ? `<span class="badge">${unread}</span>` : ""}${k === "members" && openReviewCount() ? `<span class="badge">${openReviewCount()}</span>` : ""}${k === "updates" && alertCount() ? `<span class="badge">${alertCount()}</span>` : ""}</a>`).join("")}</nav>
      <div class="user-chip"><span class="hide-sm secondary">${esc(memberName(S.me))}</span>
        <button class="btn small" id="theme-btn" title="Toggle light/dark" aria-label="Toggle theme">☾ Theme</button>
        ${api.demo ? "" : `<button class="btn small" id="signout">Sign out</button>`}</div>
    </div></header>
    <main id="view"></main>`;
  $("#theme-btn").onclick = toggleTheme;
  $("#signout") && ($("#signout").onclick = async () => { LIVE.stop(); await api.signOut(); location.hash = ""; boot(); });
  $("#demo-user") && ($("#demo-user").onchange = async (e) => { api.setUser(e.target.value); location.hash = ""; S.proj = null; await loadMe(); render(); });
  renderView(route);
}
function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("cc-theme", root.dataset.theme); } catch (e) {}
  render();
}
document.addEventListener("change", (e) => { const id = e.target && e.target.dataset ? e.target.dataset.showpw : null; if (id) { const el = document.getElementById(id); if (el) el.type = e.target.checked ? "text" : "password"; } });
try { const t = localStorage.getItem("cc-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

function render() { renderShell(); }
window.addEventListener("hashchange", () => { if (location.hash !== "#trades") S.tradeFilter = null; S.me && render(); });

async function renderView(route) {
  Object.values(S.charts).forEach(c => c.destroy()); S.charts = {}; clearInterval(S.pcTimer);
  const v = $("#view");
  if (route === "overview") return viewOverview(v);
  if (route === "trades") return viewTrades(v);
  if (route === "projections") return viewProjections(v);
  if (route === "rebalance") return viewRebalance(v);
  if (route === "exit") return viewExit(v);
  if (route === "updates") return viewUpdates(v);
  if (route === "model") return isAdmin() ? viewModel(v) : viewOverview(v);
  if (route === "feedback") return viewFeedback(v);
  if (route === "profile") return viewProfile(v);
  if (route === "members") return viewMembers(v);
  if (route === "insights") return viewInsights(v);
  if (route.startsWith("member-")) return viewMemberDetail(v, route.slice(7));
}

/* ===================== MEMBER: OVERVIEW ===================== */
function kpiRow(pf) {
  const t = pf.totals;
  return `<div class="kpis">
    <div class="card kpi"><div class="label">Portfolio value</div><div class="value num">${fmtUsd(t.value)}</div><div class="sub num ${signCls(t.change24Usd)}">${fmtUsd(t.change24Usd)} (${fmtPct(t.change24Pct)}) 24h</div></div>
    <div class="card kpi"><div class="label">Invested (cost basis)</div><div class="value num">${fmtUsd(t.cost)}</div><div class="sub muted">avg-cost method, fees included</div></div>
    <div class="card kpi"><div class="label">Unrealized P&amp;L</div><div class="value num ${signCls(t.pnl)}">${fmtUsd(t.pnl)}</div><div class="sub num ${signCls(t.pnl)}">${fmtPct(t.pnlPct)}</div></div>
    <div class="card kpi"><div class="label">Realized P&amp;L</div><div class="value num ${signCls(t.realized)}">${fmtUsd(t.realized)}</div><div class="sub muted">from sells</div></div>
  </div>`;
}
function holdingsTable(pf, editable = false) {
  if (!pf.holdings.length) return `<div class="empty"><div class="big">No holdings yet</div>Add your first buy, or import everything at once from a screenshot or CSV file.${editable ? `<div style="margin-top:12px"><button class="btn primary" id="empty-import">⬆ Import screenshot or CSV</button></div>` : ""}</div>`;
  const list = `<div class="hl-list">${pf.holdings.map(h => `<div class="hl-row" ${editable ? `data-coin="${esc(h.coin_id)}"` : ""}>
      <div class="coin">${coinIcon(h)}</div>
      <div style="min-width:0"><div class="nm">${esc((h.symbol || h.coin_id).toUpperCase())} <span class="pill sm ${signCls(h.change24)}">${fmtPct(h.change24)}</span></div><div class="q num">${fmtQty(h.qty)} · ${fmtPrice(h.price)}${h.priceEstimated ? "*" : ""}</div></div>
      <div class="rt"><div class="val num">${fmtUsd(h.value)}</div><div class="num ${signCls(h.pnl)}" style="font-size:13px;font-weight:600">${signed(h.pnl)} (${fmtPct(h.pnlPct)})</div></div>
    </div>`).join("")}</div>`;
  return `${list}<div class="table-wrap hl-table"><table><thead><tr><th></th><th>Coin</th><th class="r">Holdings</th><th class="r">Avg buy</th><th class="r">Price</th><th class="r hide-sm">24h</th><th class="r">Value</th><th class="r">P&amp;L</th><th class="r hide-sm">Alloc</th><th class="hide-sm">First buy</th></tr></thead><tbody>
    ${pf.holdings.map((h, i) => `<tr ${editable ? `class="click" data-coin="${esc(h.coin_id)}" title="Tap to see and edit these trades"` : ""}>
      <td style="width:14px"><span class="swatch" style="background:${i < 7 ? `var(${SERIES[i]})` : "var(--other)"}"></span></td>
      <td>${editable ? coinCell(h) : `<a href="${coinLink(h.coin_id)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${coinCell(h)}</a>`}</td>
      <td class="r num">${fmtQty(h.qty)}</td>
      <td class="r num">${fmtPrice(h.avg)}</td>
      <td class="r num">${fmtPrice(h.price)}${h.priceEstimated ? ` <span class="muted" title="No live price; using last trade price">*</span>` : ""}</td>
      <td class="r num hide-sm"><span class="pill sm ${signCls(h.change24)}">${fmtPct(h.change24)}</span></td>
      <td class="r num">${fmtUsd(h.value)}</td>
      <td class="r num ${signCls(h.pnl)}" style="font-weight:600">${signed(h.pnl)}<div style="font-size:12px;font-weight:500">${fmtPct(h.pnlPct)}</div></td>
      <td class="r num hide-sm">${h.alloc.toFixed(1)}%</td>
      <td class="hide-sm secondary" style="font-size:13px">${fmtDate(h.firstBuy)}</td>
    </tr>`).join("")}</tbody></table></div>
    ${editable ? `<div class="hint">Tap a coin to see or edit its trades (buy price, amount, time).</div>` : ""}
    ${pf.estimated ? `<div class="hint">* No live CoinGecko price found; valued at your last trade price.</div>` : ""}`;
}
async function viewOverview(v) {
  v.innerHTML = `<div class="spinner"></div>`;
  await CG.ensure([...S.txs.map(t => t.coin_id), ...modelCoinIds()]);
  const pf = computePortfolio(S.txs);
  const has = pf.holdings.length, ex = exitStatus(S.me).state;
  v.innerHTML = `
    ${alertBanner()}
    <div class="page-head"><div><h1>My portfolio</h1><div class="secondary">Prices from CoinGecko${CG.offline ? " (sample, offline)" : ", refreshed every minute"}.</div></div>
      <div class="head-actions"><button class="btn" id="refresh">↻ Refresh</button><button class="btn" id="import-shot">⬆ Import</button><button class="btn primary" id="add">+ Add trade</button></div></div>
    ${has ? heroCard(pf) : ""}
    ${has ? `<div class="quick">
      <a class="card" href="#rebalance"><span class="ic">⚖️</span><div><div class="t">Rebalance</div><div class="d">vs ${esc(CONFIG.REVIEWER_NAME)}'s model</div></div><span class="go">›</span></a>
      <a class="card" href="#exit"><span class="ic">🎯</span><div><div class="t">${ex === "edited" ? "Re-commit exit plan" : "Exit plan"}</div><div class="d">${ex === "committed" ? "committed ✓" : "not committed yet"}</div></div><span class="go">›</span></a>
    </div>
    <div class="ov-grid">${donutCard("pie-me", "Allocation")}${perfCard("perf-me")}</div>` : ""}
    <div class="card"><div class="card-h"><h2>Holdings</h2>${has ? `<span class="sub">${has} coin${has > 1 ? "s" : ""}</span>` : ""}</div>${holdingsTable(pf, true)}</div>
    ${reviewNudge()}`;
  if (has) { renderDonut("pie-me", pf.holdings, "Total", pf.totals.value); renderPerf("perf-me", pf.holdings); paintHero(S.txs); }
  $("#add").onclick = () => openTradeModal();
  $("#import-shot").onclick = openImportModal;
  $("#empty-import") && ($("#empty-import").onclick = openImportModal);
  v.querySelectorAll("[data-coin]").forEach(tr => tr.onclick = () => { S.tradeFilter = tr.dataset.coin; location.hash = "trades"; });
  $("#refresh").onclick = async () => { await CG.ensure(pf.coinIds, 0); render(); };
  $("#ask-review") && ($("#ask-review").onclick = () => { location.hash = "feedback"; });
}
function reviewNudge() {
  if (!S.txs.length) return "";
  if (S.me.review_requested) return `<div class="card" style="margin-top:16px">⏳ You asked ${esc(CONFIG.REVIEWER_NAME)} for a review ${ago(S.me.review_requested_at)}. You'll see his notes under <a href="#feedback">Feedback</a>.</div>`;
  return `<div class="card" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><b>Want ${esc(CONFIG.REVIEWER_NAME)}'s eyes on this?</b><div class="secondary">Request a review here instead of DMing. He sees your full portfolio and replies in your Feedback tab.</div></div><button class="btn primary" id="ask-review">Request a review</button></div>`;
}

