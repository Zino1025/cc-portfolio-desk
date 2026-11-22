/* ===================== CONFIG ===================== */
const CONFIG = {
  SUPABASE_URL: "https://euoozfbbihtxrmafupeg.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_RK-nD_oFF3KHWQM2leIsrw_OW2kASrj",   // publishable key (safe in browser; RLS protects data)
  REVIEWER_NAME: "Dkay",
  GROUP_NAME: "CC",
  BOT: "CCPortfolioManagerBot",
};

/* ===================== UTILITIES ===================== */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const LOCALE_DOT = (() => { try { return new Intl.NumberFormat().formatToParts(1.5).find(p => p.type === "decimal")?.value !== ","; } catch (e) { return true; } })();
/** Parse a typed amount: accepts "0,67", "1 200.5", "$4,326.87". */
function dec(v) {
  let s = String(v ?? "").trim().replace(/[\s$]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");          // 1,234.56
  else if (/^[1-9]\d{0,2}(,\d{3})+$/.test(s) && LOCALE_DOT) s = s.replace(/,/g, ""); // 1,234 (dot-decimal locales)
  else s = s.replace(",", ".");                                              // 0,67
  const n = Number(s); return Number.isFinite(n) ? n : NaN;
}
const decOr0 = (v) => { const n = dec(v); return Number.isNaN(n) ? 0 : n; };
function fmtUsd(v, opts = {}) {
  const n = num(v), a = Math.abs(n);
  if (opts.compact && a >= 100000) return (n < 0 ? "-" : "") + "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(a);
  return (n < 0 ? "-" : "") + "$" + a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPrice(v) {
  const n = num(v);
  if (n === 0) return "$0";
  if (n >= 1) return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 0.01) return "$" + n.toFixed(4);
  return "$" + n.toPrecision(4);
}
function fmtQty(v) {
  const n = num(v);
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}
function fmtPct(v, sign = true) { const n = num(v); return (sign && n > 0 ? "+" : "") + n.toFixed(2) + "%"; }
function signCls(v) { return num(v) > 0 ? "good" : num(v) < 0 ? "bad" : ""; }
function fmtDate(d, withTime = true) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + (withTime ? " · " + dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
}
function fmtJoined(d) { const t = new Date(d + "T12:00:00"); return isNaN(t) ? "" : t.toLocaleDateString(undefined, { month: "short", year: "numeric" }); }
const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
function ago(d) {
  if (!d) return "never";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 86400 * 30) return Math.floor(s / 86400) + "d ago";
  return fmtDate(d, false);
}
function toLocalInput(d) { const dt = new Date(d); const p = (n) => String(n).padStart(2, "0"); return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`; }
function uid() { return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)); }
// Telegram's in-app browser blocks downloads, so there the bot sends the file (CSV or PNG data URL) to the member's chat.
async function saveFile(content, filename) {
  const png = content.startsWith("data:image/png");
  if (TG) {
    toast("Sending to your Telegram chat…");
    const { data, error } = await sb.functions.invoke("tg-link", { body: { initData: TG.initData, [png ? "png" : "csv"]: png ? content.split(",")[1] : content, filename } });
    return toast(!error && data && data.ok ? "Sent. Check your chat with the bot." : "Couldn't send. Open the bot chat, tap Start, then try again.");
  }
  const a = document.createElement("a");
  a.href = png ? content : URL.createObjectURL(new Blob(["\ufeff" + content], { type: "text/csv" }));
  a.download = filename; a.click();
}
// Errors stay longer (5s), dismiss on tap and buzz as an error; confirmations buzz as success; "…" progress notes stay silent.
function toast(msg, kind = /^Couldn't|^Max |blocked|isn't supported|Too short|only images|doesn't add up|^Run supabase/.test(msg) ? "error" : /…$/.test(msg) ? "" : "success") {
  document.querySelector(".toast")?.remove(); const t = document.createElement("div"); t.className = "toast" + (kind === "error" ? " err" : ""); t.setAttribute("role", kind === "error" ? "alert" : "status");
  t.textContent = msg; t.onclick = () => t.remove(); document.body.appendChild(t); haptic(kind); setTimeout(() => t.remove(), kind === "error" ? 5000 : 2600);
}
// Telegram's native haptics (success / warning / error), only inside the Telegram app.
function haptic(kind) { try { kind && TG?.HapticFeedback?.notificationOccurred(kind); } catch (e) {} }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
/** Open a modal; `title` adds a header with a close button. Tapping the backdrop closes it. Returns { ov, close }. */
function openModal(inner, { title, style = "", backdrop = true } = {}) {
  const ov = document.createElement("div"); ov.className = "overlay";
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${style}">${title ? `<h2>${title} <button class="x" aria-label="Close">×</button></h2>` : ""}${inner}</div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  if (backdrop) ov.addEventListener("click", e => { if (e.target === ov) close(); });
  if (title) ov.querySelector(".x").onclick = close;
  return { ov, close };
}
function confirmModal(title, body, onYes, { yes = "Confirm", alt, onNo } = {}) {
  const { ov, close } = openModal(`<h2>${esc(title)}</h2><p class="secondary">${esc(body)}</p><div class="row" style="justify-content:flex-end"><button class="btn" style="flex:none" id="no">${alt ? esc(alt[0]) : "Cancel"}</button><button class="btn primary" style="flex:none" id="yes">${esc(yes)}</button></div>`, { style: "max-width:380px", backdrop: !onNo });
  $("#no", ov).onclick = () => { close(); alt && alt[1](); onNo && onNo(); };
  $("#yes", ov).onclick = async () => { close(); await onYes(); };
}
/** CoinGecko search box: input + .dropdown. Accepts a ticker, name or CoinGecko page link. tag(c) = right-hand label. */
function coinSearch(q, dd, onPick, { filter = () => true, tag = (c) => (c.rank ? "#" + c.rank : ""), none = "No coins found." } = {}) {
  q.oninput = debounce(async () => {
    let s = q.value.trim(); const m = s.match(/coingecko\.com\/(?:[a-z]{2}\/)?coins\/([a-z0-9-]+)/i); if (m) s = m[1];
    if (s.length < 2) return dd.classList.add("hidden");
    dd.classList.remove("hidden"); dd.innerHTML = `<div class="opt muted">Searching…</div>`;
    const res = (await CG.search(s)).filter(filter);
    if (!res.length) { dd.innerHTML = `<div class="opt muted">${none}</div>`; return; }
    dd.innerHTML = res.map((c, i) => `<div class="opt" data-i="${i}">${coinCell({ ...c, coin_id: c.id }, true)}<span class="muted" style="font-size:12px">${tag(c)}</span></div>`).join("");
    dd.querySelectorAll(".opt[data-i]").forEach(o => o.onclick = () => onPick(res[+o.dataset.i]));
  }, 350);
}

/* Short dropdowns -> tap segments (LukeW: dropdowns are the UI of last resort).
   Any <select class="as-seg"> gets a .seg row of buttons; the select stays (hidden) as the source of truth,
   so existing .value reads and change handlers keep working. Empty-value options ("Choose…") are skipped. */
function enhanceSegSelects(root) {
  (root || document).querySelectorAll("select.as-seg:not([data-seg])").forEach(sel => {
    sel.dataset.seg = "1"; sel.hidden = true;
    const seg = document.createElement("div"); seg.className = "seg seg-fill"; seg.setAttribute("role", "radiogroup");
    const paint = () => seg.querySelectorAll("button").forEach(b => { const on = b.dataset.v === sel.value; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
    [...sel.options].filter(o => o.value !== "" && !o.disabled).forEach(o => {
      const b = document.createElement("button"); b.type = "button"; b.dataset.v = o.value; b.textContent = o.textContent; b.setAttribute("role", "radio");
      b.onclick = () => { sel.value = o.value; paint(); sel.dispatchEvent(new Event("change", { bubbles: true })); };
      seg.appendChild(b);
    });
    sel.after(seg); paint();
  });
}
new MutationObserver(() => enhanceSegSelects()).observe(document.documentElement, { childList: true, subtree: true });
const SERIES = ["--s1","--s2","--s3","--s4","--s5","--s6","--s7","--s8"];
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const atHandle = (h) => h ? "@" + h.replace(/^@/, "") : "";
function memberName(p) { return p?.display_name || atHandle(p?.telegram_handle) || "Member"; }
function handleLink(h) { if (!h) return ""; const clean = esc(h.replace(/^@/, "")); return `<a href="https://t.me/${clean}" target="_blank" rel="noopener">@${clean}</a>`; }
async function copyText(s) {   // Telegram's in-app browser can block the clipboard API: fall back to a hidden textarea
  try { await navigator.clipboard.writeText(s); } catch (e) { const t = Object.assign(document.createElement("textarea"), { value: s }); document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
}
function coinLink(id) { return `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}`; }
// Stroke icons for .icon-btn (inherit currentColor). Use these instead of emoji in buttons.
const ICON = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5"/><path d="M5 15v4h14v-4"/></svg>',
  scale: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M6 7h12"/><path d="M3 14l3-7 3 7a3 3 0 0 1-6 0zM15 14l3-7 3 7a3 3 0 0 1-6 0z"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 9l5-5 5 5"/><path d="M5 13v6h14v-6"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  shrink: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
function coinIcon(c) {
  const ab = esc((c.symbol || "?").slice(0, 3).toUpperCase());
  return c.image ? `<img src="${esc(c.image)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'${ab}'}))">` : `<span class="ph">${ab}</span>`;
}
/** Coins are shown by ticker (TET, ACN, PAAL…). showName adds the full name underneath, only where it helps tell coins apart (search results). */
function coinCell(c, showName = false) {
  const sym = String(c.symbol || "").toUpperCase(), name = c.name || c.coin_id || "";
  const main = sym || name, sub = showName && sym && name && name.toUpperCase() !== sym ? name : "";
  return `<div class="coin">${coinIcon(c)}<div><div style="font-weight:600">${esc(main)}</div>${sub ? `<div class="sym" style="text-transform:none">${esc(sub)}</div>` : ""}</div></div>`;
}

/** Ticker only: "TET", "PAAL". Falls back to the name when there's no ticker; "Tectum (TET)" → "TET". */
function nameSym(name, sym) {
  sym = String(sym || "").trim().toUpperCase(); if (sym) return sym;
  name = String(name || "").trim(); const m = name.match(/\(([^)]+)\)\s*$/); return m ? m[1].toUpperCase() : name;
}

/* ===================== ATTACHMENTS (charts, voice notes, videos, PDFs) =====================
   Stored in the private Supabase bucket "attachments"; shown through short-lived signed links.
   updates/<id>/file -> every member · msg/<member_id>/<id>/file -> that member + admins (see supabase/attachments.sql) */
const ATT = {
  MAX: 50 * 1024 * 1024, ACCEPT: "image/*,audio/*,video/*,application/pdf", picks: {}, signed: {},
  pickerHtml(id) {
    return `<div class="att-pick" id="${id}"><label class="btn small att-btn">Attach photo, video or file<input type="file" multiple accept="${this.ACCEPT}" hidden></label><button type="button" class="btn small att-btn att-rec">${ICON.mic}<span>Record voice note</span></button><div class="att-list"></div></div>`;
  },
  /** Record straight from the mic. Prefers mp4/AAC so it plays on iPhone. */
  async record(btn, onDone) {
    if (btn._rec) { if (btn._rec.state === "recording") btn._rec.stop(); return; }
    if (btn._starting) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("Recording isn't supported here. Record in your voice memos app and attach it instead.");
    const idle = () => { btn.classList.remove("recording"); btn.innerHTML = `${ICON.mic}<span>Record voice note</span>`; };
    btn._starting = true; btn.innerHTML = `${ICON.mic}<span>Starting mic…</span>`;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { btn._starting = false; idle(); return toast("Mic blocked. Allow it for Telegram in Settings."); }
    const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find(t => MediaRecorder.isTypeSupported(t)) || "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {}), chunks = [];
    let t0 = 0, iv = 0;
    const show = () => { const s = Math.floor((Date.now() - t0) / 1000); btn.innerHTML = `${ICON.stop}<span>Stop · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</span>`; if (s >= 600) rec.stop(); };
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstart = () => { btn._starting = false; t0 = Date.now(); btn.classList.add("recording"); show(); iv = setInterval(show, 250); };
    rec.onstop = () => {
      clearInterval(iv); stream.getTracks().forEach(t => t.stop()); btn._rec = null; btn._starting = false; idle();
      const type = (rec.mimeType || mime || "audio/webm").split(";")[0], ext = /mp4/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : "webm";
      if (!t0 || Date.now() - t0 < 800 || !chunks.length) return toast("Too short, hold on a bit longer");
      const d = new Date(), name = `Voice note ${d.getHours()}-${String(d.getMinutes()).padStart(2, "0")}.${ext}`;
      onDone(new File([new Blob(chunks, { type })], name, { type }));
    };
    btn._rec = rec; rec.start(1000);
  },
  bind(id) {
    const root = document.getElementById(id); if (!root) return;
    const files = this.picks[id] = [];
    const paint = () => { root.querySelector(".att-list").innerHTML = files.map((f, i) => `<span class="att-chip">${this.icon(f.type)} <span title="${esc(f.name)}">${esc(f.name)}</span> <small class="muted">${this.size(f.size)}</small><button type="button" data-rm="${i}" aria-label="Remove ${esc(f.name)}">✕</button></span>`).join("")
      + files.filter(f => /^audio/.test(f.type)).map(f => `<audio class="att-preview" controls preload="metadata" src="${URL.createObjectURL(f)}"></audio>`).join("");
      root.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { files.splice(+b.dataset.rm, 1); paint(); }); };
    root.querySelector("input[type=file]").onchange = (e) => {
      for (const f of e.target.files) {
        if (!/^(image|audio|video)\//.test(f.type) && f.type !== "application/pdf") { toast(`${f.name}: only images, audio, video or PDF`); continue; }
        if (f.size > this.MAX) { toast(`${f.name} is ${this.size(f.size)}. Max is 50 MB, trim or compress it first.`); continue; }
        if (files.length >= 10) { toast("Max 10 files per post"); break; }
        files.push(f);
      }
      e.target.value = ""; paint();
    };
    const recBtn = root.querySelector(".att-rec");
    if (recBtn) recBtn.onclick = () => this.record(recBtn, (f) => {
      if (files.length >= 10) return toast("Max 10 files per post");
      if (f.size > this.MAX) return toast("Voice note is over 50 MB");
      files.push(f); paint(); toast("Voice note added. Tap Post to send it.");
    });
  },
  files(id) { return this.picks[id] || []; },
  icon(t) { return /^image/.test(t) ? "🖼️" : /^audio/.test(t) ? "🎙️" : /^video/.test(t) ? "🎬" : "📄"; },
  size(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB"; },
  /** Upload picked files; returns [{path,name,type,size}] or null. onStep(i, n) lets the button show progress. */
  async upload(id, prefix, onStep) {
    const files = this.files(id); if (!files.length) return null;
    const out = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; onStep && onStep(i + 1, files.length);
      const safe = f.name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
      const path = `${prefix}/${uid()}/${safe}`;
      const { error } = await sb.storage.from("attachments").upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw new Error(`Couldn't upload ${f.name}: ${error.message}`);
      out.push({ path, name: f.name, type: f.type, size: f.size });
    }
    return out;
  },
  html(list) {
    if (!Array.isArray(list) || !list.length) return "";
    return `<div class="atts">${list.map(a => {
      const src = a.url ? `src="${esc(a.url)}"` : `data-att-path="${esc(a.path)}"`, nm = esc(a.name || "file");
      if (/^image/.test(a.type)) return `<a ${a.url ? `href="${esc(a.url)}"` : `data-att-href="${esc(a.path)}"`} target="_blank" rel="noopener"><img ${src} alt="${nm}" loading="lazy"></a>`;
      if (/^audio/.test(a.type)) return `<audio controls preload="none" ${src}></audio><div class="att-cap">🎙️ ${nm}${/ogg|opus/i.test(a.type + a.name) ? " · if it won't play on iPhone, tap to download" : ""}</div>`;
      if (/^video/.test(a.type)) return `<video controls playsinline preload="metadata" ${src}></video>`;
      return `<a class="att-file" ${a.url ? `href="${esc(a.url)}"` : `data-att-href="${esc(a.path)}"`} target="_blank" rel="noopener">📄 ${nm}</a>`;
    }).join("")}</div>`;
  },
  /** Fill in signed links for any attachment elements on the page. */
  async hydrate(root = document) {
    const els = [...root.querySelectorAll("[data-att-path],[data-att-href]")]; if (!els.length) return;
    const now = Date.now(), need = [...new Set(els.map(e => e.dataset.attPath || e.dataset.attHref))].filter(p => !(this.signed[p] && this.signed[p].exp > now));
    if (need.length) {
      const { data } = await sb.storage.from("attachments").createSignedUrls(need, 3600);
      for (const r of data || []) if (r.signedUrl) this.signed[r.path] = { url: r.signedUrl, exp: now + 50 * 60000 };
    }
    for (const e of els) {
      const p = e.dataset.attPath || e.dataset.attHref, u = this.signed[p]?.url; if (!u) continue;
      if (e.dataset.attPath) { e.src = u; delete e.dataset.attPath; } else { e.href = u; delete e.dataset.attHref; }
    }
  },
};
new MutationObserver(debounce(() => { if (document.querySelector("[data-att-path],[data-att-href]")) ATT.hydrate().catch(() => {}); }, 60)).observe(document.documentElement, { childList: true, subtree: true });

/** CoinGecko renamed some coin ids (ACN after the AITECH migration, OTK). Saved trades, plans and settings may
 *  still use the old ids, so everything read from the database is translated to the current ones. */
const COIN_ID_RENAMES = { "solidus-ai-tech": "solidus-aitech", "octokn": "octo-gaming" };
function canonIds(data) {
  if (data == null || typeof data !== "object") return typeof data === "string" && COIN_ID_RENAMES[data] ? COIN_ID_RENAMES[data] : data;
  let j = JSON.stringify(data), changed = false;
  for (const [o, n] of Object.entries(COIN_ID_RENAMES)) if (j.includes('"' + o + '"')) { j = j.split('"' + o + '"').join('"' + n + '"'); changed = true; }
  return changed ? JSON.parse(j) : data;
}

/* ===================== COINGECKO ===================== */
const CG = {
  base: "https://api.coingecko.com/api/v3",
  // id -> { price, change24, mcap, image, symbol, name, at }. Starts from the last session's prices (kept on the device), marked stale.
  cache: (() => { try { const c = JSON.parse(localStorage.getItem("cc-prices")) || {}; for (const k in c) c[k] = { ...c[k], at: 0, liveAt: 0 }; return c; } catch (e) { return {}; } })(),
  save() { try { localStorage.setItem("cc-prices", JSON.stringify(Object.fromEntries(Object.entries(this.cache).filter(([, v]) => !v.sample)))); } catch (e) {} },
  offline: false,
  async get(path, retry = 1, wait = 2500) {
    const r = await fetch(this.base + path);
    if (r.status === 429 && retry > 0) { await new Promise(res => setTimeout(res, wait)); return this.get(path, retry - 1, wait + 2500); }   // free plan rate limit: wait and try again
    if (!r.ok) throw new Error("CoinGecko " + r.status);
    return r.json();
  },
  /** Fresh spot price for one coin (cheap endpoint), used by the live price charts. */
  async live(id) {
    const d = await this.get(`/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`);
    const r = d && d[id]; if (!r || !Number.isFinite(r.usd)) throw new Error("no price");
    const c = this.cache[id] || {};
    this.cache[id] = { ...c, price: r.usd, change24: r.usd_24h_change ?? c.change24, at: Date.now(), sample: false, liveAt: Date.now(), src: "CoinGecko", cgPrice: r.usd };
    this.offline = false;
    return this.cache[id];
  },
  /** Make sure we have fresh market data for these coin ids (batched). */
  async ensure(ids, maxAgeMs = 60000) {
    const now = Date.now();
    const need = [...new Set(ids)].filter(id => id && (!this.cache[id] || now - this.cache[id].at > maxAgeMs));
    for (let i = 0; i < need.length; i += 200) {
      const batch = need.slice(i, i + 200);
      try {
        const rows = await this.get(`/coins/markets?vs_currency=usd&ids=${encodeURIComponent(batch.join(","))}&per_page=250&price_change_percentage=24h,7d`);
        for (const r of rows) {
          const prev = this.cache[r.id], fresh = prev && prev.liveAt && now - prev.liveAt < 60000;   // keep a live exchange price over CoinGecko's slower one
          this.cache[r.id] = { price: r.current_price, change24: r.price_change_percentage_24h, change7: r.price_change_percentage_7d_in_currency ?? null, mcap: r.market_cap, image: r.image, symbol: r.symbol, name: r.name, at: now, cgPrice: r.current_price,
            ...(fresh ? { price: prev.price, change24: prev.change24 ?? r.price_change_percentage_24h, liveAt: prev.liveAt, src: prev.src } : {}) };
        }
        this.offline = false; this.save();
      } catch (e) {
        this.offline = true;
        for (const id of batch) if (SAMPLE_PRICES[id] && !this.cache[id]) this.cache[id] = { ...SAMPLE_PRICES[id], at: now, sample: true };
      }
    }
  },
  async search(q, n = 12, retry = 1) {
    try {
      const d = await this.get(`/search?query=${encodeURIComponent(q)}`, retry);
      this.offline = false;
      return (d.coins || []).slice(0, n).map(c => ({ id: c.id, name: c.name, symbol: c.symbol, image: c.thumb, rank: c.market_cap_rank }));
    } catch (e) {
      this.offline = true;
      const ql = q.toLowerCase();
      return Object.entries(SAMPLE_PRICES).filter(([id, c]) => id.includes(ql) || c.name.toLowerCase().includes(ql) || c.symbol.includes(ql))
        .map(([id, c]) => ({ id, name: c.name, symbol: c.symbol, rank: c.rank }));
    }
  },
  /** Price on a given date: CoinGecko's daily price, else the nearest exchange candle (CoinGecko's free plan stops at 1 year). */
  async historical(id, date) {
    const d = new Date(date), t = d.getTime();
    if (Date.now() - t < 864e5) { await this.ensure([id], 0); return this.cache[id]?.price ?? null; }
    const p = (n) => String(n).padStart(2, "0");
    const res = await this.get(`/coins/${encodeURIComponent(id)}/history?date=${p(d.getUTCDate())}-${p(d.getUTCMonth()+1)}-${d.getUTCFullYear()}&localization=false`).catch(() => null);
    if (res?.market_data?.current_price?.usd) return res.market_data.current_price.usd;
    const s = await this.chart(id, Math.ceil((Date.now() - t) / 864e5) + 1).catch(() => null);
    return s?.length && t >= s[0][0] - 7 * 864e5 ? s.reduce((b, x) => (Math.abs(x[0] - t) < Math.abs(b[0] - t) ? x : b))[1] : null;
  },
  info(id) { return this.cache[id]; },
  /** [chain, address] pairs for a token (empty for native coins like BTC), fetched once per session. */
  contracts(id) {
    if (CONTRACTS[id]) return Promise.resolve(CONTRACTS[id]);
    const c = (this._ca ||= {});
    return c[id] ||= this.get(`/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`)
      .then(d => Object.entries(d.platforms || {}).filter(([k, a]) => k && a)).catch(() => { delete c[id]; return []; });
  },
};
// Used only if CoinGecko can't be reached. Illustrative, not live.
const SAMPLE_PRICES = {
  "bitcoin":         { name: "Bitcoin", symbol: "btc", price: 95000, change24: 1.2, rank: 1 },
  "ethereum":        { name: "Ethereum", symbol: "eth", price: 3200, change24: -0.8, rank: 2 },
  "solana":          { name: "Solana", symbol: "sol", price: 180, change24: 2.4, rank: 5 },
  "paal-ai":         { name: "PAAL AI", symbol: "paal", price: 0.08, change24: -3.1, rank: 700 },
  "velo":            { name: "Velo", symbol: "velo", price: 0.012, change24: 4.6, rank: 600 },
  "octo-gaming":          { name: "Octo Gaming", symbol: "otk", price: 0.004, change24: -1.9, rank: 1500 },
  "tectum":          { name: "Tectum", symbol: "tet", price: 1.2, change24: -17.5, change7: -21.0, rank: 1800 },
  "solidus-aitech": { name: "AITECH Cloud Network", symbol: "acn", price: 0.03, change24: 6.2, change7: 11.4, rank: 650 },
  "tether":          { name: "Tether", symbol: "usdt", price: 1, change24: 0, change7: 0, rank: 3 },
  "usd-coin":        { name: "USDC", symbol: "usdc", price: 1, change24: 0, change7: 0, rank: 7 },
};

// The group's coins: fixed here so the CA button never depends on CoinGecko. Other coins come from CoinGecko.
const CONTRACTS = {
  "tectum": [["ethereum", "0x68a47fe1cf42eba4a030a10cd4d6a1031ca3ca0a"]],
  "solidus-aitech": [["ethereum", "0x3e76dd57e649a263a532cc9bcc58b32a065fb2a4"]],
  "paal-ai": [["ethereum", "0x14fee680690900ba0cccfc76ad70fd1b95d10e16"]],
  "velo": [["binance-smart-chain", "0xf486ad071f3bee968384d2e39e2d8af0fcf6fd46"], ["stellar", "VELO-GDM4RQUQQUVSKQA7S6EM7XBZP3FCGH4Q7CL6TABQ7B2BEJ5ERARM2M5M"]],
  "octo-gaming": [["solana", "octo82drBEdm8CSDaEKBymVn86TBtgmPnDdmE64PTqJ"]],
};

/* ===================== PORTFOLIO MATH (average cost) ===================== */
/** Apply one trade to a position {qty, cost}; returns the realized P&L. */
function applyTx(h, t) {
  const q = num(t.quantity), p = num(t.price_usd), fee = num(t.fee_usd);
  if (t.side === "buy") { h.qty += q; h.cost += q * p + fee; return 0; }
  const sq = Math.min(q, h.qty), avg = h.qty > 0 ? h.cost / h.qty : 0;
  h.cost -= sq * avg; h.qty -= sq;
  if (h.qty < 1e-12) { h.qty = 0; h.cost = 0; }
  return sq * p - fee - sq * avg;
}
function computePortfolio(txs) {
  const byCoin = {};
  const sorted = [...txs].sort((a, b) => new Date(a.executed_at) - new Date(b.executed_at));
  let realizedTotal = 0;
  for (const t of sorted) {
    const h = byCoin[t.coin_id] ||= { coin_id: t.coin_id, symbol: t.symbol, name: t.name, qty: 0, cost: 0, realized: 0, firstBuy: null, lastTx: null, lastPrice: 0, trades: 0 };
    h.trades++; h.lastTx = t.executed_at; h.lastPrice = num(t.price_usd);
    if (t.symbol) h.symbol = t.symbol; if (t.name) h.name = t.name;
    if (t.side === "buy" && !h.firstBuy) h.firstBuy = t.executed_at;
    const r = applyTx(h, t); h.realized += r; realizedTotal += r;
  }
  let value = 0, cost = 0, chg = 0, estimated = false;
  const holdings = [];
  for (const h of Object.values(byCoin)) {
    if (h.qty <= 0) continue;
    const info = CG.info(h.coin_id);
    const price = info?.price ?? h.lastPrice;
    if (!info) estimated = true;
    const v = h.qty * price;
    const c24 = info?.change24 ?? 0;
    holdings.push({ ...h, image: info?.image, price, value: v, avg: h.cost / h.qty, pnl: v - h.cost, pnlPct: h.cost > 0 ? (v - h.cost) / h.cost * 100 : 0, change24: c24, priceEstimated: !info });
    value += v; cost += h.cost; chg += v - v / (1 + c24 / 100);
  }
  holdings.sort((a, b) => b.value - a.value);
  for (const h of holdings) h.alloc = value > 0 ? h.value / value * 100 : 0;
  return { holdings, totals: { value, cost, pnl: value - cost, pnlPct: cost > 0 ? (value - cost) / cost * 100 : 0, realized: realizedTotal, change24Usd: chg, change24Pct: value - chg > 0 ? chg / (value - chg) * 100 : 0 }, estimated, coinIds: Object.keys(byCoin) };
}

/* ===================== DATA LAYER ===================== */
const RECOVERY_LINK = /type=recovery/.test(location.hash);   // read before Supabase clears the link
const sb = window.supabase?.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);   // missing if the CDN failed; boot() reports it
const api = (() => {
  const ok = ({ data, error }) => { if (error) throw error; return canonIds(data); };
  async function fetchAll(build) {
    const size = 1000; let from = 0, out = [];
    for (;;) { const data = ok(await build().range(from, from + size - 1)); out = out.concat(data); if (data.length < size) break; from += size; }
    return out;
  }
  return {
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
    // Sign in with Telegram: true once the bot approved this nonce (tg-login returns a one-time token), null while waiting.
    async tgLogin(nonce) { const { data } = await sb.functions.invoke("tg-login", { body: { nonce } }); if (data?.error) throw new Error("Telegram sign-in didn't work. Try again or use email."); if (!data?.token_hash) return null; ok(await sb.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" })); return true; },
    async signUp(email, password, meta) { const d = ok(await sb.auth.signUp({ email, password, options: { data: meta } })); return !!d.session; },
    async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
    async updatePassword(pw) { ok(await sb.auth.updateUser({ password: pw })); },
    async signOut() { await sb.auth.signOut(); },
    async me() { const s = await this.session(); return ok(await sb.from("profiles").select("*").eq("id", s.user.id).single()); },
    async transactions(userId) { return fetchAll(() => sb.from("transactions").select("*").eq("user_id", userId).order("executed_at")); },
    async addTx(tx) { return ok(await sb.from("transactions").insert(tx).select().single()); },
    async updateTx(id, tx) { return ok(await sb.from("transactions").update(tx).eq("id", id).select().single()); },
    async deleteTx(id) { ok(await sb.from("transactions").delete().eq("id", id)); },
    async addTxs(rows) { return ok(await sb.from("transactions").insert(rows).select()); },
    async flows(userId) { return fetchAll(() => sb.from("cash_flows").select("*").eq("user_id", userId).order("at")); },
    async addFlow(f) { return ok(await sb.from("cash_flows").insert(f).select().single()); },
    async deleteFlow(id) { ok(await sb.from("cash_flows").delete().eq("id", id)); },
    async parseScreenshots(images) {
      const { data, error } = await sb.functions.invoke("import-screenshot", { body: { images } });
      if (error) {
        let msg = "";
        try { msg = (await error.context.json()).error; } catch (e) {}
        throw new Error(msg || (error.name === "FunctionsFetchError" ? "Screenshot import isn't set up yet. Ask the admin." : "Couldn't read the screenshot. Try again."));
      }
      return data;
    },
    async updateProfile(id, patch) { return ok(await sb.from("profiles").update(patch).eq("id", id).select().single()); },
    async messages(memberId) { return fetchAll(() => sb.from("messages").select("*").eq("member_id", memberId).order("created_at")); },
    async notes(memberId) { return ok(await sb.from("member_notes").select("*").eq("member_id", memberId).order("created_at", { ascending: false })); },
    async addNote(n) { const s = await this.session(); return ok(await sb.from("member_notes").insert({ ...n, author_id: s.user.id }).select().single()); },
    async deleteNote(id) { ok(await sb.from("member_notes").delete().eq("id", id)); },
    // Any send from staff can answer a waiting member, so recount the Inbox bell (inboxData is in signals.js).
    async addMessage(m) { const r = ok(await sb.from("messages").insert(m).select().single()); if (canPostSignals()) inboxData().catch(() => {}); return r; },
    async addMessages(rows) { const r = ok(await sb.from("messages").insert(rows).select("id,member_id,author_id,created_at,kind")); if (canPostSignals()) inboxData().catch(() => {}); return r; },
    async deleteMessage(id) { ok(await sb.from("messages").delete().eq("id", id)); },
    async allProfiles() { return fetchAll(() => sb.from("profiles").select("*").order("created_at")); },
    async allTransactions() { return fetchAll(() => sb.from("transactions").select("id,user_id,coin_id,symbol,name,side,quantity,price_usd,fee_usd,executed_at").order("executed_at")); },
    // Inbox: RLS returns every member to admins and only Signals-only members to Signals Admins.
    async inboxPeople() { return (ok(await sb.from("profiles").select("id,display_name,telegram_handle,tier,role,signals_admin").eq("role", "member").eq("signals_admin", false)) || []); },
    async inboxMeta() { return fetchAll(() => sb.from("messages").select("member_id,author_id,created_at,body").order("created_at")); },
    async allMessageMeta() { return fetchAll(() => sb.from("messages").select("member_id,author_id,created_at,kind").order("created_at")); },
    async addTicket(t) { return ok(await sb.from("tickets").insert(t).select().single()); },
    async tickets() { return ok(await sb.from("tickets").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(50)); },
    async closeTicket(id) { ok(await sb.from("tickets").update({ status: "done" }).eq("id", id)); },
    async getSetting(key) { return ok(await sb.from("app_settings").select("value,updated_at").eq("key", key).maybeSingle()); },
    async setSetting(key, value) { return ok(await sb.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() }).select().single()); },
    async updates() { return ok(await sb.from("updates").select("*").order("created_at", { ascending: false }).limit(60)); },
    async addUpdate(u) { return ok(await sb.from("updates").insert(u).select().single()); },
    async deleteUpdate(id) { ok(await sb.from("updates").delete().eq("id", id)); },
    async signals() { return ok(await sb.from("signals").select("*, signal_targets(*), signal_updates(*)").order("created_at", { ascending: false }).limit(200)); },
    async postSignal(sig, tps) { return ok(await sb.rpc("post_signal", { sig, tps })); },
    async editSignal(sid, sig, tps, body) { ok(await sb.rpc("edit_signal", { sid, sig, tps, body })); },
    async addSignalUpdate(u) { ok(await sb.from("signal_updates").insert(u)); },
    async splitRules() { return ok(await sb.from("split_rules").select("*")); },
    async groupHoldings() { return ok(await sb.rpc("group_holdings")) || []; },
    async removeMember(id) {
      const { error } = await sb.rpc("admin_remove_member", { target: id });
      if (error) throw new Error(/admin_remove_member|schema cache|does not exist/i.test(error.message) ? "Removing members isn't set up yet. Run supabase/admin_remove_member.sql in the Supabase SQL Editor once." : error.message);
    },
    onAuthChange(cb) { sb.auth.onAuthStateChange(cb); },
  };
})();

/* ===================== STATE ===================== */
const S = {
  me: null, email: null,
  txs: [], msgs: [], flows: [],
  admin: { profiles: [], txs: [], meta: [], loadedAt: 0 },
  tradeFilter: null,
  proj: null,
  model: null, modelUpdatedAt: null, updates: [], reb: null, sigs: [], splitRules: {}, sigTab: null,
  memberFilter: "all", memberSort: "review", memberQuery: "",
  charts: {},
};
const isAdmin = () => S.me?.role === "admin";
const canPostSignals = () => isAdmin() || !!S.me?.signals_admin;
const signalsOnly = () => S.me?.tier === "signals" && !canPostSignals();   // Signals tab + Elite upsell, no Elite screens, no CC group gate
const seesSignals = () => canPostSignals() || ["signals", "both"].includes(S.me?.tier);

