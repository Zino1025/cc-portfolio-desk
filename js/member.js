/* ===================== FEEDBACK THREAD ===================== */
// Open the thread at its newest message and stay pinned there while photos/videos load in
// (they load after the first scroll and would otherwise leave it short of the bottom). Stops once the user scrolls up.
function pinThreadBottom(th) {
  if (!th) return;
  let stick = true;
  const toEnd = () => { if (stick) th.scrollTop = th.scrollHeight; };
  toEnd(); requestAnimationFrame(toEnd);
  th.addEventListener("scroll", () => { stick = th.scrollHeight - th.scrollTop - th.clientHeight < 40; }, { passive: true });
  th.addEventListener("load", toEnd, true); th.addEventListener("loadedmetadata", toEnd, true);
}
function threadHtml(msgs, viewerId, memberId, names) {
  if (!msgs.length) return `<div class="empty">No messages yet.</div>`;
  return msgs.map(m => {
    const fromReviewer = m.author_id !== memberId;
    const mine = m.author_id === viewerId;
    const who = fromReviewer ? (names?.[m.author_id] || CONFIG.REVIEWER_NAME) : (mine ? "You" : names?.[m.author_id] || "Member");
    const kindTag = m.kind && m.kind !== "note" && m.kind !== "reply" ? `<span class="tag">${esc(m.kind)}</span>` : "";
    const coinTag = m.coin_id ? `<a class="tag" href="${coinLink(m.coin_id)}" target="_blank" rel="noopener">${esc((CG.info(m.coin_id)?.symbol || m.coin_id).toUpperCase())}</a>` : "";
    return `<div class="msg ${mine ? "mine" : ""} ${fromReviewer ? "reviewer" : ""}"><div class="meta"><b>${esc(who)}</b>${kindTag}${coinTag}<span>${ago(m.created_at)}</span>${mine ? `<button class="link-btn" data-delmsg="${esc(m.id)}" style="font-size:12px;color:var(--muted)">delete</button>` : ""}</div>${esc(m.body)}${ATT.html(m.attachments)}</div>`;
  }).join("");
}
async function viewFeedback(v) {
  S.msgs = await api.messages(S.me.id);
  const req = S.me.review_requested;
  v.innerHTML = `
    <div class="page-head"><div><h1>Feedback from ${esc(CONFIG.REVIEWER_NAME)}</h1></div></div>
    <div class="two-col">
      <div class="card">
        <h2>Portfolio review</h2>
        ${req ? `<div class="callout">Review requested ${ago(S.me.review_requested_at)}${S.me.review_question ? `:\n“${esc(S.me.review_question)}”` : ""}</div>
                 <button class="btn" id="cancel-req">Cancel request</button>`
              : `<p class="secondary" style="margin-top:0">${S.me.last_reviewed_at ? `Last reviewed ${ago(S.me.last_reviewed_at)}.` : "Not reviewed yet."}</p>
                 <label class="field"><span>What do you want feedback on?</span><textarea id="req-q" maxlength="1000" placeholder="e.g. Am I too heavy on one coin? Should I take profit on X?"></textarea></label>
                 <button class="btn primary" id="req">Request a review</button>`}
      </div>
      <div class="card"><h2>Messages</h2>
        <div class="thread" id="thread">${threadHtml(S.msgs, S.me.id, S.me.id)}</div>
        <div class="composer"><textarea id="reply" maxlength="4000" placeholder="Reply or ask a follow-up…"></textarea>${ATT.pickerHtml("att-reply")}<div style="text-align:right"><button class="btn primary" id="send">Send</button></div></div>
      </div>
    </div>`;
  pinThreadBottom($("#thread"));
  if (unreadCount()) { S.me = await api.updateProfile(S.me.id, { feedback_seen_at: new Date().toISOString() }); paintBadge("feedback", 0); }
  $("#req") && ($("#req").onclick = async () => {
    const q = $("#req-q").value.trim();
    S.me = await api.updateProfile(S.me.id, { review_requested: true, review_question: q || null, review_requested_at: new Date().toISOString() });
    if (q) await api.addMessage({ member_id: S.me.id, kind: "question", body: q });
    toast("Review requested"); render();
  });
  $("#cancel-req") && ($("#cancel-req").onclick = async () => { S.me = await api.updateProfile(S.me.id, { review_requested: false }); render(); });
  ATT.bind("att-reply");
  $("#send").onclick = async () => {
    const body = $("#reply").value.trim(), btn = $("#send");
    if (!body && !ATT.files("att-reply").length) return $("#reply").focus();
    btn.disabled = true;
    try {
      const attachments = await ATT.upload("att-reply", `msg/${S.me.id}`, (i, n) => { btn.textContent = `Uploading ${i}/${n}…`; });
      btn.textContent = "Sending…";
      await api.addMessage({ member_id: S.me.id, kind: "reply", body, ...(attachments ? { attachments } : {}) });
      render();
    } catch (e) { toast(e.message || "Couldn't send"); btn.disabled = false; btn.textContent = "Send"; }
  };
  bindMsgDelete(v, render);
}
function bindMsgDelete(v, after) {
  v.querySelectorAll("[data-delmsg]").forEach(b => b.onclick = () => confirmModal("Delete message?", "It will be removed for both of you.", async () => { await api.deleteMessage(b.dataset.delmsg); after(); }));
}

/* ===================== PROJECTIONS ===================== */
const PROJ_MULTS = [0, 2, 3, 5, 10, 50, 100];   // 0 = today's price
function projFromPortfolio() {
  const pf = computePortfolio(S.txs);
  return pf.holdings.map(h => ({ id: uid(), coin_id: h.coin_id, symbol: h.symbol, name: h.name, image: h.image, own: true, qty: h.qty, cost: h.cost, invest: "", target: "", mult: "" }));
}
function projRowCalc(r) {
  const now = CG.info(r.coin_id)?.price ?? 0;
  const qty = r.own ? r.qty : now > 0 ? decOr0(r.invest) / now : 0, cost = r.own ? r.cost : decOr0(r.invest);
  let target = r.target !== "" ? dec(r.target) : NaN;
  if (Number.isNaN(target) && r.mult !== "") target = now * dec(r.mult);
  if (Number.isNaN(target)) target = now;
  const valueNow = qty * now, valueProj = qty * target, mcap = CG.info(r.coin_id)?.mcap;
  return { now, qty, cost, target, valueNow, valueProj, profit: valueProj - cost, mult: now > 0 ? target / now : 0, mcapAtTarget: mcap && now > 0 ? mcap * target / now : null };
}
function openCoinPicker(onPick) {
  const { ov, close } = openModal(`<div class="search-wrap"><input type="search" id="pick-q" placeholder="Search coin…" autocomplete="off"><div class="dropdown hidden" id="pick-dd"></div></div>`, { title: "Add a coin" });
  const q = $("#pick-q", ov); q.focus();
  coinSearch(q, $("#pick-dd", ov), (c) => { close(); onPick(c); });
}
async function viewProjections(v) {
  const hasPf = computePortfolio(S.txs).holdings.length > 0;
  if (!S.proj) S.proj = { src: hasPf ? "pf" : "blank", rows: hasPf ? projFromPortfolio() : [] };
  await CG.ensure([...S.txs.map(t => t.coin_id), ...S.proj.rows.map(r => r.coin_id)]);
  v.innerHTML = `
    <div class="page-head"><div><h1>Projections</h1></div><button class="icon-btn primary" id="pj-add" aria-label="Add coin">${ICON.plus}</button></div>
    ${hasPf ? `<div class="seg" id="pj-src" style="width:100%;margin-bottom:16px"><button style="flex:1" data-src="pf">My portfolio</button><button style="flex:1" data-src="blank">From scratch</button></div>` : ""}
    <div id="pj-wi"></div>
    <div class="card"><div class="section-head" style="flex-wrap:wrap"><h2>Targets</h2><div class="periods" id="pj-mall">${PROJ_MULTS.map(m => `<button data-m="${m}">${(m || 1) + "×"}</button>`).join("")}</div></div><div id="pj-list"></div></div>`;
  $("#pj-add").onclick = () => openCoinPicker(async c => {
    if (!S.proj.rows.some(r => r.coin_id === c.id && !r.own)) S.proj.rows.push({ id: uid(), coin_id: c.id, symbol: c.symbol, name: c.name, image: c.image, own: false, qty: 0, cost: 0, invest: "1000", target: "", mult: "" });
    await CG.ensure([c.id]); paintProj();
  });
  v.querySelectorAll("[data-src]").forEach(b => b.onclick = () => { S.proj.src = b.dataset.src; S.proj.rows = b.dataset.src === "pf" ? projFromPortfolio() : []; paintProj(); });
  v.querySelectorAll("#pj-mall [data-m]").forEach(b => b.onclick = () => { S.proj.rows.forEach(r => { r.mult = b.dataset.m === "0" ? "" : b.dataset.m; r.target = ""; }); paintProj(); });
  paintProj();
}
function paintProj() {
  const list = $("#pj-list"); if (!list) return;
  const rows = S.proj.rows, calcs = rows.map(projRowCalc);
  document.querySelectorAll("#pj-src [data-src]").forEach(b => b.classList.toggle("on", b.dataset.src === S.proj.src));
  const allM = rows.length && rows.every(r => r.target === "" && r.mult === rows[0].mult) ? (rows[0].mult || "0") : null;
  document.querySelectorAll("#pj-mall [data-m]").forEach(b => b.classList.toggle("on", b.dataset.m === allM));
  if (!rows.length) { list.innerHTML = `<div class="empty">Tap <b>+</b> to add a coin and see what it could be worth.</div>`; paintWhatIf(rows, calcs); return; }
  list.innerHTML = rows.map((r, i) => { const c = calcs[i], L = tpLevels(tpFor(r.coin_id, r.symbol) || {}).filter(l => l.k !== "mid"); return `<div class="pj-row" data-row="${esc(r.id)}">
      <div class="hl-row"><div class="coin">${coinIcon(r)}</div>
        <div style="min-width:0"><div class="nm">${esc(symOf(r.coin_id) || r.symbol.toUpperCase())}</div><div class="q num">${c.qty ? fmtQty(c.qty) + " · " : ""}${fmtPrice(c.now)}</div></div>
        <div class="rt"><div class="val num">${fmtUsd(c.valueProj)}</div><div class="num ${signCls(c.profit)}">${signed(c.profit)}</div></div></div>
      <div class="pj-in">
        ${r.own ? "" : `<label class="field"><span>$ to invest</span><input type="text" inputmode="decimal" data-f="invest" value="${esc(r.invest)}"></label>`}
        <label class="field"><span>Price</span><input type="text" inputmode="decimal" data-f="target" value="${esc(r.target !== "" ? r.target : r.mult !== "" ? +c.target.toPrecision(6) : "")}" placeholder="${esc(fmtPrice(c.now))}"></label>
        ${L.length ? `<label class="field"><span>Exit TP</span><select data-tp><option value="">Pick…</option>${L.map(l => `<option value="${l.price}" ${num(r.target) === l.price ? "selected" : ""}>${l.label} · ${fmtPrice(l.price)}</option>`).join("")}</select></label>` : ""}
      </div>
      <div class="pj-foot"><span class="muted num">${c.mult ? +c.mult.toFixed(2) + "× today" : ""}${c.mcapAtTarget ? ` · MC ${fmtUsd(c.mcapAtTarget, { compact: true })}` : ""}</span><button class="link-btn" data-rm="${esc(r.id)}">Remove</button></div>
    </div>`; }).join("");
  const commit = debounce(() => paintProjKeepFocus(), 600);
  list.querySelectorAll("input[data-f]").forEach(inp => inp.oninput = () => {
    const r = rows.find(x => x.id === inp.closest("[data-row]").dataset.row);
    r[inp.dataset.f] = inp.value.trim(); if (inp.dataset.f === "target") r.mult = "";
    commit();
  });
  list.querySelectorAll("[data-tp]").forEach(sel => sel.onchange = () => { if (!sel.value) return; const r = rows.find(x => x.id === sel.closest("[data-row]").dataset.row); r.target = sel.value; r.mult = ""; paintProj(); });
  list.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { S.proj.rows = rows.filter(x => x.id !== b.dataset.rm); paintProj(); });
  paintWhatIf(rows, calcs);
}
/* What if: these coins (amounts from the table) at past prices, then a dashed line to the projected value. Whole portfolio or one coin. */
async function paintWhatIf(rows, calcs) {
  const box = $("#pj-wi"); if (!box) return;
  const tok = (S.wiTok = (S.wiTok || 0) + 1), ids = [...new Set(rows.map(r => r.coin_id))];
  if (!ids.length) { box.innerHTML = ""; return; }
  if (S.proj.scope !== "all" && !ids.includes(S.proj.scope)) S.proj.scope = "all";
  const scope = S.proj.scope, days = S.proj.days ||= 365;
  const pick = rows.map((r, i) => [r, calcs[i]]).filter(([r, c]) => c.qty > 0 && (scope === "all" || r.coin_id === scope));
  const proj = pick.reduce((a, [, c]) => a + c.valueProj, 0), nowV = pick.reduce((a, [, c]) => a + c.valueNow, 0);
  const cost = pick.reduce((a, [, c]) => a + c.cost, 0), profit = proj - cost;
  if (!box.querySelector(".hero")) box.innerHTML = `<div class="card hero" style="margin-bottom:16px">
    <div class="hero-head"><div><div class="label" id="wi-label">What if</div><div class="big num" id="wi-big"></div><div class="chg" id="wi-chg"></div></div>
      <div class="periods" id="wi-days">${HIST_PERIODS.filter(([d]) => d >= 30).map(([d, l]) => `<button data-d="${d}">${l}</button>`).join("")}</div></div>
    <div class="chips" id="wi-scope" style="margin:14px 0 2px"></div>
    <div class="hero-chart" id="wi-chart"><div class="note">Loading chart…</div></div><div class="hero-stats" id="wi-stats"></div></div>`;
  box.querySelectorAll("#wi-days button").forEach(b => { b.classList.toggle("on", +b.dataset.d === days); b.onclick = () => { S.proj.days = +b.dataset.d; paintWhatIf(rows, calcs); }; });
  $("#wi-stats").innerHTML = `<div><div class="l">Today</div><div class="v num">${fmtUsd(nowV)}</div></div>
    <div><div class="l">Profit</div><div class="v num ${signCls(profit)}">${signed(profit)}</div></div>
    <div><div class="l">Return</div><div class="v num ${signCls(profit)}">${cost > 0 ? (proj / cost).toFixed(2) + "×" : "—"}</div><div class="s num ${signCls(profit)}">${cost > 0 ? fmtPct(profit / cost * 100) : ""}</div></div>`;
  $("#wi-scope").innerHTML = ids.length > 1 ? [["all", "Portfolio"], ...ids.map(id => [id, symOf(id)])].map(([k, l]) => `<button class="chip ${scope === k ? "on" : ""}" data-sc="${esc(k)}">${esc(l)}</button>`).join("") : "";
  box.querySelectorAll("[data-sc]").forEach(b => b.onclick = () => { S.proj.scope = b.dataset.sc; paintWhatIf(rows, calcs); });
  const series = {};
  await Promise.all(pick.map(async ([r]) => { try { series[r.coin_id] = await CG.chart(r.coin_id, days); } catch (e) {} }));
  if (tok !== S.wiTok || !box.isConnected) return;
  if (S.charts.wi) { S.charts.wi.destroy(); delete S.charts.wi; }
  const chart = $("#wi-chart"), N = 60, now = Date.now(), from = now - days * 864e5;
  if (!pick.length || !Object.values(series).some(x => x && x.length)) { chart.innerHTML = `<div class="note">${pick.length ? "Couldn't load price history. Try again in a minute." : "Add an amount to see this."}</div>`; return; }
  const pts = Array.from({ length: N }, (_, i) => { const t = from + (now - from) * i / (N - 1); return { t, v: pick.reduce((a, [r, c]) => a + c.qty * priceAt(series[r.coin_id], t, c.now), 0) }; });
  pts[N - 1].v = nowV;
  const a = pts[0].v, col = cssVar(nowV < a ? "--bad" : "--good"), pcol = cssVar(proj < nowV ? "--bad" : "--good");
  const fmtT = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: days > 90 ? "2-digit" : undefined });
  const head = (lbl, v, d, base, when) => { $("#wi-label").textContent = lbl; $("#wi-big").textContent = fmtUsd(v); $("#wi-chg").innerHTML = `${base > 0 ? `<span class="pill ${signCls(d)}">${arrow(d)} ${fmtPct(d / base * 100)}</span>` : ""}<span class="num ${signCls(d)}">${signed(d)}</span><span>${when}</span>`; };
  const live = () => head("Projected", proj, proj - nowV, nowV, "vs today");
  live();
  chart.innerHTML = `<canvas id="wi-cv" role="img" aria-label="Past value and projected value"></canvas>`;
  const scales = readableScales(pts.map(p => p.t), days, compactUsd);
  scales.x.ticks.callback = (v, i) => i === N ? "Target" : new Date(pts[i].t).toLocaleDateString(undefined, days <= 7 ? { weekday: "short" } : days <= 90 ? { month: "short", day: "numeric" } : { month: "short", year: "2-digit" });
  const onScrub = (i) => i == null || i === N ? live() : head(scope === "all" ? "These coins back then" : symOf(scope) + " back then", pts[i].v, nowV - pts[i].v, pts[i].v, `to today · ${fmtT(pts[i].t)}`);
  S.charts.wi = new Chart($("#wi-cv"), {
    type: "line", plugins: [scrubPlugin],
    data: { labels: [...pts.map(p => p.t), "Target"], datasets: [
      { data: [...pts.map(p => p.v), null], borderColor: col, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.35, fill: false },
      { data: [...Array(N - 1).fill(null), nowV, proj], borderColor: pcol, borderDash: [6, 5], borderWidth: 2.5, pointRadius: [...Array(N).fill(0), 5], pointBackgroundColor: pcol, pointHoverRadius: 5, fill: false } ] },
    options: { ...scrubOptions(onScrub), animation: { duration: 300 }, layout: { padding: { left: 2, right: 8, top: 8 } }, scales, plugins: { legend: { display: false }, tooltip: { enabled: false } } },
  });
  scrubEnd(S.charts.wi, onScrub);
}
function paintProjKeepFocus() {
  const a = document.activeElement, rowId = a?.closest?.("[data-row]")?.dataset.row, f = a?.dataset?.f, pos = a?.selectionStart;
  paintProj();
  if (rowId && f) { const el = document.querySelector(`[data-row="${rowId}"] input[data-f="${f}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
}

/* ===================== MEMBER: PROFILE ===================== */
async function viewProfile(v) {
  const p = S.me;
  v.innerHTML = `
    <div class="page-head"><div><h1>Profile</h1></div></div>
    <div class="card" style="max-width:560px">
      <label class="field"><span>Display name</span><input type="text" id="p-name" maxlength="60" value="${esc(p.display_name || "")}"></label>
      <label class="field"><span>Telegram handle</span><input type="text" id="p-tg" maxlength="40" autocapitalize="off" spellcheck="false" value="${esc(p.telegram_handle || "")}" placeholder="@yourhandle"></label>
      <div class="secondary" style="font-size:13px;margin:-4px 0 12px">${p.telegram_chat_id ? "Telegram notifications on" : "Telegram notifications off. Open the app from the CC bot to turn them on."}</div>
      <label class="field"><span>Risk appetite</span><select id="p-risk" class="as-seg">${["", "low", "medium", "high", "degen"].map(r => `<option value="${r}" ${p.risk_level === r || (!p.risk_level && !r) ? "selected" : ""}>${r ? r[0].toUpperCase() + r.slice(1) : "Choose…"}</option>`).join("")}</select></label>
      <label class="field"><span>Date you joined ${esc(CONFIG.GROUP_NAME)} <span class="muted">(optional)</span></span><input type="date" id="p-joined" max="${todayISO()}" value="${esc(p.cc_joined_on || "")}"></label>
      <label class="field"><span>Goal &amp; time horizon</span><textarea id="p-goal" maxlength="500" placeholder="e.g. Long-term hold, 2 years, want to 3x">${esc(p.goal || "")}</textarea></label>
      <div class="err" id="p-err"></div>
      <button class="btn primary" id="p-save">Save profile</button>
      <hr style="border:none;border-top:1px solid var(--track);margin:20px 0">
      <div class="secondary" style="font-size:13px;margin-bottom:8px">Signed in as ${esc(S.email || "")}</div>
      <label class="field"><span>New password</span><input type="password" enterkeyhint="go" id="p-pw" minlength="8" autocomplete="new-password"></label>
      <label class="showpw"><input type="checkbox" data-showpw="p-pw"> Show password</label>
      <button class="btn" id="p-pw-save">Change password</button>
      ${isStandalone() ? "" : `<hr style="border:none;border-top:1px solid var(--track);margin:20px 0"><button class="btn" id="p-install">Add to home screen</button>`}
    </div>
    <div class="card" style="max-width:560px;margin-top:16px"><h2>Report a bug</h2>
      <label class="field"><span>Type</span><select id="tk-kind" class="as-seg"><option value="bug">Bug</option><option value="idea">Idea</option></select></label>
      <label class="field"><span>What happened?</span><textarea id="tk-body" maxlength="2000" placeholder="What you tapped, what you expected, what you saw…"></textarea></label>
      <div class="err" id="tk-err"></div>
      <button class="btn primary" id="tk-send">Send</button>
    </div>
    ${p.gets_tickets ? `<div class="card" style="max-width:560px;margin-top:16px"><h2>Open tickets</h2><div id="tk-list"><div class="spinner"></div></div></div>` : ""}`;
  $("#p-install") && ($("#p-install").onclick = () => { try { localStorage.removeItem("cc-install-hide"); } catch (e) {} if (!$(".install")) installBanner(); if (!$(".install")) toast("Open the Desk in Safari or Chrome to add it."); });
  $("#tk-send").onclick = async () => {
    const body = $("#tk-body").value.trim(); $("#tk-err").textContent = "";
    if (body.length < 3) return $("#tk-err").textContent = "Describe it in a few words first.";
    try { await api.addTicket({ kind: $("#tk-kind").value, body }); $("#tk-body").value = ""; toast("Sent. Thanks!"); }
    catch (e) { $("#tk-err").textContent = e.message; }
  };
  const paintTickets = async () => {
    const box = $("#tk-list"); if (!box) return;
    try {
      const ts = await api.tickets(), who = (id) => memberName(S.admin.profiles.find(x => x.id === id) || (id === S.me.id ? S.me : {}));
      box.innerHTML = ts.length ? ts.map(t => `<div class="tk"><div class="tk-h"><b>${t.kind === "idea" ? "Idea" : "Bug"} · ${esc(who(t.user_id))}</b><span class="muted">${ago(t.created_at)}</span></div><div>${esc(t.body)}</div><button class="btn small" data-done="${esc(t.id)}">Mark done</button></div>`).join("") : `<div class="secondary">No open tickets.</div>`;
      box.querySelectorAll("[data-done]").forEach(b => b.onclick = async () => { try { await api.closeTicket(b.dataset.done); paintTickets(); } catch (e) { toast("Couldn't update: " + e.message); } });
    } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
  paintTickets();
  $("#p-save").onclick = async () => {
    try {
      const patch = { display_name: $("#p-name").value.trim() || null, telegram_handle: $("#p-tg").value.trim().replace(/^@/, "") || null, risk_level: $("#p-risk").value || null, goal: $("#p-goal").value.trim() || null, cc_joined_on: $("#p-joined").value || null };
      try { S.me = await api.updateProfile(p.id, patch); }
      catch (e) { if (!/cc_joined_on/.test(e.message || "")) throw e; delete patch.cc_joined_on; S.me = await api.updateProfile(p.id, patch); }   // column not added yet
      toast("Profile saved"); render();
    } catch (e) { $("#p-err").textContent = e.message; }
  };
  $("#p-pw-save").onclick = async () => {
    const pw = $("#p-pw").value; if (pw.length < 8) return $("#p-err").textContent = "Password needs 8+ characters.";
    try { await api.updatePassword(pw); toast("Password changed"); $("#p-pw").value = ""; } catch (e) { $("#p-err").textContent = e.message; }
  };
}

/* ===================== MODEL PORTFOLIO (Dkay's target mix) ===================== */
// TET and ACN are fixed. The rest (30%) is a flexible pool the member splits between PAAL, VELO and OTK.
const DEFAULT_MODEL = {
  version: 2,
  fixed: [
    { coin: "tectum", pct: 40 },
    { coin: "solidus-aitech", pct: 30 },
  ],
  flex: [
    { coin: "paal-ai", max: 30 },
    { coin: "velo", max: 30 },
    { coin: "octo-gaming", max: 10 },
  ],
  presets: [
    { name: "Even split", mix: { "paal-ai": 10, "velo": 10, "octo-gaming": 10 } },
    { name: "PAAL-heavy", mix: { "paal-ai": 20, "velo": 10, "octo-gaming": 0 } },
    { name: "All PAAL", mix: { "paal-ai": 30, "velo": 0, "octo-gaming": 0 } },
  ],
  drift: 2,     // % points before we suggest a trade
  drop24: 15,   // urgent-bid alert: 24h drop of this % or more
  drop7: 25,    // ...or 7-day drop of this % or more
};
const STABLE_IDS = ["tether", "usd-coin", "dai", "first-digital-usd", "ethena-usde"];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = (v) => Math.round(v * 10) / 10;
function getModel() { return S.model || DEFAULT_MODEL; }
function poolSize(m = getModel()) { return Math.max(0, 100 - m.fixed.reduce((s, f) => s + num(f.pct), 0)); }
function modelCoinIds(m = getModel()) { return [...new Set([...m.fixed.map(f => f.coin), ...m.flex.map(f => f.coin)])]; }
function symOf(id) { const i = CG.info(id); return ((i && i.symbol) || SAMPLE_PRICES[id]?.symbol || id).toUpperCase(); }
/** Make a flex mix add up to the pool, respecting each coin's max. `keep` is the coin the member just moved. */
function normalizeMix(m, mix, keep) {
  const pool = poolSize(m), cap = (f) => Math.min(num(f.max) || pool, pool), out = {};
  for (const f of m.flex) out[f.coin] = clamp(num(mix[f.coin]), 0, cap(f));
  const fixed = new Set(keep ? [keep] : []);
  for (let pass = 0; pass < 12; pass++) {
    const gap = pool - m.flex.reduce((s, f) => s + out[f.coin], 0);
    if (Math.abs(gap) < 1e-6) break;
    const adj = m.flex.filter(f => !fixed.has(f.coin) && (gap > 0 ? out[f.coin] < cap(f) - 1e-9 : out[f.coin] > 1e-9));
    if (!adj.length) { if (fixed.size) { fixed.clear(); continue; } break; }
    const w = adj.map(f => gap > 0 ? cap(f) - out[f.coin] : out[f.coin]), W = w.reduce((s, x) => s + x, 0) || 1;
    adj.forEach((f, i) => { out[f.coin] = clamp(out[f.coin] + gap * w[i] / W, 0, cap(f)); });
  }
  for (const k in out) out[k] = r1(out[k]);
  const drift = r1(pool - Object.values(out).reduce((s, x) => s + x, 0));
  if (drift && m.flex.length) { const big = m.flex.filter(f => f.coin !== keep).sort((a, b) => out[b.coin] - out[a.coin])[0] || m.flex[0]; out[big.coin] = r1(out[big.coin] + drift); }
  return out;
}
function presetIndex(prefs) { return prefs && Number.isInteger(prefs.preset) ? prefs.preset : null; }
/** The member's flex mix: their custom mix, else their chosen preset, else the first preset. */
function memberMix(m, prefs = {}) {
  if (prefs.mix && !Number.isInteger(prefs.preset)) return normalizeMix(m, prefs.mix);
  const p = m.presets[presetIndex(prefs) ?? 0] || m.presets[0];
  return normalizeMix(m, p ? p.mix : {});
}
function mixLabel(m, prefs = {}) {
  if (prefs.mix && !Number.isInteger(prefs.preset)) return "Custom split";
  return (m.presets[presetIndex(prefs) ?? 0] || {}).name || "Default";
}
/** Per-coin target % for a member. */
function modelTargets(m, prefs = {}) {
  const coins = {};
  for (const f of m.fixed) coins[f.coin] = (coins[f.coin] || 0) + num(f.pct);
  const mix = memberMix(m, prefs);
  for (const f of m.flex) coins[f.coin] = (coins[f.coin] || 0) + num(mix[f.coin]);
  return { coins, mix };
}
/**
 * Build an add-only plan (CC only adds). Coins outside the model are left out.
 * `need` = what each coin needs to reach its target without selling anything.
 * With new money, it fills the biggest gaps first, then follows the target mix.
 */
function modelPlan(pf, m, prefs, { newMoney = 0 } = {}) {
  const T = modelTargets(m, prefs);
  const val = {}; for (const h of pf.holdings) val[h.coin_id] = h.value;
  const cashNow = STABLE_IDS.reduce((s, id) => s + (val[id] || 0), 0);
  const ids = Object.keys(T.coins);
  const others = pf.holdings.filter(h => !(h.coin_id in T.coins));
  const otherVal = others.reduce((s, h) => s + h.value, 0);
  const baseNow = ids.reduce((s, id) => s + (val[id] || 0), 0);
  const money = Math.max(0, newMoney);
  // Smallest total where every coin can sit at its target without selling.
  const fullBase = Math.max(baseNow, ...ids.filter(id => T.coins[id] > 0).map(id => (val[id] || 0) / (T.coins[id] / 100)));
  const rows = ids.map(id => {
    const h = pf.holdings.find(x => x.coin_id === id);
    const info = CG.info(id);
    const now = val[id] || 0;
    return { id, symbol: symOf(id), name: info?.name || h?.name || id, image: info?.image, price: info?.price ?? h?.price ?? 0,
      target: T.coins[id], now, need: Math.max(0, fullBase * T.coins[id] / 100 - now), change24: info?.change24, change7: info?.change7 };
  });
  const needSum = rows.reduce((s, r) => s + r.need, 0);
  for (const r of rows) {
    r.nowPct = baseNow > 0 ? r.now / baseNow * 100 : 0;
    r.gapAfter = Math.max(0, (baseNow + money) * r.target / 100 - r.now);
    r.targetVal = (baseNow + money) * r.target / 100;
  }
  // New money goes only to coins that are below target at the new total, in proportion to how far below they are.
  const gapSum = rows.reduce((s, r) => s + r.gapAfter, 0);
  for (const r of rows) {
    r.action = money > 0 && gapSum > 0 ? r.gapAfter * Math.min(1, money / gapSum) : 0;
    r.qty = r.price > 0 ? r.action / r.price : 0;
    r.afterPct = baseNow + money > 0 ? (r.now + r.action) / (baseNow + money) * 100 : 0;
  }
  return { T, rows, baseNow, needSum, money, others, otherVal, cashNow };
}
function planFor(p, pf, opts) { return modelPlan(pf, getModel(), p?.model_prefs || {}, opts); }

/* ===================== MARKET ALERTS ===================== */
function priceDrops(m = getModel()) {
  const out = [];
  for (const id of modelCoinIds(m)) {
    const i = CG.info(id); if (!i) continue;
    const d24 = num(i.change24), d7 = num(i.change7);
    if (d24 <= -m.drop24 || (i.change7 != null && d7 <= -m.drop7)) out.push({ id, symbol: symOf(id), name: i.name, image: i.image, price: i.price, change24: d24, change7: i.change7 });
  }
  return out;
}
function activeUrgent() {
  const now = Date.now();
  return (S.updates || []).filter(u => u.kind === "urgent" && (!u.expires_at || new Date(u.expires_at) > now));
}
// Badge counts alerts the member hasn't seen yet. Opening Market updates marks them seen (a new drop day counts as new).
function alertKeys() { const day = todayISO(); return [...activeUrgent().map(u => "u:" + u.id), ...priceDrops().map(d => `d:${d.id}:${day}`)]; }
function alertCount() { const seen = new Set(S.me?.alerts_seen || []); return alertKeys().filter(k => !seen.has(k)).length; }
async function markAlertsSeen() {
  const keys = alertKeys();
  if (keys.every(k => (S.me.alerts_seen || []).includes(k))) return;
  try { S.me = await api.updateProfile(S.me.id, { alerts_seen: keys }); } catch (e) { S.me.alerts_seen = keys; }
  paintBadge("updates", alertCount());
}
function paintBadge(route, n) {
  const a = document.querySelector(`nav.tabs a[href="#${route}"]`); if (!a) return;
  a.querySelector(".badge")?.remove();
  if (n) a.insertAdjacentHTML("beforeend", `<span class="badge">${n}</span>`);
}
/** Suggested $ for an urgent bid: fill the member's gap on that coin, paid from dry powder if they have it. */
function bidSuggestion(coinId) {
  const pf = computePortfolio(S.txs);
  const plan = planFor(S.me, pf, {});
  const r = plan.rows.find(x => x.id === coinId);
  if (!r) return { text: "Not part of the model mix.", amount: 0 };
  const gap = Math.max(0, r.targetVal - r.now);
  if (!plan.baseNow) return { text: `No holdings logged yet. ${symOf(coinId)} is ${r.target.toFixed(1)}% of the model mix.`, amount: 0 };
  if (gap < 1) return { text: `You're already at or above your ${r.target.toFixed(1)}% target for ${symOf(coinId)}.`, amount: 0 };
  const fromCash = Math.min(gap, plan.cashNow);
  return { amount: gap, text: `You're ${fmtUsd(gap)} under your ${r.target.toFixed(1)}% target (${r.nowPct.toFixed(1)}% now).` +
    (fromCash > 0 ? ` You have ${fmtUsd(plan.cashNow)} in stables to bid with.` : " You have no stables logged, so this would be new money.") };
}

/* ===================== GROUP TOTAL ===================== */
async function groupTotals() {
  const rows = await api.groupHoldings();
  await CG.ensure(rows.map(r => r.coin_id));
  let value = 0, chg = 0;
  for (const r of rows) { const i = CG.info(r.coin_id); if (!i) continue; const v = num(r.qty) * num(i.price); value += v; chg += v - v / (1 + num(i.change24) / 100); }
  return { value, change24: chg, change24Pct: value - chg > 0 ? chg / (value - chg) * 100 : 0, members: rows[0]?.members || 0 };
}
function groupKpi(g) {
  return `<div class="card kpi"><div class="label">${esc(CONFIG.GROUP_NAME)} group total</div><div class="value num">${fmtUsd(g.value, { compact: g.value >= 1e6 })}</div><div class="sub num ${signCls(g.change24)}">${fmtPct(g.change24Pct)} 24h · ${plural(g.members, "member")}</div></div>`;
}

/* ===================== MEMBER: REBALANCE (add-only) ===================== */
function planTable(plan, m) {
  const drift = m.drift, buying = plan.money > 0;
  const fmtAct = (r) => {
    if (r.action >= 0.5) return `<span class="tag buy">Add</span> <b class="num">${fmtUsd(r.action)}</b>${r.qty ? `<div class="muted num" style="font-size:12px">≈ ${fmtQty(r.qty)} ${esc(r.symbol)}</div>` : ""}`;
    if (r.nowPct - r.target >= drift) return `<span class="muted">Over target · hold</span>`;
    if (r.need >= 0.5 && r.target - r.nowPct >= drift) return `<span class="secondary">Add when you can</span>`;
    return `<span class="muted">On target</span>`;
  };
  return `<div class="table-wrap"><table class="plan"><thead><tr><th>Coin</th><th class="r">Now → target</th><th class="r hide-sm">Value now</th><th class="r hide-sm">Needs (no selling)</th><th>${buying ? "This buy" : "Suggestion"}</th></tr></thead><tbody>
    ${plan.rows.map(r => {
      const off = Math.abs(r.nowPct - r.target) >= drift;
      return `<tr><td>${coinCell({ ...r, symbol: r.symbol.toLowerCase(), coin_id: r.id })}</td>
        <td class="r num" style="white-space:nowrap"><span class="${off ? (r.nowPct > r.target ? "secondary" : "") : "good"}">${r.nowPct.toFixed(1)}%</span> <span class="muted">→ ${r.target.toFixed(1)}%</span></td>
        <td class="r num hide-sm">${fmtUsd(r.now)}</td><td class="r num hide-sm">${r.need >= 0.5 && r.nowPct < r.target ? "+" + fmtUsd(r.need) : "—"}</td>
        <td>${fmtAct(r)}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}
function mixSliders(m, mix) {
  const pool = poolSize(m);
  return m.fixed.map(f => `<div class="bucket"><div class="bucket-head"><b>${esc(symOf(f.coin))}</b><span class="num"><b>${num(f.pct).toFixed(0)}%</b> <span class="muted">fixed</span></span></div></div>`).join("") +
    `<div class="bucket" style="border-bottom:none;padding-bottom:0"><div class="bucket-head"><b>Flexible ${pool}%</b></div></div>` +
    m.flex.map(f => `<div class="bucket flex">
      <div class="bucket-head"><span>${esc(symOf(f.coin))}</span><span class="num"><b id="fx-${esc(f.coin)}">${num(mix[f.coin]).toFixed(1)}%</b> <span class="muted">max ${Math.min(num(f.max) || pool, pool)}%</span></span></div>
      <input type="range" class="range" min="0" max="${Math.min(num(f.max) || pool, pool)}" step="0.5" value="${num(mix[f.coin])}" data-flex="${esc(f.coin)}" aria-label="${esc(symOf(f.coin))} share of the flexible ${pool}%">
    </div>`).join("");
}
async function viewRebalance(v) {
  v.innerHTML = `<div class="spinner"></div>`;
  const m = getModel();
  await CG.ensure([...S.txs.map(t => t.coin_id), ...modelCoinIds(m)]);
  S.reb ||= { newMoney: 0 };
  let prefs = JSON.parse(JSON.stringify(S.me.model_prefs || {}));
  const save = debounce(async () => {
    try { S.me = await api.updateProfile(S.me.id, { model_prefs: prefs }); } catch (e) { toast("Couldn't save: " + e.message); }
  }, 700);
  const paint = () => {
    const pf = computePortfolio(S.txs);
    const plan = modelPlan(pf, m, prefs, { newMoney: S.reb.newMoney });
    const drift = m.drift;
    const tgt = Object.entries(plan.T.coins).filter(([, p]) => p > 0).map(([id, p]) => ({ symbol: symOf(id), name: CG.info(id)?.name || id, value: p, alloc: p }));
    $("#reb-body").innerHTML = `
      <div class="kpis">
        <div class="card kpi"><div class="label">Model coins value</div><div class="value num">${fmtUsd(plan.baseNow)}</div></div>
        <div class="card kpi"><div class="label">Under target</div><div class="value num">${plan.rows.filter(r => r.target - r.nowPct >= drift).length}</div></div>
        <div class="card kpi"><div class="label">To be fully on target</div><div class="value num good">${fmtUsd(plan.needSum)}</div></div>
        ${plan.money ? `<div class="card kpi"><div class="label">This buy</div><div class="value num">${fmtUsd(plan.money)}</div></div>` : ""}
      </div>
      <div class="card"><h2>Your plan</h2>${plan.baseNow || plan.money ? planTable(plan, m) : `<div class="empty"><div class="big">Nothing to balance yet</div>Log your holdings, or enter new money above to plan your first buys.</div>`}
        ${plan.others.length ? `<div class="hint">Held outside the model (not touched): ${plan.others.map(h => `${esc((h.symbol || "").toUpperCase())} ${fmtUsd(h.value)}`).join(", ")}.</div>` : ""}</div>`;
    renderDonut("pie-target", tgt, "Target", 100);
    const c = document.querySelector("#pie-target")?.parentElement?.querySelector(".chart-center"); if (c) c.innerHTML = `<div><div class="v" style="font-size:15px">${esc(mixLabel(m, prefs))}</div><div class="l">target mix</div></div>`;
  };
  const presetChips = () => m.presets.map((p, i) => `<button class="chip ${presetIndex(prefs) === i || (presetIndex(prefs) == null && !prefs.mix && i === 0) ? "on" : ""}" data-p="${i}" title="${esc(m.flex.map(f => `${symOf(f.coin)} ${num(p.mix[f.coin])}%`).join(" · "))}">${esc(p.name)}</button>`).join("") +
    `<button class="chip ${prefs.mix && presetIndex(prefs) == null ? "on" : ""}" data-p="custom">Custom</button>`;
  v.innerHTML = `
    <div class="page-head"><div><h1>Rebalance</h1></div></div>
    <div class="two-col">
      <div class="card"><h2>Your mix</h2>
        <div class="field-div">Quick picks</div>
        <div class="chips" id="presets" style="margin:-6px 0 8px">${presetChips()}</div>
        <div id="sliders">${mixSliders(m, memberMix(m, prefs))}</div>
        <div class="chart-box" style="margin-top:12px"><canvas id="pie-target" role="img" aria-label="Target allocation pie chart"></canvas><div class="chart-center"></div></div>
        <div class="legend" id="pie-target-legend"></div>
      </div>
      <div>
        <div class="card" style="margin-bottom:16px">
          <label style="display:flex;align-items:center;gap:8px;font-size:14px;flex-wrap:wrap"><b>New money to add</b> <span>$<input type="text" inputmode="decimal" id="newm" value="${S.reb.newMoney || ""}" placeholder="0" style="width:130px"></span></label>
        </div>
        <div id="reb-body"></div>
      </div>
    </div>`;
  const bindSliders = () => v.querySelectorAll("[data-flex]").forEach(s => s.oninput = () => {
    const mix = memberMix(m, prefs); mix[s.dataset.flex] = +s.value;
    prefs = { mix: normalizeMix(m, mix, s.dataset.flex) };
    m.flex.forEach(f => { const el = $("#fx-" + CSS.escape(f.coin)); if (el) el.textContent = num(prefs.mix[f.coin]).toFixed(1) + "%"; const r = v.querySelector(`[data-flex="${CSS.escape(f.coin)}"]`); if (r && r !== s) r.value = prefs.mix[f.coin]; });
    $("#presets").innerHTML = presetChips(); bindPresets(); paint(); save();
  });
  const bindPresets = () => $("#presets").querySelectorAll("[data-p]").forEach(c => { c.onclick = () => {
    prefs = c.dataset.p === "custom" ? { mix: memberMix(m, prefs) } : { preset: +c.dataset.p };
    $("#presets").innerHTML = presetChips(); bindPresets();
    $("#sliders").innerHTML = mixSliders(m, memberMix(m, prefs)); bindSliders(); paint(); save();
  }; });
  $("#newm").oninput = debounce(e => { S.reb.newMoney = Math.max(0, decOr0(e.target.value)); paint(); }, 250);
  bindSliders(); bindPresets(); paint();
}
/** Compact model-drift card for Dkay on a member's page. */
function driftCard(p, pf) {
  if (!pf.holdings.length) return "";
  const m = getModel(), plan = planFor(p, pf, {});
  const off = plan.rows.filter(r => Math.abs(r.nowPct - r.target) >= m.drift);
  return `<div class="card" style="margin-top:16px"><h2>Model drift <span class="muted" style="font-weight:400;font-size:13px">· their mix: ${esc(mixLabel(m, p.model_prefs || {}))} (${m.flex.map(f => `${esc(symOf(f.coin))} ${num(plan.T.mix[f.coin]).toFixed(0)}%`).join(", ")})${plan.others.length ? ` · ${fmtUsd(plan.otherVal)} outside the model` : ""}</span></h2>
    ${off.length ? "" : `<div class="secondary" style="margin-bottom:8px">On target: every position is within ${m.drift}% of the model.</div>`}
    ${planTable(plan, m)}</div>`;
}

