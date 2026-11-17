/* ===================== ADMIN: MODEL EDITOR ===================== */
async function viewModel(v) {
  v.innerHTML = `<div class="spinner"></div>`;
  const draft = JSON.parse(JSON.stringify(getModel()));
  if (!Array.isArray(draft.tps) || !draft.tps.length) draft.tps = JSON.parse(JSON.stringify(DEFAULT_TPS));
  await CG.ensure(modelCoinIds(draft));
  const pctIn = (val, attrs) => `<input type="text" enterkeyhint="done" inputmode="decimal" value="${val}" ${attrs} style="width:70px;text-align:right">`;
  const paint = () => {
    const pool = poolSize(draft);
    const fixedSum = draft.fixed.reduce((s, f) => s + num(f.pct), 0);
    v.innerHTML = `
      <div class="page-head"><div><h1>Model portfolio</h1></div>
        <div class="row" style="flex:none"><button class="btn" id="reset">Reset to default</button><button class="btn primary" id="save">Save model</button></div></div>
      <div class="two-col">
        <div class="card"><h2>Fixed coins</h2>
          <div class="table-wrap"><table><thead><tr><th>Coin</th><th class="r">%</th><th></th></tr></thead><tbody>
            ${draft.fixed.map((f, i) => `<tr><td>${esc(coinLabel(f.coin))}</td><td class="r">${pctIn(f.pct, `data-fx="${i}"`)}</td><td class="r"><button class="btn small danger" data-delfx="${i}">Remove</button></td></tr>`).join("")}
          </tbody></table></div>
          <button class="btn small" id="addfx" style="margin-top:8px">+ Add fixed coin</button>
          <div class="secondary num" style="margin-top:10px">Fixed: <b>${fixedSum}%</b> → flexible pool: <b>${pool}%</b>${fixedSum > 100 ? ' <span class="bad">Fixed adds up to over 100%.</span>' : ""}</div>
        </div>
        <div class="card"><h2>Flexible ${pool}%</h2>
          <div class="table-wrap"><table><thead><tr><th>Coin</th><th class="r">Max %</th><th></th></tr></thead><tbody>
            ${draft.flex.map((f, i) => `<tr><td>${esc(coinLabel(f.coin))}</td><td class="r">${pctIn(f.max, `data-fmax="${i}"`)}</td><td class="r"><button class="btn small danger" data-delfl="${i}">Remove</button></td></tr>`).join("")}
          </tbody></table></div>
          <button class="btn small" id="addfl" style="margin-top:8px">+ Add flex coin</button>
          ${draft.flex.reduce((s, f) => s + Math.min(num(f.max) || pool, pool), 0) < pool ? `<div class="bad" style="margin-top:8px;font-size:13px">The max values add up to less than ${pool}%, so the pool can't be filled. Raise a max.</div>` : ""}
        </div>
      </div>
      <div class="card" style="margin-top:16px"><h2>Quick picks members see</h2>
        <div class="table-wrap"><table><thead><tr><th>Name</th>${draft.flex.map(f => `<th class="r">${esc(symOf(f.coin))} %</th>`).join("")}<th class="r">Total</th><th></th></tr></thead><tbody>
          ${draft.presets.map((p, i) => { const tot = draft.flex.reduce((s, f) => s + num(p.mix[f.coin]), 0); return `<tr>
            <td><input type="text" enterkeyhint="done" value="${esc(p.name)}" data-pname="${i}" style="min-width:120px"></td>
            ${draft.flex.map(f => `<td class="r">${pctIn(num(p.mix[f.coin]), `data-pmix="${i}" data-coin="${esc(f.coin)}"`)}</td>`).join("")}
            <td class="r num ${Math.abs(tot - pool) > 0.01 ? "bad" : "good"}">${r1(tot)}%</td>
            <td class="r"><button class="btn small danger" data-delp="${i}">Remove</button></td></tr>`; }).join("")}
        </tbody></table></div>
        <button class="btn small" id="addp" style="margin-top:8px">+ Add quick pick</button>
      </div>
      <div class="card" style="margin-top:16px"><h2>Take-profit targets (supercycle)</h2>
        <div class="table-wrap"><table><thead><tr><th>Coin</th><th class="r">Bare minimum</th><th class="r">Ideal low</th><th class="r">Ideal high</th><th class="r">Extension</th></tr></thead><tbody>
          ${draft.tps.map((t, i) => `<tr><td><b>${esc(t.sym)}</b>${t.main ? "" : ' <span class="muted" style="font-size:12px">other</span>'}</td>${["min", "lo", "hi", "ext"].map(k => `<td class="r"><input type="text" enterkeyhint="done" inputmode="decimal" value="${t[k] ?? ""}" data-tp="${i}" data-tk="${k}" style="width:90px;text-align:right"></td>`).join("")}</tr>`).join("")}
        </tbody></table></div></div>
      <div class="card" style="margin-top:16px"><h2>Rules</h2>
        <div class="row">
          <label class="field"><span>Suggest a trade when off by (% pts)</span><input type="text" enterkeyhint="done" inputmode="decimal" id="drift" value="${draft.drift}"></label>
          <label class="field"><span>Urgent-bid alert: 24h drop ≥ %</span><input type="text" enterkeyhint="done" inputmode="decimal" id="d24" value="${draft.drop24}"></label>
          <label class="field"><span>…or 7-day drop ≥ %</span><input type="text" enterkeyhint="done" inputmode="decimal" id="d7" value="${draft.drop7}"></label>
        </div></div>`;
    const setPct = (sel, fn) => v.querySelectorAll(sel).forEach(inp => inp.onchange = () => { fn(inp, Math.max(0, decOr0(inp.value))); paint(); });
    setPct("[data-fx]", (inp, x) => { draft.fixed[+inp.dataset.fx].pct = x; });
    setPct("[data-fmax]", (inp, x) => { draft.flex[+inp.dataset.fmax].max = x; });
    setPct("[data-pmix]", (inp, x) => { draft.presets[+inp.dataset.pmix].mix[inp.dataset.coin] = x; });
    v.querySelectorAll("[data-pname]").forEach(inp => inp.onchange = () => { draft.presets[+inp.dataset.pname].name = inp.value.trim() || "Quick pick"; });
    v.querySelectorAll("[data-delfx]").forEach(b => b.onclick = () => { draft.fixed.splice(+b.dataset.delfx, 1); paint(); });
    v.querySelectorAll("[data-delfl]").forEach(b => b.onclick = () => { const c = draft.flex[+b.dataset.delfl].coin; draft.flex.splice(+b.dataset.delfl, 1); draft.presets.forEach(p => delete p.mix[c]); paint(); });
    v.querySelectorAll("[data-delp]").forEach(b => b.onclick = () => { draft.presets.splice(+b.dataset.delp, 1); paint(); });
    const pick = (fn) => openCoinPicker(async c => { CG.cache[c.id] ||= { name: c.name, symbol: c.symbol, image: c.image, price: 0, at: 0 }; if (modelCoinIds(draft).includes(c.id)) return toast("Already in the model"); fn(c.id); await CG.ensure([c.id], 0); paint(); });
    $("#addfx").onclick = () => pick(id => draft.fixed.push({ coin: id, label: "", pct: 5 }));
    $("#addfl").onclick = () => pick(id => draft.flex.push({ coin: id, max: 10 }));
    $("#addp").onclick = () => { draft.presets.push({ name: "New pick", mix: Object.fromEntries(draft.flex.map(f => [f.coin, 0])) }); paint(); };
    $("#drift").onchange = e => { draft.drift = Math.max(0, decOr0(e.target.value)); };
    v.querySelectorAll("[data-tp]").forEach(inp => inp.onchange = () => { const t = draft.tps[+inp.dataset.tp], val = dec(inp.value); if (Number.isNaN(val) || !inp.value.trim()) delete t[inp.dataset.tk]; else t[inp.dataset.tk] = val; });
    $("#d24").onchange = e => { draft.drop24 = Math.max(1, decOr0(e.target.value)); };
    $("#d7").onchange = e => { draft.drop7 = Math.max(1, decOr0(e.target.value)); };
    $("#reset").onclick = () => confirmModal("Reset model?", "Go back to TET 40%, ACN 30% and a flexible 30% split between PAAL, VELO and OTK? Nothing is saved until you press Save model.", () => { Object.assign(draft, JSON.parse(JSON.stringify(DEFAULT_MODEL))); paint(); });
    $("#save").onclick = async () => {
      if (!draft.fixed.length && !draft.flex.length) return toast("Add at least one coin");
      const bad = draft.presets.find(p => Math.abs(draft.flex.reduce((s, f) => s + num(p.mix[f.coin]), 0) - poolSize(draft)) > 0.01);
      if (bad) return toast(`"${bad.name}" doesn't add up to ${poolSize(draft)}%`);
      if (!draft.presets.length) draft.presets.push({ name: "Even split", mix: normalizeMix(draft, Object.fromEntries(draft.flex.map(f => [f.coin, poolSize(draft) / draft.flex.length]))) });
      try { await api.setSetting("model", draft); S.model = JSON.parse(JSON.stringify(draft)); S.modelUpdatedAt = new Date().toISOString(); toast("Model saved: members see it right away"); }
      catch (e) { toast("Couldn't save: " + e.message); }
    };
  };
  paint();
}

/* ===================== MARKET UPDATES (weekly summary + urgent bids) ===================== */
async function viewUpdates(v) {
  v.innerHTML = `<div class="spinner"></div>`;
  const m = getModel();
  const [updates] = await Promise.all([api.updates(), CG.ensure(["bitcoin", "ethereum", ...modelCoinIds(m), ...S.txs.map(t => t.coin_id)], 60000)]);
  S.updates = updates;
  let g = null; try { g = await groupTotals(); } catch (e) {}
  const urgent = activeUrgent(), drops = priceDrops(m);
  const weeklies = updates.filter(u => u.kind === "weekly");
  const latest = weeklies[0];
  const pf = computePortfolio(S.txs);
  const my7 = pf.holdings.reduce((s, h) => { const c7 = CG.info(h.coin_id)?.change7; return c7 == null ? s : s + (h.value - h.value / (1 + c7 / 100)); }, 0);
  const coinRows = modelCoinIds(m).map(id => ({ id, i: CG.info(id) })).filter(x => x.i);
  const bidCard = (u) => { const s = bidSuggestion(u.coin_id); return `<div class="card urgent">
      <div class="row" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px"><div style="flex:1;min-width:0">${coinCell({ coin_id: u.coin_id, symbol: symOf(u.coin_id).toLowerCase(), name: CG.info(u.coin_id)?.name || u.coin_id, image: CG.info(u.coin_id)?.image })}</div><span class="tag req" style="flex:none">⚡ Urgent bid from ${esc(CONFIG.REVIEWER_NAME)}</span></div>
      <h2 style="margin:10px 0 4px">${esc(u.title)}</h2>
      ${u.buy_low || u.buy_high ? `<div class="num" style="margin-bottom:6px">Bid zone: <b>${u.buy_low ? fmtPrice(u.buy_low) : "…"} – ${u.buy_high ? fmtPrice(u.buy_high) : "…"}</b> · now ${fmtPrice(CG.info(u.coin_id)?.price)}</div>` : ""}
      ${u.body ? `<div style="white-space:pre-wrap">${esc(u.body)}</div>` : ""}${ATT.html(u.attachments)}
      ${!isAdmin() || api.demo ? `<div class="callout" style="margin:10px 0 0">${esc(s.text)}${s.amount ? `\nSuggested bid: <b>${fmtUsd(s.amount)}</b>` : ""}</div>` : ""}
      <div class="muted" style="font-size:12px;margin-top:8px">Posted ${ago(u.created_at)}${u.expires_at ? ` · expires ${fmtDate(u.expires_at, false)}` : ""}${isAdmin() ? ` · <button class="link-btn" data-del-up="${esc(u.id)}">Remove</button>` : ""}</div></div>`; };
  v.innerHTML = `
    <div class="page-head"><div><h1>Market updates</h1></div><button class="btn" id="reload">Refresh</button></div>
    ${priceChartCard()}
    <div class="kpis">
      ${g ? groupKpi(g) : ""}
      <div class="card kpi"><div class="label">Your portfolio, 7 days</div><div class="value num ${signCls(my7)}">${fmtUsd(my7)}</div><div class="sub num ${signCls(my7)}">${pf.totals.value - my7 > 0 ? fmtPct(my7 / (pf.totals.value - my7) * 100) : "—"}</div></div>
      <div class="card kpi"><div class="label">Active alerts</div><div class="value num ${urgent.length + drops.length ? "bad" : ""}">${urgent.length + drops.length}</div><div class="sub muted">${urgent.length} urgent bid${urgent.length === 1 ? "" : "s"} · ${drops.length} price drop${drops.length === 1 ? "" : "s"}</div></div>
    </div>
    <h2 class="section-h">⚡ Urgent bids</h2>
    ${urgent.length || drops.length ? "" : `<div class="card empty" style="padding:20px">No urgent bids right now. You'll see one here (and get a Telegram ping) when ${esc(CONFIG.REVIEWER_NAME)} posts one.</div>`}
    <div class="grid">${urgent.map(bidCard).join("")}
      ${drops.map(d => { const s = bidSuggestion(d.id); return `<div class="card drop">
        <div class="row" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px"><div style="flex:1;min-width:0">${coinCell({ coin_id: d.id, symbol: d.symbol.toLowerCase(), name: d.name, image: d.image })}</div><span class="tag flag" style="flex:none">Automatic price alert</span></div>
        <div class="num" style="margin:8px 0">${esc(d.symbol)} is <b class="bad">${fmtPct(d.change24)}</b> in 24h${d.change7 != null ? `, <b class="${signCls(d.change7)}">${fmtPct(d.change7)}</b> over 7 days` : ""} · now ${fmtPrice(d.price)}</div>
        ${!isAdmin() || api.demo ? `<div class="secondary">${esc(s.text)}${s.amount ? ` Your plan says up to <b>${fmtUsd(s.amount)}</b> to get back to target.` : ""}</div>` : ""}
        <div class="muted" style="font-size:12px;margin-top:8px">Not a call from ${esc(CONFIG.REVIEWER_NAME)}: big drops can keep dropping. Wait for his take if unsure.</div></div>`; }).join("")}</div>
    <h2 class="section-h">📰 Weekly summary</h2>
    <div class="card">${latest ? `<div class="muted" style="font-size:12px">${fmtDate(latest.created_at, false)} · ${esc(CONFIG.REVIEWER_NAME)}${isAdmin() ? ` · <button class="link-btn" data-del-up="${esc(latest.id)}">Remove</button>` : ""}</div><h2 style="margin:6px 0 8px">${esc(latest.title)}</h2><div style="white-space:pre-wrap">${esc(latest.body || "")}</div>${ATT.html(latest.attachments)}`
      : `<div class="empty" style="padding:16px">No weekly summary posted yet.</div>`}</div>
    ${weeklies.length > 1 ? `<div class="card" style="margin-top:16px"><h2>Past summaries</h2>${weeklies.slice(1, 12).map(w => `<details class="past"><summary><b>${esc(w.title)}</b> <span class="muted">· ${fmtDate(w.created_at, false)}</span></summary><div style="white-space:pre-wrap;margin-top:6px">${esc(w.body || "")}</div>${ATT.html(w.attachments)}</details>`).join("")}</div>` : ""}
    ${isAdmin() ? `<div class="two-col" style="margin-top:16px">
      <div class="card"><h2>Post an urgent bid</h2>
        <label class="field"><span>Coin</span><select id="u-coin">${modelCoinIds(m).map(id => `<option value="${esc(id)}">${esc(symOf(id))}</option>`).join("")}${drops.length ? "" : ""}</select></label>
        <label class="field"><span>Headline</span><input type="text" enterkeyhint="done" id="u-title" maxlength="140" placeholder="e.g. TET flushed to support, bid here"></label>
        <div class="row"><label class="field"><span>Bid from $</span><input type="text" enterkeyhint="done" inputmode="decimal" id="u-lo"></label><label class="field"><span>to $</span><input type="text" enterkeyhint="done" inputmode="decimal" id="u-hi"></label></div>
        <label class="field"><span>Note (optional)</span><textarea id="u-body" rows="3" maxlength="2000"></textarea></label>
        ${ATT.pickerHtml("att-urgent")}
        <label class="field"><span>Show for</span><select id="u-exp" class="as-seg"><option value="1">1 day</option><option value="3" selected>3 days</option><option value="7">7 days</option></select></label>
        <button class="btn primary" id="u-post">Post urgent bid</button></div>
      <div class="card"><h2>Post the weekly summary</h2>
        <label class="field"><span>Title</span><input type="text" enterkeyhint="done" id="w-title" maxlength="140" value="Weekly update · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}"></label>
        <label class="field"><span>Summary</span><textarea id="w-body" rows="10" maxlength="6000" placeholder="Your take on the week…"></textarea></label>
        ${ATT.pickerHtml("att-weekly")}
        <div class="btn-row"><button class="btn" id="w-draft">Fill with this week's numbers</button><button class="btn primary" id="w-post">Post summary</button></div></div>
    </div>` : ""}`;
  paintPriceChart();
  $("#reload").onclick = async () => { await CG.ensure(["bitcoin", "ethereum", ...modelCoinIds(m)], 0); CG.hist = {}; render(); };
  v.querySelectorAll("[data-del-up]").forEach(b => b.onclick = () => confirmModal("Remove this post?", "It disappears for everyone. Telegram messages already sent stay in their chats.", async () => { await api.deleteUpdate(b.dataset.delUp); render(); }));
  if (!isAdmin()) return;
  $("#w-draft").onclick = () => {
    const lines = coinRows.map(({ id, i }) => `• ${symOf(id)}: ${fmtPrice(i.price)} (${i.change7 == null ? "n/a" : fmtPct(i.change7)} 7d, ${fmtPct(i.change24)} 24h)`);
    const ta = $("#w-body");
    ta.value = (ta.value ? ta.value + "\n\n" : "") + `Model coins this week:\n${lines.join("\n")}` + (g ? `\n\nGroup total: ${fmtUsd(g.value)} across ${g.members} members (${fmtPct(g.change24Pct)} 24h).` : "") + `\n\nMy take:\n`;
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  };
  ATT.bind("att-weekly"); ATT.bind("att-urgent");
  const withUploads = async (btn, pickId, fn) => {
    const label = btn.textContent; btn.disabled = true;
    try { const attachments = await ATT.upload(pickId, "updates", (i, n) => { btn.textContent = `Uploading ${i}/${n}…`; }); btn.textContent = "Posting…"; await fn(attachments); }
    catch (e) { toast(e.message); btn.disabled = false; btn.textContent = label; }
  };
  $("#w-post").onclick = async () => {
    const title = $("#w-title").value.trim(), body = $("#w-body").value.trim();
    if (!body && !ATT.files("att-weekly").length) return $("#w-body").focus();
    await withUploads($("#w-post"), "att-weekly", async (attachments) => { await api.addUpdate({ kind: "weekly", title: title || "Weekly update", body, ...(attachments ? { attachments } : {}) }); toast("Weekly summary posted"); render(); });
  };
  $("#u-post").onclick = async () => {
    const coin_id = $("#u-coin").value, title = $("#u-title").value.trim();
    if (!title) return $("#u-title").focus();
    const lo = dec($("#u-lo").value), hi = dec($("#u-hi").value);
    await withUploads($("#u-post"), "att-urgent", async (attachments) => {
      await api.addUpdate({ kind: "urgent", coin_id, title, body: $("#u-body").value.trim() || null, buy_low: Number.isNaN(lo) ? null : lo, buy_high: Number.isNaN(hi) ? null : hi, expires_at: new Date(Date.now() + +$("#u-exp").value * 86400000).toISOString(), ...(attachments ? { attachments } : {}) });
      toast("Urgent bid posted"); render();
    });
  };
}
function alertBanner() {
  const u = activeUrgent(), d = priceDrops();
  if (!u.length && !d.length) return "";
  const parts = [...u.map(x => `<b>${esc(symOf(x.coin_id))}</b> urgent bid from ${esc(CONFIG.REVIEWER_NAME)}`), ...d.map(x => `<b>${esc(x.symbol)}</b> ${fmtPct(x.change24)} 24h`)];
  return `<a href="#updates" class="alert-bar">⚡ ${parts.join(" · ")} <span style="margin-left:auto">See Market updates →</span></a>`;
}

