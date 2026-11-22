/* ===================== ADMIN: BROADCAST ===================== */
// One message, delivered privately into each chosen member's own Feedback thread (and pinged on Telegram).
function openBroadcast() {
  const rows = memberRows(), m = getModel();
  const offTarget = (r) => r.pf.holdings.length && planFor(r.p, r.pf, {}).rows.some(x => Math.abs(x.nowPct - x.target) >= m.drift);
  const coins = {};
  for (const r of rows) for (const h of r.pf.holdings) (coins[h.coin_id] ||= { id: h.coin_id, symbol: (h.symbol || "").toUpperCase(), n: 0 }).n++;
  // The big five (model coins) are always on the list, first, even with 0 holders.
  const big = modelCoinIds(m);
  const coinList = [...big.map(id => coins[id] || { id, symbol: symOf(id), n: 0 }), ...Object.values(coins).filter(c => !big.includes(c.id)).sort((a, b) => b.n - a.n)];
  const AUD = [
    ["all", "All members", () => true],
    ["holders", "Members holding a coin…", (r, c) => r.pf.holdings.some(h => h.coin_id === c)],
    ["off", "Off the model by more than " + m.drift + "%", offTarget],
    ["requested", "Open review requests", (r) => r.p.review_requested],
    ["empty", "No trades logged yet", (r) => !r.txs.length],
    ["noexit", "No exit plan committed yet", (r) => exitStatus(r.p).state !== "committed"],
    ["pick", "Pick members…", (r, c, picked) => picked.has(r.p.id)],
  ];
  const picked = new Set();
  const { ov, close } = openModal(`
    <label class="field"><span>Send to</span><select id="bc-aud">${AUD.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>
    <label class="field hidden" id="bc-coin-wrap"><span>Coin</span><select id="bc-coin">${coinList.map((c, i) => `${i === big.length && i ? `<option disabled>──────────</option>` : ""}<option value="${esc(c.id)}">${big.includes(c.id) ? "★ " : ""}${esc(c.symbol)} · ${plural(c.n, "holder")}</option>`).join("")}</select></label>
    <div class="hidden" id="bc-pick" style="margin-bottom:12px"><input type="search" id="bc-q" placeholder="Search members…" style="margin-bottom:6px">
      <div id="bc-list" style="max-height:200px;overflow-y:auto;border-radius:9px;padding:4px 8px"></div></div>
    <label class="field"><span>Type</span><select id="bc-kind" class="as-seg"><option value="note">Note</option><option value="suggestion">Suggestion</option></select></label>
    <label class="field"><span>Message</span><textarea id="bc-body" rows="6" maxlength="4000" placeholder="Hey {name}, quick heads-up…"></textarea></label>
    <div class="hint" style="margin-top:-6px"><b>{name}</b> = member's name</div>
    <div class="callout" id="bc-count" style="margin:12px 0"></div>
    <div class="err" id="bc-err"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="bc-cancel" style="flex:none">Cancel</button><button class="btn primary" id="bc-send" style="flex:none">Send</button></div>`, { title: "Broadcast", style: "max-width:560px" });
  $("#bc-cancel", ov).onclick = close;
  const targets = () => {
    const a = $("#bc-aud", ov).value, fn = AUD.find(x => x[0] === a)[2], c = $("#bc-coin", ov).value;
    return rows.filter(r => fn(r, c, picked));
  };
  const paintList = () => {
    const q = $("#bc-q", ov).value.toLowerCase();
    $("#bc-list", ov).innerHTML = rows.filter(r => !q || memberName(r.p).toLowerCase().includes(q) || (r.p.telegram_handle || "").toLowerCase().includes(q))
      .map(r => `<label style="display:flex;gap:8px;align-items:center;padding:5px 0;cursor:pointer"><input type="checkbox" data-id="${esc(r.p.id)}" ${picked.has(r.p.id) ? "checked" : ""} style="width:auto"> ${esc(memberName(r.p))} <span class="muted" style="font-size:12px">${esc(atHandle(r.p.telegram_handle))}</span></label>`).join("") || `<div class="muted" style="padding:6px 0">No members match.</div>`;
    $("#bc-list", ov).querySelectorAll("[data-id]").forEach(cb => cb.onchange = () => { cb.checked ? picked.add(cb.dataset.id) : picked.delete(cb.dataset.id); paintCount(); });
  };
  const paintCount = () => {
    const t = targets(), tg = t.filter(r => r.p.telegram_chat_id).length;
    $("#bc-count", ov).innerHTML = t.length ? `<b>${t.length}</b> member${t.length === 1 ? "" : "s"} · <b>${tg}</b> on Telegram${t.length <= 6 ? `\n${t.map(r => esc(memberName(r.p))).join(", ")}` : ""}` : "Nobody matches yet.";
    $("#bc-send", ov).textContent = t.length ? `Send to ${t.length}` : "Send";
    $("#bc-send", ov).disabled = !t.length;
  };
  $("#bc-aud", ov).onchange = () => {
    const a = $("#bc-aud", ov).value;
    $("#bc-coin-wrap", ov).classList.toggle("hidden", a !== "holders");
    $("#bc-pick", ov).classList.toggle("hidden", a !== "pick");
    if (a === "pick") paintList();
    paintCount();
  };
  $("#bc-coin", ov).onchange = paintCount;
  $("#bc-q", ov).oninput = debounce(paintList, 120);
  $("#bc-send", ov).onclick = async () => {
    const body = $("#bc-body", ov).value.trim(), t = targets();
    if (!body) return $("#bc-body", ov).focus();
    if (!t.length) return;
    const btn = $("#bc-send", ov); btn.disabled = true; btn.textContent = "Sending…";
    try {
      const kind = $("#bc-kind", ov).value;
      const out = t.map(r => ({ member_id: r.p.id, kind, body: body.replace(/\{name\}/gi, r.p.display_name || atHandle(r.p.telegram_handle) || "there") }));
      for (let i = 0; i < out.length; i += 100) {
        const saved = await api.addMessages(out.slice(i, i + 100));
        for (const s of saved) S.admin.meta.push({ member_id: s.member_id, author_id: s.author_id, created_at: s.created_at, kind: s.kind });
      }
      close(); toast(`Sent to ${plural(t.length, "member")}`); render();
    } catch (e) { $("#bc-err", ov).textContent = e.message || String(e); btn.disabled = false; paintCount(); }
  };
  paintCount();
  $("#bc-body", ov).focus();
}

/* ===================== ADMIN DATA ===================== */
let adminLoading = null;   // shared, so the background load at startup and the first admin view don't fetch twice
function loadAdmin(force = false) {
  if (!force && Date.now() - S.admin.loadedAt < 30000) return Promise.resolve();
  return adminLoading ||= Promise.all([api.allProfiles(), api.allTransactions(), api.allMessageMeta()])
    .then(([profiles, txs, meta]) => { S.admin = { profiles, txs, meta, loadedAt: Date.now() }; return CG.ensure(txs.map(t => t.coin_id)); })
    .finally(() => { adminLoading = null; });
}
function memberRows(includeAdmins = false) {
  const txBy = {}, metaBy = {};
  for (const t of S.admin.txs) (txBy[t.user_id] ||= []).push(t);
  for (const m of S.admin.meta) (metaBy[m.member_id] ||= []).push(m);
  return S.admin.profiles.filter(p => includeAdmins || p.role !== "admin").map(p => {
    const txs = txBy[p.id] || [];
    const pf = computePortfolio(txs);
    const msgs = metaBy[p.id] || [];
    const lastReviewerMsg = msgs.filter(m => m.author_id !== p.id).map(m => m.created_at).sort().pop();
    const newFromMember = msgs.filter(m => m.author_id === p.id && (!lastReviewerMsg || m.created_at > lastReviewerMsg)).length;
    const top = pf.holdings[0];
    return { p, pf, txs, top, newFromMember, lastActivity: [txs.at(-1)?.executed_at, msgs.at(-1)?.created_at, p.updated_at].filter(Boolean).sort().pop(), concentrated: top && top.alloc >= 50 && pf.holdings.length > 0 };
  });
}

/* ===================== ADMIN: REVIEW QUEUE ===================== */
async function viewMembers(v) {
  v.innerHTML = `<div class="spinner"></div>`;
  await loadAdmin();
  const all = memberRows(true);   // admins (Dkay) are listed alongside members
  const isStale = (r) => r.p.role !== "admin" && (!r.p.last_reviewed_at || Date.now() - new Date(r.p.last_reviewed_at) > 30 * 86400000);
  const total = all.reduce((s, r) => s + r.pf.totals.value, 0);
  const stale = all.filter(isStale).length;
  v.innerHTML = `
    <div class="page-head"><div><h1>Review Queue</h1></div><div class="row" style="flex:none"><button class="btn" id="reload">Reload</button><button class="btn primary" id="bcast">Broadcast</button></div></div>
    <div class="kpis">
      <div class="card kpi"><div class="label">Members</div><div class="value num">${all.length}</div></div>
      <div class="card kpi"><div class="label">Requests</div><div class="value num">${all.filter(r => r.p.review_requested).length}</div></div>
      <div class="card kpi"><div class="label">Overdue</div><div class="value num">${stale}</div></div>
      <div class="card kpi"><div class="label">Tracked value</div><div class="value num">${fmtUsd(total, { compact: true })}</div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input type="search" id="mq" placeholder="Search name or @handle…" value="${esc(S.memberQuery)}">
        <div class="chips row-scroll" id="mf">${[["all","All"],["requested","Requested"],["unanswered","Unanswered"],["stale","Overdue"],["concentrated","50%+ in one"]].map(([k,l]) => `<button class="chip ${S.memberFilter === k ? "on" : ""}" data-f="${k}">${l}</button>`).join("")}</div>
        <select id="ms">${[["review","Sort: requests first"],["value","Sort: value"],["pnl","Sort: P&L %"],["activity","Sort: recent activity"]].map(([k,l]) => `<option value="${k}" ${S.memberSort === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      <div id="mtable"></div>
    </div>`;
  const paint = () => {
    const q = S.memberQuery.toLowerCase();
    let rows = all.filter(r => !q || memberName(r.p).toLowerCase().includes(q) || (r.p.telegram_handle || "").toLowerCase().includes(q));
    const f = S.memberFilter;
    if (f === "requested") rows = rows.filter(r => r.p.review_requested);
    if (f === "unanswered") rows = rows.filter(r => r.newFromMember);
    if (f === "stale") rows = rows.filter(isStale);
    if (f === "concentrated") rows = rows.filter(r => r.concentrated);
    const s = S.memberSort;
    rows.sort((a, b) =>
      s === "value" ? b.pf.totals.value - a.pf.totals.value :
      s === "pnl" ? b.pf.totals.pnlPct - a.pf.totals.pnlPct :
      s === "activity" ? String(b.lastActivity).localeCompare(String(a.lastActivity)) :
      (b.p.review_requested - a.p.review_requested) || (b.newFromMember - a.newFromMember) || String(a.p.review_requested_at).localeCompare(String(b.p.review_requested_at)) || b.pf.totals.value - a.pf.totals.value);
    $("#mtable").innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Member</th><th class="r">Value</th><th class="r">P&amp;L</th><th class="hide-sm">Top holding</th><th class="r hide-sm">Coins</th><th class="hide-sm">Reviewed</th><th class="hide-sm">Activity</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="click" data-id="${esc(r.p.id)}">
        <td class="wrap"><div style="font-weight:600">${esc(memberName(r.p))}${r.p.role === "admin" ? ` <span class="tag">${r.p.id === S.me.id ? "you" : "admin"}</span>` : ""}</div><div class="muted" style="font-size:13px">${esc(atHandle(r.p.telegram_handle))}${r.p.risk_level ? " · " + esc(r.p.risk_level) + " risk" : ""}</div><div class="chips" style="margin-top:6px;gap:4px">${r.p.review_requested ? `<span class="tag req">Review requested ${ago(r.p.review_requested_at)}</span>` : ""}${r.newFromMember ? ` <span class="tag">${r.newFromMember} new msg</span>` : ""}${r.concentrated ? ` <span class="tag flag">${r.top.alloc.toFixed(0)}% in ${esc((r.top.symbol || "").toUpperCase())}</span>` : ""}${r.pf.holdings.length && exitStatus(r.p).state !== "committed" ? ` <span class="tag">no exit plan</span>` : ""}</div></td>
        <td class="r num">${fmtUsd(r.pf.totals.value)}</td>
        <td class="r num ${signCls(r.pf.totals.pnl)}">${r.pf.totals.cost ? fmtPct(r.pf.totals.pnlPct) : "—"}</td>
        <td class="hide-sm">${r.top ? `${esc((r.top.symbol || "").toUpperCase())} <span class="muted">${r.top.alloc.toFixed(0)}%</span>` : '<span class="muted">—</span>'}</td>
        <td class="r num hide-sm">${r.pf.holdings.length}</td>
        <td class="hide-sm secondary">${r.p.role === "admin" ? "—" : ago(r.p.last_reviewed_at)}</td>
        <td class="hide-sm secondary">${ago(r.lastActivity)}</td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="empty"><div class="big">Nobody matches</div></div>`;
    $("#mtable").querySelectorAll("tr[data-id]").forEach(tr => tr.onclick = () => { location.hash = "member-" + tr.dataset.id; });
  };
  paint();
  $("#mq").oninput = debounce(e => { S.memberQuery = e.target.value; paint(); }, 150);
  $("#mf").querySelectorAll(".chip").forEach(c => c.onclick = () => { S.memberFilter = c.dataset.f; $("#mf").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === c)); paint(); });
  $("#ms").onchange = e => { S.memberSort = e.target.value; paint(); };
  $("#reload").onclick = async () => { await loadAdmin(true); render(); };
  $("#bcast").onclick = () => openBroadcast();
}

/* ===================== ADMIN: MEMBER DETAIL ===================== */
const TEMPLATES = [
  ["Too concentrated", "Your top position is a big chunk of the portfolio. Put your next buys into the other model coins to balance it out, rather than adding more here."],
  ["Take profit", "You're nicely up on this one. Think about taking initial out (or 25–50%) and letting the rest ride."],
  ["DCA, don't chase", "Don't chase green candles here. Set limit buys lower and DCA in over a few weeks."],
  ["Hold, thesis intact", "Thesis still intact. Hold and don't panic-sell the dips."],
  ["Looks solid", "Portfolio looks balanced for your risk level. No changes needed right now."],
];
async function viewMemberDetail(v, id) {
  v.innerHTML = `<div class="spinner"></div>`;
  await loadAdmin();
  const r = memberRows(true).find(x => x.p.id === id);
  if (!r) { v.innerHTML = `<div class="empty"><div class="big">Member not found</div><a href="#members">Back to queue</a></div>`; return; }
  const msgs = await api.messages(id);
  const names = Object.fromEntries(S.admin.profiles.map(p => [p.id, p.role === "admin" ? (p.display_name || CONFIG.REVIEWER_NAME) : memberName(p)]));
  const { p, pf } = r, sig = p.tier === "signals";   // Signals-only member: replying is the main action
  v.innerHTML = `
    <div style="margin-bottom:10px"><a href="#members" style="text-decoration:none">← Review Queue</a></div>
    <div class="page-head"><div><h1>${esc(memberName(p))}</h1>
      <div class="secondary">${handleLink(p.telegram_handle)}${p.risk_level ? ` · ${esc(p.risk_level)} risk` : ""}${p.cc_joined_on ? ` · in ${esc(CONFIG.GROUP_NAME)} since ${fmtJoined(p.cc_joined_on)}` : ""} · reviewed ${ago(p.last_reviewed_at)}</div>
      ${p.goal ? `<div class="secondary" style="margin-top:4px">Goal: ${esc(p.goal)}</div>` : ""}</div>
      <button class="btn ${p.review_requested ? "primary" : ""}" id="mark">Mark reviewed</button></div>
    ${p.review_requested ? `<div class="callout"><b>Review requested ${ago(p.review_requested_at)}</b>${p.review_question ? `\n“${esc(p.review_question)}”` : ""}</div>` : ""}
    ${pf.holdings.length ? `${heroCard(pf, "hero-m")}<div class="ov-grid">${donutCard("pie-member", "Allocation")}${perfCard("perf-member")}</div>` : `<div class="card empty" style="margin-bottom:16px"><div class="big">No holdings</div></div>`}
    <div class="card"><div class="card-h"><h2>Holdings</h2></div>${holdingsTable(pf)}</div>
    ${driftCard(p, pf)}
    ${exitCard(p, pf)}
    <div class="two-col" style="margin-top:16px">
      <div class="card"><h2>Thread</h2><div class="thread" id="thread">${threadHtml(msgs, S.me.id, p.id, names)}</div></div>
      <div class="card"><h2>${sig ? "Reply" : "Send a suggestion"}</h2>
        ${sig ? "" : `<div class="chips" style="margin-bottom:10px">${TEMPLATES.map(([l], i) => `<button class="chip" data-tpl="${i}">${esc(l)}</button>`).join("")}</div>
        <div class="row">
          <label class="field"><span>Type</span><select id="kind" class="as-seg"><option value="suggestion">Suggestion</option><option value="note">Note</option><option value="reply">Reply</option></select></label>
          <label class="field"><span>Coin</span><select id="coin"><option value="">—</option>${(() => { const big = modelCoinIds(); const held = Object.fromEntries(pf.holdings.map(h => [h.coin_id, h])); const opt = (id) => `<option value="${esc(id)}">${esc(symOf(id))}${held[id] ? "" : " · not held"}</option>`; const others = pf.holdings.map(h => h.coin_id).filter(id => !big.includes(id)); return big.map(opt).join("") + (others.length ? `<option disabled>──────────</option>` + others.map(opt).join("") : ""); })()}</select></label>
        </div>`}
        <label class="field"><span>Message</span><textarea id="body" maxlength="4000" rows="5" placeholder="${sig ? "Reply to" : "Your suggestion for"} ${esc(memberName(p))}…"></textarea></label>
        ${ATT.pickerHtml("att-msg")}
        <div class="row" style="justify-content:flex-end"><button class="btn" id="send" style="flex:none">Send</button><button class="btn primary" id="send-mark" style="flex:none">Send &amp; mark reviewed</button></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px" id="notes-card"><div class="card-h"><h2>Member profile</h2></div>
      <div class="secondary" style="font-size:13px;margin:-4px 0 10px">${plural(r.txs.length, "trade")}${r.txs.length ? ` · latest ${ago(r.txs.at(-1).executed_at)}` : ""} · joined Desk ${ago(p.created_at)}</div>
      <div class="row" style="align-items:flex-end;margin-bottom:12px">
        <label class="field" style="margin-bottom:0"><span>Joined ${esc(CONFIG.GROUP_NAME)}</span><input type="date" id="cc-joined" max="${todayISO()}" value="${esc(p.cc_joined_on || "")}"></label>
        <button class="btn" id="cc-joined-save" style="flex:none">Save date</button></div>
      ${p.role === "admin" ? "" : `<div class="field-div"><span>Plan</span><select id="m-tier" class="as-seg">${[["elite", "Elite"], ["signals", "Signals"], ["both", "Both"]].map(([k, l]) => `<option value="${k}"${(p.tier || "elite") === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field-div"><span>Signals Admin</span><select id="m-sigadmin" class="as-seg"><option value="0">Off</option><option value="1"${p.signals_admin ? " selected" : ""}>On</option></select></div>`}
      <label class="field"><span>Note</span><textarea id="note-body" rows="3" maxlength="4000" placeholder="e.g. Prefers to DCA weekly"></textarea></label>
      <div class="row" style="justify-content:flex-end;margin-bottom:10px"><button class="btn primary" id="note-add" style="flex:none">Save note</button></div>
      <div id="notes-list"><div class="muted">Loading notes…</div></div></div>
    ${p.role !== "admin" && p.id !== S.me.id ? `<div class="card" style="margin-top:16px;background:color-mix(in srgb, var(--bad) 7%, var(--surface-1))">
      <h2>Remove member</h2>
      <button class="btn" id="remove-member" style="color:var(--bad)">Remove member</button></div>` : ""}`;
  $("#remove-member") && ($("#remove-member").onclick = () => removeMemberModal(p));
  bindMemberNotes(p, names);
  if ($("#m-tier")) {
    const save = async (patch, msg) => {
      try { Object.assign(p, await api.updateProfile(p.id, patch)); toast(msg); }
      catch (e) { toast("Couldn't save: " + (e.message || e)); render(); }
    };
    $("#m-tier").onchange = () => save({ tier: $("#m-tier").value }, "Plan saved");
    $("#m-sigadmin").onchange = () => save({ signals_admin: $("#m-sigadmin").value === "1" }, $("#m-sigadmin").value === "1" ? "Can post signals now" : "Signals Admin removed");
  }
  $("#cc-joined-save").onclick = async () => {
    const val = $("#cc-joined").value || null;
    try {
      const up = await api.updateProfile(p.id, { cc_joined_on: val });
      Object.assign(S.admin.profiles.find(x => x.id === p.id), up); Object.assign(p, up);
      if (p.id === S.me.id) S.me = up;
      toast(val ? "Join date saved" : "Join date cleared");
    } catch (e) { toast(/cc_joined_on/.test(e.message || "") ? "Run supabase/cc_joined_on.sql in Supabase first" : "Couldn't save: " + (e.message || e)); }
  };
  if (pf.holdings.length) { renderDonut("pie-member", pf.holdings, "Total", pf.totals.value); renderPerf("perf-member", pf.holdings); paintHero(r.txs, "hero-m"); }
  pinThreadBottom($("#thread"));
  v.querySelectorAll("[data-tpl]").forEach(b => b.onclick = () => { const ta = $("#body"); ta.value = (ta.value ? ta.value + "\n\n" : "") + TEMPLATES[+b.dataset.tpl][1]; ta.focus(); });
  const markReviewed = async () => {
    const up = await api.updateProfile(p.id, { review_requested: false, last_reviewed_at: new Date().toISOString() });
    Object.assign(S.admin.profiles.find(x => x.id === p.id), up);
    if (p.id === S.me.id) S.me = up;
  };
  ATT.bind("att-msg");
  const send = async (mark) => {
    const body = $("#body").value.trim();
    if (!body && !ATT.files("att-msg").length) { $("#body").focus(); return; }
    const btns = [$("#send"), $("#send-mark")], labels = btns.map(b => b.textContent);
    btns.forEach(b => b.disabled = true);
    let attachments = null;
    try { attachments = await ATT.upload("att-msg", `msg/${p.id}`, (i, n) => { btns[mark ? 1 : 0].textContent = `Uploading ${i}/${n}…`; }); }
    catch (e) { toast(e.message, "error"); btns.forEach((b, i) => { b.disabled = false; b.textContent = labels[i]; }); return; }
    const m = await api.addMessage({ member_id: p.id, kind: $("#kind")?.value || "reply", coin_id: $("#coin")?.value || null, body, ...(attachments ? { attachments } : {}) });
    S.admin.meta.push({ member_id: p.id, author_id: m.author_id, created_at: m.created_at, kind: m.kind });
    if (mark) await markReviewed();
    toast(mark ? "Sent and marked reviewed" : "Sent"); render();
  };
  $("#send").onclick = () => send(false);
  $("#send-mark").onclick = () => send(true);
  $("#mark").onclick = async () => { await markReviewed(); toast("Marked reviewed"); render(); };
  bindMsgDelete(v, render);
}

/* Owner's private notes on a member (member_notes table, admin-only RLS). */
async function bindMemberNotes(p, names) {
  const list = $("#notes-list"); if (!list) return;
  let notes = [];
  const paint = () => {
    list.innerHTML = notes.length ? notes.map(n => `<div class="note-item" style="border-top:1px solid var(--track);padding:10px 0">
      <div style="white-space:pre-wrap">${esc(n.body)}</div>
      <div class="muted" style="font-size:12px;margin-top:4px;display:flex;gap:10px;align-items:center">${esc(names[n.author_id] || CONFIG.REVIEWER_NAME)} · ${ago(n.created_at)}
        <button class="btn" data-del-note="${esc(n.id)}" style="flex:none;margin-left:auto;padding:2px 10px;font-size:12px">Delete</button></div></div>`).join("")
      : `<div class="muted" style="font-size:13px">No notes yet.</div>`;
    list.querySelectorAll("[data-del-note]").forEach(b => b.onclick = () => confirmModal("Delete note?", "This note will be removed for good.", async () => {
      try { await api.deleteNote(b.dataset.delNote); notes = notes.filter(n => n.id !== b.dataset.delNote); paint(); } catch (e) { toast("Couldn't delete: " + (e.message || e)); }
    }));
  };
  try { notes = await api.notes(p.id); paint(); }
  catch (e) {
    list.innerHTML = `<div class="callout" style="font-size:13px">Notes aren't set up yet. Run <b>supabase/member_notes.sql</b> once in Supabase → SQL Editor, then reload.</div>`;
    $("#note-add").disabled = true; return;
  }
  $("#note-add").onclick = async () => {
    const ta = $("#note-body"), body = ta.value.trim();
    if (!body) return ta.focus();
    const btn = $("#note-add"); btn.disabled = true;
    try { const n = await api.addNote({ member_id: p.id, body }); notes.unshift(n); ta.value = ""; paint(); toast("Note saved"); }
    catch (e) { toast("Couldn't save: " + (e.message || e)); }
    btn.disabled = false;
  };
}

function removeMemberModal(p) {
  const name = memberName(p);
  const { ov, close } = openModal(`<h2>Remove ${esc(name)}?</h2>
    <p class="secondary">Deletes their account and all their data. Can't be undone.</p>
    <label class="field"><span>Type <b>REMOVE</b> to confirm</span><input type="text" id="rm-confirm" autocomplete="off" autocapitalize="characters"></label>
    <div class="err" id="rm-err"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="rm-no" style="flex:none">Cancel</button><button class="btn danger" id="rm-yes" style="flex:none" disabled>Remove</button></div>`, { style: "max-width:400px" });
  const inp = $("#rm-confirm", ov), yes = $("#rm-yes", ov);
  inp.oninput = () => { yes.disabled = inp.value.trim().toUpperCase() !== "REMOVE"; };
  $("#rm-no", ov).onclick = close;
  yes.onclick = async () => {
    yes.disabled = true; yes.textContent = "Removing…";
    try {
      await api.removeMember(p.id);
      S.admin.profiles = S.admin.profiles.filter(x => x.id !== p.id);
      S.admin.txs = S.admin.txs.filter(t => t.user_id !== p.id);
      S.admin.meta = S.admin.meta.filter(m => m.member_id !== p.id);
      close(); toast(`${name} removed`); location.hash = "members";
    } catch (e) { yes.disabled = false; yes.textContent = "Remove"; $("#rm-err", ov).textContent = e.message || "Couldn't remove. Try again."; }
  };
  setTimeout(() => inp.focus(), 50);
}

/* ===================== ADMIN: GROUP INSIGHTS ===================== */
async function viewInsights(v) {
  v.innerHTML = `<div class="spinner"></div>`;
  await loadAdmin();
  const rows = memberRows(true).filter(r => r.pf.holdings.length);
  const agg = {};
  for (const r of rows) for (const h of r.pf.holdings) {
    const a = agg[h.coin_id] ||= { coin_id: h.coin_id, symbol: h.symbol, name: h.name, image: h.image, value: 0, holders: 0, allocSum: 0, cost: 0, change24: h.change24 };
    a.value += h.value; a.holders++; a.allocSum += h.alloc; a.cost += h.cost;
  }
  const list = Object.values(agg).sort((a, b) => b.value - a.value);
  const total = list.reduce((s, a) => s + a.value, 0);
  list.forEach(a => a.alloc = total ? a.value / total * 100 : 0);
  const byHolders = [...list].sort((a, b) => b.holders - a.holders || b.value - a.value);
  const conc = rows.filter(r => r.concentrated).sort((a, b) => b.top.alloc - a.top.alloc);
  v.innerHTML = `
    <div class="page-head"><div><h1>Group insights</h1></div></div>
    ${(() => { const t = rows.reduce((a, r) => ({ value: a.value + r.pf.totals.value, cost: a.cost + r.pf.totals.cost, chg: a.chg + r.pf.totals.change24Usd }), { value: 0, cost: 0, chg: 0 }); return `<div class="kpis">
      <div class="card kpi"><div class="label">Group value</div><div class="value num">${fmtUsd(t.value)}</div><div class="sub num ${signCls(t.chg)}">${fmtUsd(t.chg)} 24h</div></div>
      <div class="card kpi"><div class="label">Total invested</div><div class="value num">${fmtUsd(t.cost)}</div></div>
      <div class="card kpi"><div class="label">Unrealized P&amp;L</div><div class="value num ${signCls(t.value - t.cost)}">${fmtUsd(t.value - t.cost)}</div><div class="sub num ${signCls(t.value - t.cost)}">${t.cost ? fmtPct((t.value - t.cost) / t.cost * 100) : "—"}</div></div>
      <div class="card kpi"><div class="label">Avg portfolio</div><div class="value num">${fmtUsd(rows.length ? t.value / rows.length : 0)}</div></div></div>`; })()}
    <div class="two-col">
      ${list.length ? donutCard("pie-group", "Group allocation") : `<div class="card empty">No holdings yet.</div>`}
      <div class="card"><h2>Most-held coins</h2>
        ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Coin</th><th class="r">Holders</th><th class="r">Avg weight</th><th class="r">Group value</th><th class="r">Group P&amp;L</th><th class="r hide-sm">24h</th></tr></thead><tbody>
        ${byHolders.slice(0, 25).map(a => `<tr><td><a href="${coinLink(a.coin_id)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${coinCell(a)}</a></td><td class="r num">${a.holders}</td><td class="r num">${(a.allocSum / a.holders).toFixed(1)}%</td><td class="r num">${fmtUsd(a.value, { compact: true })}</td><td class="r num ${signCls(a.value - a.cost)}">${a.cost ? fmtPct((a.value - a.cost) / a.cost * 100) : "—"}</td><td class="r num hide-sm ${signCls(a.change24)}">${fmtPct(a.change24)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      </div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Concentration risk</h2>
      ${conc.length ? `<div class="table-wrap"><table><thead><tr><th>Member</th><th>Coin</th><th class="r">Weight</th><th class="r">Value</th><th class="hide-sm">Reviewed</th></tr></thead><tbody>
      ${conc.map(r => `<tr class="click" data-id="${esc(r.p.id)}"><td>${esc(memberName(r.p))}</td><td>${esc((r.top.symbol || "").toUpperCase())}</td><td class="r num bad">${r.top.alloc.toFixed(1)}%</td><td class="r num">${fmtUsd(r.pf.totals.value)}</td><td class="hide-sm secondary">${ago(r.p.last_reviewed_at)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No concentrated portfolios right now.</div>`}
    </div>`;
  if (list.length) renderDonut("pie-group", list, "Group total", total);
  v.querySelectorAll("tr[data-id]").forEach(tr => tr.onclick = () => { location.hash = "member-" + tr.dataset.id; });
}

