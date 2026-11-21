/* ===================== SHELL ===================== */
function routes() {
  const r = [["overview", "Portfolio"], ["updates", "Market"], ["feedback", "Feedback"], ["trades", "Trades"], ["exit", "Exit Plan"], ["rebalance", "Rebalance"], ["projections", "Projections"]];
  if (isAdmin()) r.push(["sep"], ["members", "Review Queue"], ["insights", "Group"], ["model", "Model portfolio"]);
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

// Bottom tab bar (Apple HIG: 5 tabs max, icon + label). Plan and Admin hold several pages behind a segmented control; Profile opens from the avatar.
const GROUPS = { plan: [["exit", "Exit Plan"], ["rebalance", "Rebalance"], ["projections", "Projections"]], admin: [["members", "Review"], ["insights", "Group"], ["model", "Model"]] };
const TAB_ICON = {
  pie: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15.5 3.7A9 9 0 0 1 20.3 8.5h-4.8z"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1-4.4A8.5 8.5 0 1 1 20.5 12z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/></svg>',
};
const SUB = { plan: "exit", admin: "members" };   // last page opened in each group
function tabs() {
  const t = [["overview", "Portfolio", TAB_ICON.pie], ["trades", "Trades", TAB_ICON.list], ["plan", "Plan", ICON.target], ["updates", "Market", TAB_ICON.chart]];
  return isAdmin() ? [["admin", "Admin", TAB_ICON.shield], ...t] : [...t, ["feedback", "Feedback", TAB_ICON.chat]];
}
const groupOf = (route) => route.startsWith("member-") ? "admin" : Object.keys(GROUPS).find(g => GROUPS[g].some(([k]) => k === route)) || route;
async function signOut() { LIVE.stop(); await api.signOut(); location.hash = ""; boot(); }

function render() {
  const route = currentRoute(), tab = groupOf(route), badge = (n) => n ? `<span class="badge">${n}</span>` : "";
  if (SUB[tab] && !route.startsWith("member-")) SUB[tab] = route;
  const counts = { feedback: unreadCount(), admin: openReviewCount(), updates: alertCount() }, me = memberName(S.me);
  $("#app").innerHTML = `
    <header class="top"><div class="top-inner">
      <div class="brand"><span class="logo" role="img" aria-label="${esc(CONFIG.GROUP_NAME)}"></span>Portfolio Desk</div>
      <div class="user-chip">
        ${canFullscreen() ? `<button class="icon-btn sm" id="fs-btn"></button>` : ""}
        <button class="icon-btn sm" id="theme-btn" title="Toggle light/dark" aria-label="Toggle theme">${ICON.moon}</button>
        <a href="#profile" class="avatar${route === "profile" ? " on" : ""}" aria-label="Profile">${esc((me.match(/[A-Za-z0-9]/) || ["?"])[0].toUpperCase())}</a></div>
    </div></header>
    <main id="view"></main>
    <nav class="tabbar" aria-label="Sections">${tabs().map(([k, l, ic]) => `<a data-tab="${k}" href="#${SUB[k] || k}"${tab === k ? ' class="active" aria-current="page"' : ""}>${ic}<span>${l}</span>${badge(counts[k])}</a>`).join("")}</nav>`;
  $("#theme-btn").onclick = toggleTheme;
  $("#fs-btn") && ($("#fs-btn").onclick = () => TG.isFullscreen ? TG.exitFullscreen() : TG.requestFullscreen()) && paintFsBtn();
  renderView(route);
}
// Telegram Desktop: expand the Mini App window to full screen and back.
const canFullscreen = () => !!(TG?.isVersionAtLeast?.("8.0") && /tdesktop|macos|web/.test(TG.platform));
function paintFsBtn() { const b = $("#fs-btn"); if (!b) return; b.innerHTML = TG.isFullscreen ? ICON.shrink : ICON.expand; b.setAttribute("aria-label", TG.isFullscreen ? "Exit full screen" : "Full screen"); }
function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("cc-theme", root.dataset.theme); } catch (e) {}
  render();
}
document.addEventListener("change", (e) => { const id = e.target && e.target.dataset ? e.target.dataset.showpw : null; if (id) { const el = document.getElementById(id); if (el) el.type = e.target.checked ? "text" : "password"; } });
try { const t = localStorage.getItem("cc-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
window.addEventListener("hashchange", () => { if (location.hash !== "#trades") S.tradeFilter = null; S.me && render(); });

function renderView(route) {
  Object.values(S.charts).forEach(c => c.destroy()); S.charts = {}; clearInterval(S.pcTimer);
  let v = $("#view");
  if (route.startsWith("member-")) return viewMemberDetail(v, route.slice(7));
  const g = GROUPS[groupOf(route)];
  if (g) { v.innerHTML = `<nav class="seg seg-fill subnav">${g.map(([k, l]) => `<a href="#${k}"${k === route ? ' class="on" aria-current="page"' : ""}>${l}</a>`).join("")}</nav><div id="subview"></div>`; v = $("#subview"); }
  ({ overview: viewOverview, trades: viewTrades, projections: viewProjections, rebalance: viewRebalance, exit: viewExit, updates: viewUpdates, model: viewModel,
     feedback: viewFeedback, profile: viewProfile, members: viewMembers, insights: viewInsights })[route](v);
}

/* ===================== MEMBER: OVERVIEW ===================== */
function holdingsTable(pf, editable = false) {
  if (!pf.holdings.length) return `<div class="empty"><div class="big">No holdings yet</div>Add a buy, or import your whole portfolio.${editable ? `<div style="margin-top:12px"><button class="btn primary" id="empty-import">Import screenshot or CSV</button></div>` : ""}</div>`;
  const list = `<div class="hl-list">${pf.holdings.map(h => `<div class="hl-row" ${editable ? `data-coin="${esc(h.coin_id)}"` : ""}>
      <div class="coin">${coinIcon(h)}</div>
      <div style="min-width:0"><div class="nm">${esc((h.symbol || h.coin_id).toUpperCase())}</div><div class="q num">${h.alloc.toFixed(0)}% · ${fmtPrice(h.price)}${h.priceEstimated ? "*" : ""}</div></div>
      <div class="rt"><div class="val num">${fmtUsd(h.value)}</div><div class="num ${signCls(h.pnl)}">${fmtPct(h.pnlPct)}</div></div>
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
  // Paint straight away from saved prices when every coin has one; fetch fresh ones behind it and repaint once.
  const ids = [...S.txs.map(t => t.coin_id), ...modelCoinIds()], stale = ids.some(id => !(Date.now() - (CG.cache[id]?.at || 0) < 60000));
  if (ids.every(id => CG.cache[id]?.price != null)) { if (stale) CG.ensure(ids).then(() => !CG.offline && currentRoute() === "overview" && !document.querySelector(".overlay") && render()); }
  else { v.innerHTML = `<div class="spinner"></div>`; await CG.ensure(ids); }
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
      <a class="act" href="#exit"><span class="icon-btn lg">${ICON.target}</span>${ex === "edited" ? "Re-commit" : "Exit Plan"}${ex === "committed" ? `<span class="d">committed</span>` : ""}</a>
    </div>
    ${has ? `<div class="ov-grid">${donutCard("pie-me", "Allocation", true)}${perfCard("perf-me")}</div>` : ""}
    <div class="section-head"><h2>Holdings</h2>${has ? `<span class="muted">${plural(has, "coin")}</span>` : ""}</div>
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

