/* ===================== EXIT PLAN (commit to taking profit) ===================== */
const DEFAULT_TPS = [
  // Dkay's "ideal TPs in a supercycle scenario": bare minimum, ideal range, extension.
  { sym: "TET", coin: "tectum", label: "Tectum (TET)", min: 37, lo: 100, hi: 300, ext: 500, main: true },
  { sym: "ACN", coin: "solidus-aitech", label: "AITECH (ACN)", min: 0.28, lo: 1, hi: 3, ext: 6, main: true },
  { sym: "PAAL", coin: "paal-ai", label: "PAAL AI", min: 0.35, lo: 1.2, hi: 3, main: true },
  { sym: "VELO", coin: "velo", label: "Velo", lo: 0.12, hi: 0.64, main: true },
  { sym: "OTK", coin: "octo-gaming", label: "Octo Gaming (OTK)", min: 0.016, lo: 0.04, hi: 0.2, main: true },
  { sym: "IRON", label: "IRON", min: 1.65, lo: 7, hi: 15 },
  { sym: "ALVA", label: "ALVA", min: 0.36, lo: 1.5, hi: 3 },
  { sym: "KTA", label: "KTA", lo: 1, hi: 3 },
  { sym: "INDEXY", label: "INDEXY", lo: 0.0001, hi: 0.0004 },
];
const EXIT_PLEDGES = [
  ["initials", "I'll take my initial investment out early.", "“Should have initials out here at least” (475681)"],
  ["steps", "I'll sell in steps, not all at the top.", "“You wanna sell early, on time, and late” (210100)"],
  ["macro", "I'll take profits at the big macro levels.", "“Always best to take profits at macro levels rather than micro levels” (266873)"],
  ["goal", "I've set my money goal now, and I won't move my targets up.", "“Set your targets now and gtfo when you hit your financial goal” (256997)"],
  ["spot", "Spot only, no leverage.", "“This is why I don't let you guys do leverage” (370024)"],
  ["risk", "My risk goes into buying before and during the moves, not into waiting for higher at the end.", "(475419)"],
];
const EXIT_STRATEGIES = [
  ["initials", "Initials first", "Get your money back at the first target, then ladder out and keep a moonbag."],
  ["even", "Even ladder", "Sell about the same amount at every level, keep 20%."],
  ["ride", "Ride to the top", "Sell lightly early and more near the ideal range and extension, keep 10%."],
  ["custom", "Custom", "Set your own levels and amounts."],
];
function getTps() { return (S.model && Array.isArray(S.model.tps) && S.model.tps.length ? S.model.tps : DEFAULT_TPS); }
function tpLevels(tp) {
  const L = [];
  if (num(tp.min)) L.push({ k: "min", label: "Bare minimum", price: num(tp.min) });
  if (num(tp.lo)) L.push({ k: "lo", label: "Ideal low", price: num(tp.lo) });
  if (num(tp.lo) && num(tp.hi)) L.push({ k: "mid", label: "Ideal mid", price: (num(tp.lo) + num(tp.hi)) / 2 });
  if (num(tp.hi)) L.push({ k: "hi", label: "Ideal high", price: num(tp.hi) });
  if (num(tp.ext)) L.push({ k: "ext", label: "Extension", price: num(tp.ext) });
  return L;
}
function tpFor(coinId, symbol) {
  const sym = String(symbol || "").toUpperCase();
  const tps = getTps();
  return tps.find(t => t.coin && t.coin === coinId) || tps.find(t => sym && t.sym === sym) || null;
}
const round5 = (v) => Math.max(0, Math.round(v / 5) * 5);
/** Suggested steps (percent of the position) for a strategy. */
function presetSteps(tp, strategy, h) {
  const L = tp ? tpLevels(tp) : [];
  if (!L.length) return [{ k: "custom", price: 0, pct: 25 }];
  if (strategy === "even") {
    const each = round5(80 / L.length) || 5;
    return L.map(l => ({ k: l.k, pct: each }));
  }
  if (strategy === "ride") {
    const w = L.map((_, i) => i + 1), W = w.reduce((s, x) => s + x, 0);
    const steps = L.map((l, i) => ({ k: l.k, pct: round5(90 * w[i] / W) }));
    return fixTotal(steps, 90);
  }
  // initials first: recover cost at the first level, ladder the rest, keep >= 10%
  const first = L[0];
  let init = 25;
  if (h && h.qty > 0 && h.cost > 0 && first.price > 0) init = Math.min(60, Math.max(5, Math.ceil(h.cost / (h.qty * first.price) * 100 / 5) * 5));
  const rest = L.slice(1), left = Math.max(0, 90 - init);
  const steps = [{ k: first.k, pct: init }, ...rest.map(l => ({ k: l.k, pct: rest.length ? round5(left / rest.length) : 0 }))];
  return fixTotal(steps, Math.min(90, init + left));
}
function fixTotal(steps, total) {
  let sum = steps.reduce((s, x) => s + x.pct, 0);
  while (sum > total && steps.some(x => x.pct > 0)) { const big = steps.reduce((a, b) => (b.pct > a.pct ? b : a)); big.pct -= 5; sum -= 5; }
  return steps;
}
function stepPrice(tp, st) { if (st.k === "custom") return num(st.price); const l = (tp ? tpLevels(tp) : []).find(x => x.k === st.k); return l ? l.price : num(st.price); }
/** What a coin's plan would pay out, step by step. */
function exitCalc(tp, cp, h) {
  const qty = h?.qty || 0, cost = h?.cost || 0;
  let cum = 0, sold = 0, initialsAt = null;
  const rows = (cp.steps || []).map((st, i) => {
    const price = stepPrice(tp, st), pct = clamp(num(st.pct), 0, 100);
    const units = qty * pct / 100, cash = units * price;
    return { ...st, idx: i, price, pct, units, cash };
  });
  for (const [j, r] of rows.entries()) { cum += r.cash; sold += r.pct; r.cum = cum; if (initialsAt == null && cost > 0 && cum >= cost) initialsAt = j; }
  return { rows, sold, keep: Math.max(0, 100 - sold), total: cum, initialsAt, over: sold > 100 };
}
function exitCoins(pf, plan) {
  const out = [], seen = new Set();
  for (const h of pf.holdings) {
    if (STABLE_IDS.includes(h.coin_id)) continue;
    out.push({ id: h.coin_id, h, tp: tpFor(h.coin_id, h.symbol) }); seen.add(h.coin_id);
  }
  for (const [id, cp] of Object.entries(plan?.coins || {})) if (!seen.has(id)) { out.push({ id, h: null, tp: tpFor(id, cp.sym || CG.info(id)?.symbol), notHeld: true }); seen.add(id); }
  return out.sort((a, b) => (b.h ? 1 : 0) - (a.h ? 1 : 0) || (b.tp?.main ? 1 : 0) - (a.tp?.main ? 1 : 0) || (b.h?.value || 0) - (a.h?.value || 0));
}
function exitStatus(p) {
  const ep = p?.exit_plan;
  if (!ep || !ep.committed_at) return { state: "none", label: "No exit plan" };
  if (ep.updated_at && new Date(ep.updated_at) > new Date(ep.committed_at)) return { state: "edited", label: "Exit plan edited, not re-committed" };
  return { state: "committed", label: "Exit plan committed " + ago(ep.committed_at) };
}
const fp = (v) => { const n = num(v); return n >= 1 ? "$" + (+n.toPrecision(4)).toLocaleString("en-US") : fmtPrice(n).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1"); };
function tpLadderBar(tp, price, avg) {
  const L = tpLevels(tp); if (!L.length) return "";
  const lo = Math.min(...L.map(l => l.price), price || Infinity, avg || Infinity) * 0.7, hi = Math.max(...L.map(l => l.price)) * 1.15;
  const x = (v) => clamp((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) * 100, 0, 100);
  const zone = num(tp.lo) && num(tp.hi) ? `<div class="tpz" style="left:${x(tp.lo)}%;width:${x(tp.hi) - x(tp.lo)}%" title="Ideal TP range"></div>` : "";
  const mark = (v, cls, t) => v > 0 ? `<div class="tpm ${cls}" style="left:${x(v)}%" title="${esc(t)}"></div>` : "";
  return `<div class="tpbar">${zone}${mark(num(tp.min), "min", "Bare minimum " + fmtPrice(tp.min))}${mark(num(tp.ext), "ext", "Extension " + fmtPrice(tp.ext))}${mark(avg, "avg", "Your average buy " + fmtPrice(avg))}${mark(price, "now", "Price now " + fmtPrice(price))}</div>
    <div class="tplegend"><span><i class="now"></i>Now ${fp(price)}</span>${avg ? `<span><i class="avg"></i>Avg ${fp(avg)}</span>` : ""}${num(tp.min) ? `<span><i class="min"></i>Min ${fp(tp.min)}</span>` : ""}${num(tp.lo) ? `<span><i class="zone"></i>Ideal ${fp(tp.lo)}–${fp(tp.hi).replace("$", "")}</span>` : ""}${num(tp.ext) ? `<span><i class="ext"></i>Ext ${fp(tp.ext)}</span>` : ""}</div>`;
}
async function viewExit(v) {
  v.innerHTML = `<div class="spinner"></div>`;
  const saved = S.me.exit_plan || {};
  const plan = JSON.parse(JSON.stringify({ coins: {}, pledges: {}, goal: null, ...saved }));
  await CG.ensure([...S.txs.map(t => t.coin_id), ...getTps().filter(t => t.coin).map(t => t.coin), ...Object.keys(plan.coins || {})]);
  const pf = computePortfolio(S.txs);
  let coins = exitCoins(pf, plan);
  for (const c of coins) if (!plan.coins[c.id] && c.h && c.tp) plan.coins[c.id] = { strategy: "initials", steps: presetSteps(c.tp, "initials", c.h) };
  let dirty = false, lastTotal = null, lastDelta = 0;
  // Each step's price is stored too, so the hourly TP check can ping without knowing Dkay's levels.
  const stamp = () => { for (const [id, cp] of Object.entries(plan.coins)) { const tp = tpFor(id, cp.sym || CG.info(id)?.symbol); cp.steps.forEach(st => st.at = stepPrice(tp, st)); } };
  const save = debounce(async () => {
    if (!dirty) return;
    try { stamp(); plan.updated_at = new Date().toISOString(); S.me = await api.updateProfile(S.me.id, { exit_plan: plan }); dirty = false; paintStatus(); } catch (e) { toast("Couldn't save: " + e.message); }
  }, 800);
  const touch = () => { dirty = true; paintSummary(); paintStatus(); save(); };
  const coinCard = (c) => {
    const info = CG.info(c.id), price = info?.price ?? c.h?.price ?? 0, tp = c.tp, cp = plan.coins[c.id];
    const L = tp ? tpLevels(tp) : [];
    const head = `<div class="row" style="align-items:center;justify-content:space-between;flex-wrap:wrap">
        <div style="flex:1;min-width:180px">${coinCell({ coin_id: c.id, symbol: (info?.symbol || tp?.sym || c.h?.symbol || "").toLowerCase(), name: info?.name || c.h?.name || tp?.label || c.id, image: info?.image })}</div>
        <div class="secondary num" style="flex:none;font-size:13px">${c.h ? `${fmtQty(c.h.qty)} held · avg ${fmtPrice(c.h.avg)} · worth ${fmtUsd(c.h.value)}` : `Not held yet · <button class="link-btn" data-rm-coin="${esc(c.id)}">Remove</button>`}</div></div>`;
    if (!cp) return `<div class="card exit-card">${head}${tp ? tpLadderBar(tp, price, 0) : ""}<button class="btn small" data-plan="${esc(c.id)}" style="margin-top:10px">Plan an exit for this coin</button></div>`;
    const calc = exitCalc(tp, cp, c.h);
    const narrow = window.matchMedia && matchMedia("(max-width: 640px)").matches, SHORT = { min: "Min", lo: "Low", mid: "Mid", hi: "High", ext: "Ext" };
    const lvlOpts = (st) => [...L.map(l => `<option value="${l.k}" ${st.k === l.k ? "selected" : ""}>${narrow ? SHORT[l.k] + " " + fmtPrice(l.price).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1") : l.label + " · " + fmtPrice(l.price)}</option>`), `<option value="custom" ${st.k === "custom" ? "selected" : ""}>${narrow ? "Custom" : "Custom price…"}</option>`].join("");
    return `<div class="card exit-card" data-coin="${esc(c.id)}">${head}
      ${tp ? tpLadderBar(tp, price, c.h?.avg) : `<div class="hint">${esc(CONFIG.REVIEWER_NAME)} hasn't set targets for this coin, so use custom prices.</div>`}
      <div class="chips" style="margin:12px 0 8px">${EXIT_STRATEGIES.map(([k, l, d]) => `<button class="chip ${cp.strategy === k ? "on" : ""}" data-strat="${k}" title="${esc(d)}">${l}</button>`).join("")}</div>
      <div class="table-wrap"><table class="exit-steps"><thead><tr><th class="drag" aria-label="Order"></th><th>Sell at</th><th class="r">${narrow ? "%" : "% of bag"}</th><th class="r hide-sm">Price</th><th class="r">${narrow ? "≈ $" : "≈ Cash out"}</th><th class="r hide-sm">Total so far</th><th></th></tr></thead><tbody>
        ${cp.steps.map((st, i) => { const r = calc.rows.find(x => x.idx === i) || {}; return `<tr data-row="${i}">
          <td class="drag"><span class="drag-h" data-drag="${i}" tabindex="0" role="button" aria-label="Drag to reorder (or use arrow keys)" title="Drag to reorder">⠿</span></td>
          <td class="sell"><select data-i="${i}" data-f="k" style="min-width:150px">${lvlOpts(st)}</select>${st.k === "custom" ? `<input type="text" enterkeyhint="done" inputmode="decimal" data-i="${i}" data-f="price" value="${st.price || ""}" placeholder="$ price" class="ex-price">` : ""}</td>
          <td class="r"><input type="text" enterkeyhint="done" inputmode="decimal" data-i="${i}" data-f="pct" value="${num(st.pct)}" style="width:${narrow ? 48 : 62}px;text-align:right">%</td>
          <td class="r num hide-sm">${fmtPrice(stepPrice(tp, st))}${c.h?.avg ? `<div class="muted" style="font-size:12px">${(stepPrice(tp, st) / c.h.avg).toFixed(1)}× your avg</div>` : ""}</td>
          <td class="r num">${c.h ? (narrow ? "$" + Math.round(c.h.qty * num(st.pct) / 100 * stepPrice(tp, st)).toLocaleString("en-US") : fmtUsd(c.h.qty * num(st.pct) / 100 * stepPrice(tp, st))) : "—"}</td>
          <td class="r num hide-sm">${r.cum != null && c.h ? fmtUsd(r.cum) : "—"}${r.cum != null && calc.initialsAt != null && calc.rows[calc.initialsAt] === r ? `<div class="good" style="font-size:12px">✓ initials back</div>` : ""}</td>
          <td class="r"><button class="link-btn" data-del="${i}" aria-label="Remove step">✕</button></td></tr>`; }).join("")}
      </tbody></table></div>
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;margin-top:8px">
        <div class="row" style="flex:none;align-items:center;gap:8px"><button class="btn small" data-add="1" style="flex:none">+ Add a step</button>${cp.steps.length > 1 ? `<span class="muted" style="flex:none;font-size:12px">drag ⠿ to reorder</span>` : ""}</div>
        <div class="num ${calc.over ? "bad" : "secondary"}" style="flex:1 1 240px;min-width:0;font-size:13px;line-height:1.5">Sells <b>${calc.sold}%</b> · keeps <b>${calc.keep}%</b> as a moonbag${c.h ? ` · ≈ <b>${fmtUsd(calc.total)}</b> out` : ""}${calc.over ? " · over 100%, lower a step" : ""}${c.h?.cost && calc.initialsAt == null && !calc.over ? ` · <span class="bad">doesn't get your initial ${fmtUsd(c.h.cost)} back</span>` : ""}</div>
      </div></div>`;
  };
  v.innerHTML = `
    <div class="page-head"><div><h1>Exit plan</h1></div><div id="ex-status"></div></div>
    <div class="card guide"><h2>${esc(CONFIG.REVIEWER_NAME)}'s exit rules</h2>
      <ul class="guide-list">
        <li><b>Set your targets now.</b></li>
        <li><b>You cannot time the market.</b></li>
        <li><b>Sell in steps.</b></li>
        <li><b>Get your initials out early.</b></li>
        <li><b>Buy aggressively at the bottom.</b></li>
        <li><b>Take profit at macro levels.</b></li>
        <li><b>Make capital preservation the focus.</b></li>
      </ul></div>
    <div class="two-col" style="margin-top:16px">
      <div class="card"><h2>Your money goal</h2>
        <label class="field"><span>Total I want to cash out ($)</span><input type="text" enterkeyhint="done" inputmode="decimal" id="ex-goal" value="${plan.goal || ""}" placeholder="e.g. 50000"></label>
        <div id="ex-sum"></div>
      </div>
      <div class="card"><h2>Commit</h2>
        <div id="ex-pledges">${EXIT_PLEDGES.map(([k, t, q]) => `<label class="pledge"><input type="checkbox" data-pledge="${k}" ${plan.pledges[k] ? "checked" : ""}><span>${esc(t)}</span></label>`).join("")}</div>
        <button class="btn primary" id="ex-commit" style="margin-top:10px">Commit to my exit plan</button>
        ${api.demo ? "" : `<label class="pledge" style="margin-top:12px"><input type="checkbox" id="ex-ping" ${S.me.tp_alerts ? "checked" : ""}><span>Ping me in Telegram when a coin hits one of my sell steps</span></label>`}
        <div class="err" id="ex-err"></div>
      </div>
    </div>
    <h2 class="section-h">Your coins</h2>
    <div class="grid" id="ex-coins">${coins.map(coinCard).join("")}</div>
    <div class="card" style="margin-top:16px"><h2>Add a coin</h2>
      <div class="add-coin"><select id="ex-add-sel" aria-label="Coin with ${esc(CONFIG.REVIEWER_NAME)}'s targets"></select><button class="btn" id="ex-add-btn">Add</button></div>
      <div class="search-wrap" style="margin-top:10px"><input type="search" enterkeyhint="done" id="ex-add-q" placeholder="Search coin" autocomplete="off"><div class="dropdown hidden" id="ex-add-dd"></div></div>
    </div>
    ${getTps().some(t => !t.main) ? `<div class="card" style="margin-top:16px"><h2>Other coins ${esc(CONFIG.REVIEWER_NAME)} has targets for</h2><div class="secondary" style="font-size:13px">${getTps().filter(t => !t.main).map(t => `${esc(t.sym)}: ${tpLevels(t).filter(l => l.k !== "mid").map(l => fmtPrice(l.price)).join(" / ")}`).join(" · ")}</div><div class="hint">Not part of the main five. They show up above if you hold or add them.</div></div>` : ""}`;
  const paintStatus = () => {
    if (!$("#ex-status") || !v.isConnected) return;
    const st = exitStatus({ exit_plan: { ...plan, updated_at: dirty ? new Date().toISOString() : plan.updated_at } });
    $("#ex-status").innerHTML = `<span class="tag ${st.state === "committed" ? "buy" : st.state === "edited" ? "req" : "flag"}" style="font-size:12px">${st.state === "committed" ? "✓ " : ""}${esc(st.label)}</span>`;
    $("#ex-commit").textContent = st.state === "committed" ? "Re-commit (no changes)" : st.state === "edited" ? "Re-commit my updated plan" : "Commit to my exit plan";
  };
  const paintSummary = () => {
    if (!$("#ex-sum") || !v.isConnected) return;
    let total = 0, initialsOk = 0, held = 0;
    for (const c of coins) { const cp = plan.coins[c.id]; if (!cp || !c.h) continue; held++; const k = exitCalc(c.tp, cp, c.h); total += k.total; if (k.initialsAt != null || !c.h.cost) initialsOk++; }
    const goal = num(plan.goal);
    if (lastTotal != null && Math.abs(total - lastTotal) > 0.005) lastDelta = total - lastTotal;
    lastTotal = total;
    $("#ex-sum").innerHTML = `<div class="kpis" style="margin:4px 0 0">
      <div class="card kpi"><div class="label">Plan cashes out</div><div class="value num">${fmtUsd(total, { compact: total >= 1e6 })}</div>${lastDelta ? `<div class="sub num ${signCls(lastDelta)}">${signed(lastDelta)} from your last change</div>` : ""}</div>
      <div class="card kpi"><div class="label">Goal covered</div><div class="value num ${goal && total >= goal ? "good" : ""}">${goal ? Math.min(999, Math.round(total / goal * 100)) + "%" : "—"}</div><div class="sub muted">${goal ? (total >= goal ? "reached" : `${fmtUsd(goal - total)} short`) : ""}</div></div>
      <div class="card kpi"><div class="label">Initials back</div><div class="value num">${initialsOk}/${held}</div></div></div>
`;
  };
  const bind = () => {
    v.querySelectorAll("[data-plan]").forEach(b => b.onclick = () => { const c = coins.find(x => x.id === b.dataset.plan); plan.coins[c.id] = { strategy: c.tp ? "initials" : "custom", steps: presetSteps(c.tp, "initials", c.h) }; repaintCoins(); touch(); });
    v.querySelectorAll("[data-rm-coin]").forEach(b => b.onclick = () => { delete plan.coins[b.dataset.rmCoin]; repaintCoins(); touch(); });
    v.querySelectorAll(".exit-card[data-coin]").forEach(card => {
      const id = card.dataset.coin, c = coins.find(x => x.id === id), cp = plan.coins[id];
      card.querySelectorAll("[data-strat]").forEach(b => b.onclick = () => { cp.strategy = b.dataset.strat; if (b.dataset.strat !== "custom") cp.steps = presetSteps(c.tp, b.dataset.strat, c.h); repaintCoins(); touch(); });
      card.querySelectorAll("[data-f]").forEach(inp => inp.onchange = () => {
        const st = cp.steps[+inp.dataset.i], f = inp.dataset.f;
        if (f === "k") { st.k = inp.value; if (st.k === "custom" && !st.price) st.price = Math.round((CG.info(id)?.price || 0) * 2 * 1e6) / 1e6; }
        else st[f] = Math.max(0, decOr0(inp.value));
        cp.strategy = "custom"; touch();
        // repaint after the current tap finishes, so a button tapped while typing still gets its click
        setTimeout(() => { if (v.contains(card)) repaintCoins(); }, 0);
      });
      card.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { cp.steps.splice(+b.dataset.del, 1); cp.strategy = "custom"; if (!cp.steps.length) delete plan.coins[id]; repaintCoins(); touch(); });
      const moveStep = (from, to) => { if (to < 0 || to >= cp.steps.length || from === to) return false; const [st] = cp.steps.splice(from, 1); cp.steps.splice(to, 0, st); return true; };
      card.querySelectorAll("[data-drag]").forEach(hd => {
        hd.addEventListener("keydown", (e) => {
          const i = +hd.dataset.drag, d = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
          if (!d) return; e.preventDefault();
          if (moveStep(i, i + d)) { repaintCoins(); touch(); v.querySelector(`.exit-card[data-coin="${CSS.escape(id)}"] [data-drag="${i + d}"]`)?.focus(); }
        });
        hd.addEventListener("pointerdown", (e) => {
          if (e.button > 0) return;
          e.preventDefault();
          const row = hd.closest("tr"), tbody = row.parentNode, from = [...tbody.children].indexOf(row);
          if (document.activeElement && document.activeElement !== hd) document.activeElement.blur();
          row.classList.add("dragging");
          try { hd.setPointerCapture(e.pointerId); } catch (_) {}   // keep getting moves if the mouse leaves the window
          let lastY = e.clientY, raf = 0;
          const place = (y) => {
            let before = null;
            for (const r of tbody.children) { if (r === row) continue; const b = r.getBoundingClientRect(); if (y < b.top + b.height / 2) { before = r; break; } }
            if (before !== row.nextElementSibling || (!before && tbody.lastElementChild !== row)) tbody.insertBefore(row, before);
          };
          // Keep scrolling while the pointer rests near an edge (a still mouse fires no pointermove), faster the closer it gets.
          const EDGE = 80;
          const tick = () => {
            const vh = window.innerHeight, y = Math.max(0, Math.min(vh, lastY));
            const dy = y < EDGE ? -Math.ceil((EDGE - y) / 4) : y > vh - EDGE ? Math.ceil((y - (vh - EDGE)) / 4) : 0;
            if (dy) { const before = window.scrollY; window.scrollBy(0, dy); if (window.scrollY !== before) place(y); }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
          const move = (ev) => { lastY = ev.clientY; place(Math.max(0, Math.min(window.innerHeight, lastY))); };
          const up = () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
            row.classList.remove("dragging");
            const to = [...tbody.children].indexOf(row);
            if (moveStep(from, to)) touch();
            repaintCoins();
          };
          window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
        });
      });
      card.querySelector("[data-add]")?.addEventListener("click", () => { const L = c.tp ? tpLevels(c.tp) : []; const used = new Set(cp.steps.map(s => s.k)); const next = L.find(l => !used.has(l.k)); cp.steps.push(next ? { k: next.k, pct: 10 } : { k: "custom", price: 0, pct: 10 }); cp.strategy = "custom"; repaintCoins(); touch(); });
    });
  };
  const repaintCoins = () => { coins = exitCoins(pf, plan); $("#ex-coins").innerHTML = coins.map(coinCard).join(""); bind(); paintAdd(); };
  const addCoin = async (id, sym) => {
    if (!id) return;
    if (!plan.coins[id] && !coins.some(c => c.id === id && c.h)) {
      await CG.ensure([id]);
      const tp = tpFor(id, sym || CG.info(id)?.symbol);
      plan.coins[id] = { strategy: tp ? "initials" : "custom", steps: presetSteps(tp, "initials", null), sym: String(sym || CG.info(id)?.symbol || tp?.sym || "").toUpperCase() };
      touch();
    }
    repaintCoins();
    const card = v.querySelector(`.exit-card[data-coin="${CSS.escape(id)}"]`) || v.querySelector(`[data-plan="${CSS.escape(id)}"]`);
    if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); toast(`${symOf(id)} added with a suggested plan`); }
  };
  const paintAdd = () => {
    const shown = new Set(coins.map(c => c.id)), shownTps = new Set(coins.map(c => c.tp).filter(Boolean));
    const opts = getTps().filter(t => t.coin && !shown.has(t.coin) && !shownTps.has(t));
    const sel = $("#ex-add-sel"), btn = $("#ex-add-btn");
    sel.innerHTML = opts.length ? `<option value="">Select a coin</option>` + opts.map(t => `<option value="${esc(t.coin)}" data-sym="${esc(t.sym)}">${esc(t.sym || nameSym(t.label))}${t.main ? "" : " (other)"}</option>`).join("") : `<option value="">All of ${esc(CONFIG.REVIEWER_NAME)}'s target coins are in your plan</option>`;
    sel.disabled = !opts.length; btn.disabled = !opts.length;
  };
  $("#ex-add-btn").onclick = () => { const sel = $("#ex-add-sel"); if (!sel.value) return sel.focus(); addCoin(sel.value, sel.selectedOptions[0]?.dataset.sym); };
  { const q = $("#ex-add-q"), dd = $("#ex-add-dd");
    const run = debounce(async () => {
      let s = q.value.trim(); const m = s.match(/coingecko\.com\/(?:[a-z]{2}\/)?coins\/([a-z0-9-]+)/i); if (m) s = m[1];
      if (s.length < 2) { dd.classList.add("hidden"); return; }
      dd.classList.remove("hidden"); dd.innerHTML = `<div class="opt muted">Searching…</div>`;
      const res = (await CG.search(s)).filter(c => !STABLE_IDS.includes(c.id));
      if (!res.length) { dd.innerHTML = `<div class="opt muted">No coins found.</div>`; return; }
      dd.innerHTML = res.map((c, i) => `<div class="opt" data-i="${i}">${coinCell({ ...c, coin_id: c.id }, true)}<span class="muted" style="font-size:12px">${coins.some(x => x.id === c.id) ? "in your plan" : tpFor(c.id, c.symbol) ? "has targets" : c.rank ? "#" + c.rank : ""}</span></div>`).join("");
      dd.querySelectorAll(".opt[data-i]").forEach(o => o.onclick = () => { const c = res[+o.dataset.i]; q.value = ""; dd.classList.add("hidden"); q.blur(); addCoin(c.id, c.symbol); });
    }, 350);
    q.oninput = run;
  }
  $("#ex-goal").oninput = debounce(e => { plan.goal = Math.max(0, decOr0(e.target.value)) || null; touch(); }, 300);
  $("#ex-ping") && ($("#ex-ping").onchange = async (e) => {
    try { S.me = await api.updateProfile(S.me.id, { tp_alerts: e.target.checked }); if (e.target.checked) { touch(); toast(S.me.telegram_chat_id ? "You'll get a ping when a step is hit" : "Open the Desk from the CC bot once so it can message you"); } }
    catch (err) { e.target.checked = !e.target.checked; toast("Couldn't save: " + err.message); }
  });
  v.querySelectorAll("[data-pledge]").forEach(cb => cb.onchange = () => { plan.pledges[cb.dataset.pledge] = cb.checked; touch(); });
  $("#ex-commit").onclick = async () => {
    const missing = EXIT_PLEDGES.filter(([k]) => !plan.pledges[k]);
    const planned = coins.filter(c => plan.coins[c.id] && c.h);
    const over = planned.filter(c => exitCalc(c.tp, plan.coins[c.id], c.h).over);
    $("#ex-err").textContent = "";
    if (!planned.length) return $("#ex-err").textContent = "Plan at least one coin you hold first.";
    if (over.length) return $("#ex-err").textContent = `Your ${over.map(c => symOf(c.id)).join(", ")} plan sells more than 100%.`;
    if (missing.length) return $("#ex-err").textContent = `Tick all ${EXIT_PLEDGES.length} rules to commit (${missing.length} left).`;
    if (!num(plan.goal)) return $("#ex-err").textContent = "Set your money goal first.";
    try { stamp(); const now = new Date().toISOString(); plan.updated_at = now; plan.committed_at = now; S.me = await api.updateProfile(S.me.id, { exit_plan: plan }); dirty = false; paintStatus(); toast("Exit plan committed. Stick to it!"); }
    catch (e) { $("#ex-err").textContent = e.message; }
  };
  bind(); paintAdd(); paintSummary(); paintStatus();
}
/** Dkay's read-only view of a member's exit plan. */
function exitCard(p, pf) {
  const st = exitStatus(p), ep = p.exit_plan;
  if (!ep || !ep.coins || !Object.keys(ep.coins).length) return `<div class="card" style="margin-top:16px"><h2>Exit plan</h2><div class="secondary">${esc(memberName(p))} hasn't made an exit plan yet.</div></div>`;
  const lines = Object.entries(ep.coins).map(([id, cp]) => {
    const h = pf.holdings.find(x => x.coin_id === id), tp = tpFor(id, h?.symbol || cp.sym), k = exitCalc(tp, cp, h);
    return `<tr><td><b>${esc(symOf(id))}</b></td><td>${k.rows.map(r => `${r.pct}% @ ${fmtPrice(r.price)}`).join(" · ") || "—"}</td><td class="r num">${k.keep}%</td><td class="r num">${h ? fmtUsd(k.total, { compact: k.total >= 1e6 }) : "—"}</td><td>${h?.cost ? (k.initialsAt != null ? '<span class="good">yes</span>' : '<span class="bad">no</span>') : "—"}</td></tr>`;
  }).join("");
  return `<div class="card" style="margin-top:16px"><h2>Exit plan <span class="tag ${st.state === "committed" ? "buy" : st.state === "edited" ? "req" : "flag"}" style="margin-left:6px">${esc(st.label)}</span></h2>
    <div class="secondary" style="margin-bottom:8px">Money goal: <b>${ep.goal ? fmtUsd(ep.goal) : "not set"}</b> · rules agreed: ${EXIT_PLEDGES.filter(([k]) => ep.pledges?.[k]).length}/${EXIT_PLEDGES.length}</div>
    <div class="table-wrap"><table><thead><tr><th>Coin</th><th>Steps</th><th class="r">Moonbag</th><th class="r">≈ Cash out</th><th>Initials back</th></tr></thead><tbody>${lines}</tbody></table></div></div>`;
}

