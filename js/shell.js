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
        <button class="icon-btn sm" id="theme-btn" title="Toggle light/dark" aria-label="Toggle theme">${ICON.moon}</button>
        ${api.demo ? "" : `<button class="btn small" id="signout">Sign out</button>`}</div>
    </div></header>
    <main id="view"></main>`;
  $("#theme-btn").onclick = toggleTheme;
  $("#signout") && ($("#signout").onclick = async () => { LIVE.stop(); await api.signOut(); location.hash = ""; boot(); });
  $("#demo-user") && ($("#demo-user").onchange = async (e) => { api.setUser(e.target.value); location.hash = ""; S.proj = null; await loadMe(); render(); });
  const act = $("nav.tabs a.active"); act && act.scrollIntoView({ block: "nearest", inline: "center" });
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
function holdingsTable(pf, editable = false) {
  if (!pf.holdings.length) return `<div class="empty"><div class="big">No holdings yet</div>Add your first buy, or import everything at once from a screenshot or CSV file.${editable ? `<div style="margin-top:12px"><button class="btn primary" id="empty-import">Import screenshot or CSV</button></div>` : ""}</div>`;
  const list = `<div class="hl-list">${pf.holdings.map(h => `<div class="hl-row" ${editable ? `data-coin="${esc(h.coin_id)}"` : ""}>
      <div class="coin">${coinIcon(h)}</div>
      <div style="min-width:0"><div class="nm">${esc((h.symbol || h.coin_id).toUpperCase())}</div><div class="q num">${h.alloc.toFixed(0)}% · ${fmtQty(h.qty)} · ${fmtPrice(h.price)}${h.priceEstimated ? "*" : ""}</div></div>
      <div class="rt"><div class="val num">${fmtUsd(h.value)}</div><div class="num ${signCls(h.pnl)}">${signed(h.pnl)} · ${fmtPct(h.pnlPct)}</div><div class="inv num">Invested ${fmtUsd(h.cost)}</div></div>
    </div>`).join("")}</div>`;
  return `${list}<div class="table-wrap hl-table"><table><thead><tr><th></th><th>Coin</th><th class="r">Holdings</th><th class="r">Avg buy</th><th class="r">Price</th><th class="r hide-sm">24h</th><th class="r">Invested</th><th class="r">Value</th><th class="r">P&amp;L</th><th class="r hide-sm">Alloc</th><th class="hide-sm">First buy</th></tr></thead><tbody>
    ${pf.holdings.map((h, i) => `<tr ${editable ? `class="click" data-coin="${esc(h.coin_id)}" title="Tap to see and edit these trades"` : ""}>
      <td style="width:14px"><span class="swatch" style="background:${i < 7 ? `var(${SERIES[i]})` : "var(--other)"}"></span></td>
      <td>${editable ? coinCell(h) : `<a href="${coinLink(h.coin_id)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${coinCell(h)}</a>`}</td>
      <td class="r num">${fmtQty(h.qty)}</td>
      <td class="r num">${fmtPrice(h.avg)}</td>
      <td class="r num">${fmtPrice(h.price)}${h.priceEstimated ? ` <span class="muted" title="No live price; using last trade price">*</span>` : ""}</td>
      <td class="r num hide-sm"><span class="pill sm ${signCls(h.change24)}">${fmtPct(h.change24)}</span></td>
      <td class="r num secondary">${fmtUsd(h.cost)}</td>
      <td class="r num">${fmtUsd(h.value)}</td>
      <td class="r num ${signCls(h.pnl)}" style="font-weight:600">${signed(h.pnl)}<div style="font-size:12px;font-weight:500">${fmtPct(h.pnlPct)}</div></td>
      <td class="r num hide-sm">${h.alloc.toFixed(1)}%</td>
      <td class="hide-sm secondary" style="font-size:13px">${fmtDate(h.firstBuy)}</td>
    </tr>`).join("")}</tbody></table></div>
    ${pf.estimated ? `<div class="hint">* No live CoinGecko price found; valued at your last trade price.</div>` : ""}`;
}
async function viewOverview(v) {
  v.innerHTML = `<div class="spinner"></div>`;
  await CG.ensure([...S.txs.map(t => t.coin_id), ...modelCoinIds()]);
  const pf = computePortfolio(S.txs);
  const has = pf.holdings.length, ex = exitStatus(S.me).state;
  v.innerHTML = `
    ${alertBanner()}
    <div class="page-head"><div><h1>My portfolio</h1>${CG.offline ? `<div class="secondary">Sample prices (offline)</div>` : ""}</div>
      <div class="row" style="flex:none;gap:8px">${has ? `<button class="icon-btn" id="share" aria-label="Share a card of my returns">${ICON.share}</button>` : ""}<button class="icon-btn" id="refresh" aria-label="Refresh prices" title="Refresh prices">${ICON.refresh}</button></div></div>
    ${has ? heroCard(pf, "hero", S.flows) : ""}
    <div class="acts">
      <button class="act" id="add"><span class="icon-btn lg primary">${ICON.plus}</span>Add trade</button>
      <button class="act" id="import-shot"><span class="icon-btn lg">${ICON.upload}</span>Import</button>
      <a class="act" href="#rebalance"><span class="icon-btn lg">${ICON.scale}</span>Rebalance</a>
      <a class="act" href="#exit"><span class="icon-btn lg">${ICON.target}</span>${ex === "edited" ? "Re-commit" : "Exit plan"}${ex === "committed" ? `<span class="d">committed</span>` : ""}</a>
    </div>
    ${has ? `<div class="ov-grid">${donutCard("pie-me", "Allocation", true)}${perfCard("perf-me")}</div>` : ""}
    <div class="section-head"><h2>Holdings</h2>${has ? `<span class="muted">${has} coin${has > 1 ? "s" : ""}</span>` : ""}</div>
    <div class="card hl-card">${holdingsTable(pf, true)}</div>
    ${reviewNudge()}`;
  if (has) { renderDonut("pie-me", pf.holdings, "Total", pf.totals.value); bindRewind("pie-me", S.txs, pf.holdings, pf.totals.value); renderPerf("perf-me", pf.holdings); paintHero(S.txs); }
  $("#share") && ($("#share").onclick = () => shareCard(pf));
  $("#add").onclick = () => openTradeModal();
  $("#import-shot").onclick = openImportModal;
  $("#empty-import") && ($("#empty-import").onclick = openImportModal);
  v.querySelectorAll("[data-coin]").forEach(tr => tr.onclick = () => { S.tradeFilter = tr.dataset.coin; location.hash = "trades"; });
  $("#refresh").onclick = async () => { await CG.ensure(pf.coinIds, 0); render(); };
  $("#ask-review") && ($("#ask-review").onclick = () => { location.hash = "feedback"; });
}
function reviewNudge() {
  if (!S.txs.length) return "";
  if (S.me.review_requested) return `<a class="card cta-card" href="#feedback"><div><div class="t">Review requested ${ago(S.me.review_requested_at)}</div><div class="d">${esc(CONFIG.REVIEWER_NAME)}'s notes will show up in Feedback.</div></div><span class="icon-btn sm">${ICON.clock}</span></a>`;
  return `<button class="card cta-card" id="ask-review" style="width:100%;border:none;font:inherit;letter-spacing:inherit;text-align:left"><div><div class="t">Get ${esc(CONFIG.REVIEWER_NAME)}'s eyes on this</div><div class="d">He sees your full portfolio and replies in Feedback. No DMs needed.</div></div><span class="icon-btn sm primary">${ICON.arrow}</span></button>`;
}

