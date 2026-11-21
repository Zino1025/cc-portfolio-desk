/* ===================== SIGNALS (spot swing calls from Dkay, Anton, Saad) =====================
   Visible to Signals/Both members, Signals Admins and admins (RLS: sees_signals). Signals Admins post and manage them.
   A signal is Waiting (limit/zone not filled), Active or Closed. Each lifecycle post is a signal_updates row that the
   database applies to the signal (supabase/signals.sql) and tg-notify pings to members. */
const SIG_TF = { scalp: "Scalp", swing: "Swing", long: "Long term" };
const SIG_TF_DAYS = { scalp: 7, swing: 56, long: 120 };   // default review date
const SIG_OUT = { won: ["Won", "good"], stopped: ["Stopped out", "bad"], early: ["Closed early", ""], expired: ["Expired", ""] };
const SIG_UP = { note: "Update", entry: "Entry filled", tp: "TP hit", breakeven: "Stop to entry", close: "Close" };
const sigRef = (s) => s.entry_high ? (+s.entry_low + +s.entry_high) / 2 : +s.entry_low;   // % is measured from here
const sigPct = (s, p) => fmtPct((p / sigRef(s) - 1) * 100).replace(/\.\d+%/, "%");
const sigTps = (s) => [...(s.signal_targets || [])].sort((a, b) => a.n - b.n);

async function viewSignals(v) {
  if (!seesSignals()) { v.innerHTML = `<div class="card empty"><div class="big">Signals is a separate plan</div>Spot swing calls from ${esc(CONFIG.REVIEWER_NAME)}, Anton and Saad, with a ping for every entry, target and exit. Message ${esc(CONFIG.REVIEWER_NAME)} to add it.</div>`; return; }
  v.innerHTML = `<div class="spinner"></div>`;
  const [sigs, rules] = await Promise.all([api.signals(), api.splitRules()]);
  S.sigs = sigs; S.splitRules = Object.fromEntries(rules.map(r => [r.targets, r.pcts]));
  const tab = S.sigTab || (sigs.some(s => s.status === "active") ? "active" : "waiting"), list = sigs.filter(s => s.status === tab);
  const n = (k) => sigs.filter(s => s.status === k).length;
  v.innerHTML = `
    <div class="page-head"><div><h1>Signals</h1></div>${canPostSignals() ? `<button class="icon-btn primary" id="sig-new" aria-label="New signal">${ICON.plus}</button>` : ""}</div>
    <div class="seg seg-fill" role="tablist" style="margin-bottom:16px">${[["waiting", "Waiting"], ["active", "Active"], ["closed", "Closed"]].map(([k, l]) => `<button role="tab" data-st="${k}"${k === tab ? ' class="on" aria-selected="true"' : ""}>${l} ${n(k) || ""}</button>`).join("")}</div>
    <div class="grid">${list.map(sigCard).join("") || `<div class="card empty">${tab === "closed" ? "No closed signals yet." : tab === "active" ? "No active signals. Signals go quiet on purpose in weak markets." : "No signals waiting for entry."}</div>`}</div>`;
  v.querySelectorAll("[data-st]").forEach(b => b.onclick = () => { S.sigTab = b.dataset.st; viewSignals(v); });
  $("#sig-new") && ($("#sig-new").onclick = () => sigPostModal(v));
  v.querySelectorAll("[data-sig-up]").forEach(b => b.onclick = () => sigUpdateModal(sigs.find(s => s.id === b.dataset.sigUp), v));
  v.querySelectorAll("[data-sig-edit]").forEach(b => b.onclick = () => sigPostModal(v, sigs.find(s => s.id === b.dataset.sigEdit)));
}

function sigCard(s) {
  const tps = sigTps(s), split = S.splitRules[tps.length], due = s.status !== "closed" && s.review_at && s.review_at <= todayISO();
  const row = (k, val, pct, cls = "") => `<div class="sig-k">${k}</div><div class="sig-v num ${cls}">${val}${pct ? ` <span class="muted">${pct}</span>` : ""}</div>`;
  const entry = s.entry_type === "zone" ? `${fmtPrice(s.entry_low)} – ${fmtPrice(s.entry_high)}` : `${s.entry_type === "now" ? "Now" : "Limit"} ${fmtPrice(s.entry_low)}`;
  const stop = s.stop_type === "none" ? "None, we'll call it" : `${fmtPrice(s.stop_price)}${s.stop_type === "close" ? " daily close" : ""}`;
  const ups = [...(s.signal_updates || [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return `<div class="card sig">
    <div class="sig-top"><div style="min-width:0"><div class="sig-sym">${esc(s.symbol)}</div>
      <div class="muted sig-meta">${esc(s.exchange)} · ${SIG_TF[s.timeframe]} · ${ago(s.created_at)}${s.analyst_name ? ` · ${esc(s.analyst_name)}` : ""}</div></div>
      <div class="chips" style="justify-content:flex-end">${s.outcome ? `<span class="tag ${SIG_OUT[s.outcome][1]}">${SIG_OUT[s.outcome][0]}</span>` : ""}${s.risk === "high" ? `<span class="tag req">High risk</span>` : ""}${due ? `<span class="tag req">Review due</span>` : ""}</div></div>
    <div class="sig-rows">${row("Entry", entry)}
      ${tps.map(t => row(`TP${t.n}`, `${t.hit_at ? "✓ " : ""}${fmtPrice(t.price)}`, sigPct(s, t.price), t.hit_at ? "good" : "")).join("")}
      ${row("Stop", stop, s.stop_type === "none" ? "" : sigPct(s, s.stop_price))}
      ${row("Sell plan", split ? split.map((p, i) => `${p}% at TP${i + 1}`).join(" · ") : "TBD")}</div>
    ${s.note ? `<p class="sig-note">${esc(s.note)}</p>` : ""}${ATT.html(s.attachments)}
    ${ups.length ? `<div class="sig-ups">${ups.map(u => `<div class="sig-up"><b>${u.kind === "tp" ? `TP${u.tp_n} hit` : u.kind === "close" ? `Closed: ${SIG_OUT[u.outcome][0]}` : u.kind === "edit" ? "Edited" : SIG_UP[u.kind]}</b> <span class="muted">· ${ago(u.created_at)}${u.author_name ? ` · ${esc(u.author_name)}` : ""}</span>${u.body ? `<p>${esc(u.body)}</p>` : ""}</div>`).join("")}</div>` : ""}
    ${canPostSignals() && s.status !== "closed" ? `<div class="btn-row" style="margin-top:14px"><button class="btn" data-sig-edit="${esc(s.id)}">Edit</button><button class="btn" data-sig-up="${esc(s.id)}">Post update</button></div>` : ""}
  </div>`;
}

/** Form check: returns [message, field id] for the first problem, or null. */
function sigCheck(f) {
  if (!/^[A-Z0-9]{1,15}$/.test(f.symbol)) return ["Add the ticker", "sg-coin"];
  if (!(f.entry_low > 0)) return ["Add the entry price", "sg-lo"];
  if (f.entry_type === "zone" && !(f.entry_high > f.entry_low)) return ["Zone top must be above the bottom", "sg-hi"];
  if (!f.tps.length) return ["Add TP1", "sg-tp1"];
  let prev = f.entry_high || f.entry_low;
  for (let i = 0; i < f.tps.length; i++) {
    if (!(f.tps[i] > 0)) return [`Fill TP${i + 1} or remove the targets after it`, `sg-tp${i + 1}`];
    if (f.tps[i] <= prev) return [i ? `TP${i + 1} must be above TP${i}` : "TP1 must be above the entry", `sg-tp${i + 1}`];
    prev = f.tps[i];
  }
  if (f.stop_type !== "none" && !(f.stop_price > 0)) return ["Add the stop price or pick None", "sg-stop"];
  if (f.stop_type !== "none" && f.stop_price >= f.entry_low) return ["Stop must be below the entry", "sg-stop"];
  return null;
}

/** New signal, or edit `s` (same form, prefilled; coin stays fixed; the edit pings members with the new levels). */
function sigPostModal(v, s) {
  const e = s || { exchange: "MEXC", risk: "normal", entry_type: "now", stop_type: "close", timeframe: "swing" }, tps0 = s ? sigTps(s) : [];
  const seg = (id, opts, on) => `<select id="${id}" class="as-seg">${opts.map(([k, l]) => `<option value="${k}"${k === on ? " selected" : ""}>${l}</option>`).join("")}</select>`;
  const price = (id, label, val) => `<label class="field"><span><span id="${id}-l">${label}</span> <b class="sig-pct num" data-pct="${id}"></b></span><input type="text" inputmode="decimal" id="${id}" autocomplete="off" placeholder="$" value="${val ? +val : ""}"></label>`;
  const { ov, close } = openModal(`
    ${s ? "" : `<label class="field" style="position:relative"><span>Coin</span><input type="text" id="sg-coin" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Ticker…"><div class="dropdown hidden" id="sg-dd"></div></label>`}
    <div class="field-div"><span>Exchange</span>${seg("sg-ex", [["MEXC", "MEXC"], ["KuCoin", "KuCoin"], ["On-chain", "On-chain"]], e.exchange)}</div>
    <div class="field-div"><span>Risk</span>${seg("sg-risk", [["normal", "Normal"], ["high", "High"]], e.risk)}</div>
    <div class="field-div"><span>Entry</span>${seg("sg-et", [["now", "Now"], ["limit", "Limit"], ["zone", "Zone"]], e.entry_type)}</div>
    <div class="row">${price("sg-lo", "Price", e.entry_low)}<div id="sg-hi-w" class="hidden">${price("sg-hi", "To", e.entry_high)}</div></div>
    <div class="row">${price("sg-tp1", "TP1", tps0[0]?.price)}${price("sg-tp2", "TP2", tps0[1]?.price)}</div>
    <div class="row">${price("sg-tp3", "TP3", tps0[2]?.price)}${price("sg-tp4", "TP4", tps0[3]?.price)}</div>
    <div class="field-div"><span>Stop</span>${seg("sg-st", [["sl", "Stop loss"], ["close", "Daily close"], ["none", "None"]], e.stop_type)}</div>
    <div id="sg-stop-w">${price("sg-stop", "Stop price", e.stop_price)}</div>
    <div class="field-div"><span>Timeframe</span>${seg("sg-tf", [["scalp", "Scalp"], ["swing", "Swing"], ["long", "Long term"]], e.timeframe)}</div>
    <label class="field"><span>Review on</span><input type="date" id="sg-rev" value="${esc(e.review_at || "")}"></label>
    <label class="field"><span>Note</span><textarea id="sg-note" rows="3" maxlength="2000" placeholder="Why, sizing, runner advice…">${esc(e.note || "")}</textarea></label>
    ${s ? `<label class="field"><span>What changed</span><textarea id="sg-why" rows="2" maxlength="2000" placeholder="Sent with the new levels…"></textarea></label>` : ""}
    ${ATT.pickerHtml("att-sig")}
    <div class="btn-row"><button class="btn primary" id="sg-post">${s ? "Save" : "Post signal"}</button></div>`, { title: s ? `Edit ${esc(s.symbol)}` : "New signal", style: "max-width:460px" });
  ATT.bind("att-sig");
  const val = (id) => $("#" + id, ov).value, d = (id) => { const x = dec(val(id)); return Number.isNaN(x) ? 0 : x; };
  let coin = null;
  const read = () => {
    const tps = ["sg-tp1", "sg-tp2", "sg-tp3", "sg-tp4"].map(d); while (tps.length && !tps.at(-1)) tps.pop();
    const et = val("sg-et"), st = val("sg-st");
    return { symbol: s ? s.symbol : (coin?.symbol || val("sg-coin")).replace(/^\$/, "").trim().toUpperCase(), coin_id: s ? s.coin_id : coin?.id || null, exchange: val("sg-ex"), risk: val("sg-risk"),
      entry_type: et, entry_low: d("sg-lo"), entry_high: et === "zone" ? d("sg-hi") : null, stop_type: st, stop_price: st === "none" ? null : d("sg-stop"),
      timeframe: val("sg-tf"), review_at: val("sg-rev") || null, note: val("sg-note").trim() || null, tps };
  };
  const paint = () => {
    const f = read(), ref = sigRef(f);
    $("#sg-hi-w", ov).classList.toggle("hidden", f.entry_type !== "zone"); $("#sg-stop-w", ov).classList.toggle("hidden", f.stop_type === "none");
    $("#sg-lo-l", ov).textContent = f.entry_type === "zone" ? "From" : "Price";
    let prev = f.entry_high || f.entry_low;   // a target at or below the one before it shows red
    ov.querySelectorAll("[data-pct]").forEach(el => {
      const k = el.dataset.pct, p = d(k), show = ref > 0 && p > 0 && /tp|stop/.test(k), bad = /tp/.test(k) && p > 0 && p <= prev;
      if (/tp/.test(k) && p > 0) prev = p;
      el.textContent = show ? sigPct(f, p) : ""; el.className = "sig-pct num " + (bad ? "bad" : show ? signCls(p - ref) : "");
    });
  };
  const setReview = () => { const t = new Date(Date.now() + SIG_TF_DAYS[val("sg-tf")] * 86400000); $("#sg-rev", ov).value = new Date(t - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  if (!s) setReview(); paint();
  ov.addEventListener("input", paint); ov.addEventListener("change", (ev) => { if (ev.target.id === "sg-tf") setReview(); paint(); });
  if (!s) {
    coinSearch($("#sg-coin", ov), $("#sg-dd", ov), async (c) => {
      coin = c; $("#sg-coin", ov).value = c.symbol.toUpperCase(); $("#sg-dd", ov).classList.add("hidden");
      try { await CG.ensure([c.id], 0); const p = CG.info(c.id)?.price; if (p && !val("sg-lo")) { $("#sg-lo", ov).value = +p.toPrecision(4); paint(); } } catch (err) {}
    });
    $("#sg-coin", ov).addEventListener("input", () => { coin = null; });
  }
  $("#sg-post", ov).onclick = () => {
    const f = read(), bad = sigCheck(f);
    if (bad) { toast("Couldn't save: " + bad[0]); return $("#" + bad[1], ov).focus(); }
    const far = [...f.tps, f.stop_price].filter(Boolean).find(p => p / sigRef(f) > 10 || p / sigRef(f) < 0.1);   // likely a decimal typo
    const go = async () => {
      const btn = $("#sg-post", ov), label = btn.textContent; btn.disabled = true;
      try {
        const added = await ATT.upload("att-sig", "signals", (i, n) => { btn.textContent = `Uploading ${i}/${n}…`; });
        const all = [...(s?.attachments || []), ...(added || [])], { tps, ...sig } = f;
        btn.textContent = "Sending…";
        if (s) await api.editSignal(s.id, { ...sig, attachments: all.length ? all : null }, tps, val("sg-why"));
        else await api.postSignal({ ...sig, attachments: all.length ? all : null }, tps);
        close(); toast(s ? "Saved. Members got the new levels." : "Signal posted. Members are getting pinged.");
        if (!s) S.sigTab = f.entry_type === "now" ? "active" : "waiting"; viewSignals(v);
      } catch (err) { toast(err.message, "error"); btn.disabled = false; btn.textContent = label; }
    };
    const ping = s ? "Members get a Telegram ping with the new levels." : "Every Signals member gets a Telegram ping.";
    confirmModal(far ? "Check the prices" : s ? `Save ${f.symbol}?` : `Post ${f.symbol}?`, far ? `${fmtPrice(far)} is ${sigPct(f, far)} from the entry. ${ping}` : ping, go, { yes: s ? "Save" : "Post" });
  };
}

function sigUpdateModal(s, v) {
  const open = sigTps(s).filter(t => !t.hit_at), atEntry = s.stop_type === "sl" && +s.stop_price === +s.entry_low;
  const kinds = Object.entries(SIG_UP).filter(([k]) => !(k === "entry" && s.status !== "waiting") && !(k === "tp" && !open.length) && !(k === "breakeven" && atEntry));
  const { ov, close } = openModal(`
    <div class="chips" id="su-kind" role="radiogroup" style="margin-bottom:14px">${kinds.map(([k, l], i) => `<button class="chip${i ? "" : " on"}" role="radio" data-k="${k}">${l}</button>`).join("")}</div>
    <div class="field-div hidden" id="su-tp-w"><span>Target</span><select id="su-tp" class="as-seg">${open.map(t => `<option value="${t.n}">TP${t.n}</option>`).join("")}</select></div>
    <div class="field-div hidden" id="su-out-w"><span>Result</span><select id="su-out" class="as-seg">${Object.entries(SIG_OUT).map(([k, [l]]) => `<option value="${k}">${l.replace(" out", "")}</option>`).join("")}</select></div>
    <label class="field"><span>Message</span><textarea id="su-body" rows="3" maxlength="2000"></textarea></label>
    <div class="btn-row"><button class="btn primary" id="su-send">Send to members</button></div>`, { title: esc(s.symbol), style: "max-width:420px" });
  let kind = kinds[0][0];
  const paint = () => { ov.querySelectorAll("[data-k]").forEach(b => { b.classList.toggle("on", b.dataset.k === kind); b.setAttribute("aria-checked", b.dataset.k === kind); }); $("#su-tp-w", ov).classList.toggle("hidden", kind !== "tp"); $("#su-out-w", ov).classList.toggle("hidden", kind !== "close"); };
  ov.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { kind = b.dataset.k; paint(); }); paint();
  $("#su-send", ov).onclick = async () => {
    const body = $("#su-body", ov).value.trim();
    if (kind === "note" && !body) return $("#su-body", ov).focus();
    const tp_n = kind === "tp" ? +$("#su-tp", ov).value : null, outcome = kind === "close" ? $("#su-out", ov).value : null;
    const what = kind === "tp" ? `TP${tp_n} hit` : kind === "close" ? `Close as ${SIG_OUT[outcome][0].toLowerCase()}` : SIG_UP[kind];
    confirmModal(`${s.symbol}: ${what}?`, "Every Signals member gets a Telegram ping.", async () => {
      const btn = $("#su-send", ov); btn.disabled = true;
      try {
        await api.addSignalUpdate({ signal_id: s.id, kind, body: body || null, tp_n, outcome });
        close(); toast("Sent to members"); if (kind === "close") S.sigTab = "closed"; else if (kind !== "note") S.sigTab = "active"; viewSignals(v);
      } catch (e) { toast(e.message, "error"); btn.disabled = false; }
    }, { yes: "Send" });
  };
}
