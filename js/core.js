/* =====================================================================
   CONFIG: fill these in after creating your Supabase project.
   Leave SUPABASE_URL empty to run in DEMO mode (sample data, no logins).
   ===================================================================== */
const CONFIG = {
  SUPABASE_URL: "https://euoozfbbihtxrmafupeg.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_RK-nD_oFF3KHWQM2leIsrw_OW2kASrj",   // publishable key (safe in browser; RLS protects data)
  COINGECKO_DEMO_KEY: "",    // optional free key from coingecko.com/en/api (raises rate limits)
  REVIEWER_NAME: "Dkay",
  GROUP_NAME: "CC",
};
const DEMO = !CONFIG.SUPABASE_URL;

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
function fmtJoined(d) { if (!d) return ""; const t = new Date(d + "T12:00:00"); if (isNaN(t)) return ""; const m = Math.floor((Date.now() - t) / (30.44 * 86400000)); return t.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) + (m >= 1 ? ` (${m >= 12 ? Math.floor(m / 12) + "y " + (m % 12 ? (m % 12) + "mo" : "") : m + "mo"} in CC)`.replace(" )", ")") : ""); }
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
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

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
function memberName(p) { return p?.display_name || (p?.telegram_handle ? "@" + p.telegram_handle.replace(/^@/, "") : "Member"); }
function handleLink(h) { if (!h) return ""; const clean = esc(h.replace(/^@/, "")); return `<a href="https://t.me/${clean}" target="_blank" rel="noopener">@${clean}</a>`; }
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
};
function coinIcon(c) {
  const ab = esc((c.symbol || "?").slice(0, 3).toUpperCase());
  return c.image ? `<img src="${esc(c.image)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'${ab}'}))">` : `<span class="ph">${ab}</span>`;
}
/** Coins are shown by ticker (TET, ACN, PAAL…). showName adds the full name underneath, only where it helps tell coins apart (search results). */
function coinCell(c, showName = false) {
  const img = c.image ? `<img src="${esc(c.image)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'${esc((c.symbol||'?').slice(0,3).toUpperCase())}'}))">` : `<span class="ph">${esc((c.symbol || "?").slice(0, 3).toUpperCase())}</span>`;
  const sym = String(c.symbol || "").toUpperCase(), name = c.name || c.coin_id || "";
  const main = sym || name, sub = showName && sym && name && name.toUpperCase() !== sym ? name : "";
  return `<div class="coin">${img}<div><div style="font-weight:600">${esc(main)}</div>${sub ? `<div class="sym" style="text-transform:none">${esc(sub)}</div>` : ""}</div></div>`;
}

/** "Tectum (TET)", but just "PAAL AI" / "Velo" when the name already says the ticker. */
/** Ticker only: "TET", "PAAL". Falls back to the name when there's no ticker; "Tectum (TET)" → "TET". */
function nameSym(name, sym) {
  sym = String(sym || "").trim().toUpperCase(); if (sym) return sym;
  name = String(name || "").trim(); const m = name.match(/\(([^)]+)\)\s*$/); return m ? m[1].toUpperCase() : name;
}
function coinLabel(id) { return symOf(id); }

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
    catch (e) { btn._starting = false; idle(); return toast("Microphone blocked. Allow mic access for Telegram in Settings, then try again."); }
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
      if (api.demo || !sb) { out.push({ path, name: f.name, type: f.type, size: f.size, url: URL.createObjectURL(f) }); continue; }
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
    const els = [...root.querySelectorAll("[data-att-path],[data-att-href]")]; if (!els.length || !sb) return;
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
  cache: {},          // id -> { price, change24, mcap, image, symbol, name, at }
  offline: false,
  headers() { return CONFIG.COINGECKO_DEMO_KEY ? { "x-cg-demo-api-key": CONFIG.COINGECKO_DEMO_KEY } : {}; },
  async get(path, retry = 1) {
    const r = await fetch(this.base + path, { headers: this.headers() });
    if (r.status === 429 && retry > 0) { await new Promise(res => setTimeout(res, 2500)); return this.get(path, retry - 1); }   // free plan rate limit: wait and try once more
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
        this.offline = false;
      } catch (e) {
        this.offline = true;
        const ps = document.getElementById("price-src"); if (ps) ps.textContent = " and sample prices (CoinGecko unreachable here)";
        for (const id of batch) if (SAMPLE_PRICES[id] && !this.cache[id]) this.cache[id] = { ...SAMPLE_PRICES[id], at: now, sample: true };
      }
    }
  },
  async search(q) {
    try {
      const d = await this.get(`/search?query=${encodeURIComponent(q)}`);
      this.offline = false;
      return (d.coins || []).slice(0, 12).map(c => ({ id: c.id, name: c.name, symbol: c.symbol, image: c.thumb, rank: c.market_cap_rank }));
    } catch (e) {
      this.offline = true;
      const ql = q.toLowerCase();
      return Object.entries(SAMPLE_PRICES).filter(([id, c]) => id.includes(ql) || c.name.toLowerCase().includes(ql) || c.symbol.includes(ql))
        .map(([id, c]) => ({ id, name: c.name, symbol: c.symbol, rank: c.rank }));
    }
  },
  /** Daily price (00:00 UTC) on a given date. */
  async historical(id, date) {
    const d = new Date(date);
    if (Date.now() - d.getTime() < 24 * 3600 * 1000) { await this.ensure([id], 0); return this.cache[id]?.price ?? null; }
    const p = (n) => String(n).padStart(2, "0");
    const res = await this.get(`/coins/${encodeURIComponent(id)}/history?date=${p(d.getUTCDate())}-${p(d.getUTCMonth()+1)}-${d.getUTCFullYear()}&localization=false`);
    return res?.market_data?.current_price?.usd ?? null;
  },
  info(id) { return this.cache[id]; },
};
// Used only if CoinGecko can't be reached (demo / offline). Illustrative, not live.
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

/* ===================== PORTFOLIO MATH (average cost) ===================== */
function computePortfolio(txs) {
  const byCoin = {};
  const sorted = [...txs].sort((a, b) => new Date(a.executed_at) - new Date(b.executed_at));
  let realizedTotal = 0;
  for (const t of sorted) {
    const h = byCoin[t.coin_id] ||= { coin_id: t.coin_id, symbol: t.symbol, name: t.name, qty: 0, cost: 0, realized: 0, firstBuy: null, lastTx: null, lastPrice: 0, trades: 0 };
    const q = num(t.quantity), p = num(t.price_usd), fee = num(t.fee_usd);
    h.trades++; h.lastTx = t.executed_at; h.lastPrice = p;
    if (t.symbol) h.symbol = t.symbol; if (t.name) h.name = t.name;
    if (t.side === "buy") {
      h.qty += q; h.cost += q * p + fee;
      if (!h.firstBuy) h.firstBuy = t.executed_at;
    } else {
      const sellQ = Math.min(q, h.qty);
      const avg = h.qty > 0 ? h.cost / h.qty : 0;
      const r = sellQ * p - fee - sellQ * avg;
      h.realized += r; realizedTotal += r;
      h.cost -= sellQ * avg; h.qty -= sellQ;
      if (h.qty < 1e-12) { h.qty = 0; h.cost = 0; }
    }
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
let sb = null;
const api = DEMO ? makeDemoApi() : makeSupabaseApi();

function makeSupabaseApi() {
  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  const ok = ({ data, error }) => { if (error) throw error; return canonIds(data); };
  async function fetchAll(build) {
    const size = 1000; let from = 0, out = [];
    for (;;) { const data = ok(await build().range(from, from + size - 1)); out = out.concat(data); if (data.length < size) break; from += size; }
    return out;
  }
  return {
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password, meta) { const d = ok(await sb.auth.signUp({ email, password, options: { data: meta } })); return !!d.session; },
    async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
    async updatePassword(pw) { ok(await sb.auth.updateUser({ password: pw })); },
    async signOut() { await sb.auth.signOut(); },
    async me() { const s = await this.session(); return ok(await sb.from("profiles").select("*").eq("id", s.user.id).single()); },
    async email() { const s = await this.session(); return s?.user?.email; },
    async transactions(userId) { return fetchAll(() => sb.from("transactions").select("*").eq("user_id", userId).order("executed_at")); },
    async addTx(tx) { return ok(await sb.from("transactions").insert(tx).select().single()); },
    async updateTx(id, tx) { return ok(await sb.from("transactions").update(tx).eq("id", id).select().single()); },
    async deleteTx(id) { ok(await sb.from("transactions").delete().eq("id", id)); },
    async addTxs(rows) { return ok(await sb.from("transactions").insert(rows).select()); },
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
    async addMessage(m) { return ok(await sb.from("messages").insert(m).select().single()); },
    async addMessages(rows) { return ok(await sb.from("messages").insert(rows).select("id,member_id,author_id,created_at,kind")); },
    async deleteMessage(id) { ok(await sb.from("messages").delete().eq("id", id)); },
    async allProfiles() { return fetchAll(() => sb.from("profiles").select("*").order("created_at")); },
    async allTransactions() { return fetchAll(() => sb.from("transactions").select("id,user_id,coin_id,symbol,name,side,quantity,price_usd,fee_usd,executed_at").order("executed_at")); },
    async allMessageMeta() { return fetchAll(() => sb.from("messages").select("member_id,author_id,created_at,kind").order("created_at")); },
    async getSetting(key) { return ok(await sb.from("app_settings").select("value,updated_at").eq("key", key).maybeSingle()); },
    async setSetting(key, value) { return ok(await sb.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() }).select().single()); },
    async updates() { return ok(await sb.from("updates").select("*").order("created_at", { ascending: false }).limit(60)); },
    async addUpdate(u) { return ok(await sb.from("updates").insert(u).select().single()); },
    async deleteUpdate(id) { ok(await sb.from("updates").delete().eq("id", id)); },
    async groupHoldings() { return ok(await sb.rpc("group_holdings")) || []; },
    async removeMember(id) {
      const { error } = await sb.rpc("admin_remove_member", { target: id });
      if (error) throw new Error(/admin_remove_member|schema cache|does not exist/i.test(error.message) ? "Removing members isn't set up yet. Run supabase/admin_remove_member.sql in the Supabase SQL Editor once." : error.message);
    },
    onAuthChange(cb) { sb.auth.onAuthStateChange((ev, s) => cb(ev, s)); },
  };
}

function makeDemoApi() {
  const now = Date.now(), d = (days, h = 12) => new Date(now - days * 86400000 + (h - 12) * 3600000).toISOString();
  const P = (id, name, tg, role, risk, goal, extra = {}) => ({ id, display_name: name, telegram_handle: tg, role, risk_level: risk, goal, review_requested: false, review_question: null, review_requested_at: null, last_reviewed_at: null, feedback_seen_at: null, created_at: d(90), ...extra });
  const store = {
    profiles: [
      P("dkay", "Dkay", "dkay", "admin", "high", "Run the group"),
      P("u1", "Alex", "alexcc", "member", "high", "Grow $5k to $25k by end of 2027", { review_requested: true, review_question: "Am I too heavy in PAAL? Thinking about adding more VELO before Q4.", review_requested_at: d(1, 9) }),
      P("u2", "Mo", "mo_trades", "member", "degen", "Short-term flips", { last_reviewed_at: d(40) }),
      P("u3", "Sara", "sara.k", "member", "medium", "Long-term hold, 3+ years", { last_reviewed_at: d(6) }),
      P("u4", "Jules", "jules", "member", "low", "Learning, small bags"),
    ],
    transactions: [],
    messages: [],
    settings: {},
    updates: [
      { id: "w1", kind: "weekly", author_id: "dkay", title: "Weekly update", body: "Quiet week overall. TET is getting hit hard, so watch the bid zone. ACN holding up well after the migration.\n\nPlan: stick to the model, keep some dry powder, don't chase green candles.", created_at: d(2, 18) },
      { id: "x1", kind: "urgent", author_id: "dkay", coin_id: "tectum", title: "TET flushed into support, start bidding", body: "Scale in, don't go all in at once.", buy_low: 1.05, buy_high: 1.25, created_at: d(0, 9), expires_at: new Date(now + 2 * 86400000).toISOString() },
    ],
  };
  const tx = (user_id, coin_id, side, quantity, price_usd, executed_at, fee_usd = 0, exchange = "MEXC") => {
    const c = SAMPLE_PRICES[coin_id];
    store.transactions.push({ id: uid(), user_id, coin_id, symbol: c.symbol, name: c.name, side, quantity, price_usd, fee_usd, executed_at, exchange, note: null });
  };
  tx("u1", "bitcoin", "buy", 0.02, 88000, d(60, 10), 2, "Coinbase");
  tx("u1", "ethereum", "buy", 0.5, 3400, d(45, 15), 1.5, "Coinbase");
  tx("u1", "paal-ai", "buy", 15000, 0.11, d(30, 21));
  tx("u1", "paal-ai", "buy", 10000, 0.07, d(12, 8));
  tx("u1", "velo", "buy", 40000, 0.009, d(9, 19));
  tx("u2", "octo-gaming", "buy", 800000, 0.003, d(25, 2));
  tx("u2", "octo-gaming", "sell", 200000, 0.005, d(10, 14));
  tx("u2", "solana", "buy", 3, 165, d(7, 11), 0.5, "Binance");
  tx("u2", "velo", "buy", 25000, 0.013, d(3, 22));
  tx("u3", "bitcoin", "buy", 0.05, 72000, d(80, 9), 5, "Kraken");
  tx("u3", "ethereum", "buy", 1.2, 2900, d(70, 9), 3, "Kraken");
  tx("u3", "solana", "buy", 10, 150, d(50, 16), 1, "Kraken");
  tx("u3", "solidus-aitech", "buy", 20000, 0.025, d(20, 20));
  tx("u3", "tectum", "buy", 300, 1.5, d(15, 13));
  tx("u3", "ethereum", "sell", 0.2, 3500, d(5, 10), 1, "Kraken");
  tx("u4", "bitcoin", "buy", 0.003, 93000, d(4, 18), 1, "Coinbase");
  tx("u4", "paal-ai", "buy", 2000, 0.085, d(2, 20));
  tx("u3", "tether", "buy", 1500, 1, d(10, 12), 0, "Kraken");
  tx("u1", "tectum", "buy", 400, 1.4, d(20, 12));
  tx("dkay", "bitcoin", "buy", 0.4, 60000, d(85, 8), 10, "Binance");
  tx("dkay", "velo", "buy", 300000, 0.006, d(40, 23));
  tx("dkay", "solidus-aitech", "buy", 150000, 0.02, d(33, 12));
  const msg = (member_id, author_id, kind, body, created_at, coin_id = null) => store.messages.push({ id: uid(), member_id, author_id, kind, body, created_at, coin_id });
  msg("u3", "dkay", "suggestion", "Nice spread. Your ETH entries were clean. Keep adding to ACN on dips once the migration dust settles.", d(6, 17), "solidus-aitech");
  msg("u3", "u3", "reply", "Got it, thanks! Holding.", d(6, 18));
  msg("u2", "dkay", "suggestion", "OTK is ~70% of your bag. Consider taking another chunk off into SOL or stables, you're one bad week from a big drawdown.", d(40, 12), "octo-gaming");
  msg("u1", "u1", "question", "Am I too heavy in PAAL? Thinking about adding more VELO before Q4.", d(1, 9));

  let currentId = "u1";
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pause = () => new Promise(r => setTimeout(r, 60));
  return {
    demo: true,
    setUser(id) { currentId = id; },
    currentId: () => currentId,
    async session() { return { user: { id: currentId } }; },
    async signIn() {}, async signUp() { return true; }, async signOut() {}, async resetPassword() {}, async updatePassword() {},
    async me() { return clone(store.profiles.find(p => p.id === currentId)); },
    async email() { return currentId + "@demo.cc"; },
    async transactions(userId) { await pause(); return clone(store.transactions.filter(t => t.user_id === userId)); },
    async addTx(t) { const row = { ...t, id: uid(), user_id: currentId }; store.transactions.push(row); return clone(row); },
    async updateTx(id, t) { const i = store.transactions.findIndex(x => x.id === id); store.transactions[i] = { ...store.transactions[i], ...t }; return clone(store.transactions[i]); },
    async deleteTx(id) { store.transactions = store.transactions.filter(x => x.id !== id); },
    async addTxs(rows) { return rows.map(t => { const row = { ...t, id: uid(), user_id: currentId }; store.transactions.push(row); return clone(row); }); },
    async parseScreenshots(imgs, hint) { await pause(); await new Promise(r => setTimeout(r, 1200));
      if (hint === "trades") return { source_app: "CoinGecko", currency: "USD", warnings: [], holdings: [], trades: [
        { name: "Tectum", symbol: "TET", side: "buy", quantity: 518.992, total_usd: 155.357, price_usd: 155.357 / 518.992, date: "2026-10-26", coingecko_id_guess: "tectum" },
        { name: "Tectum", symbol: "TET", side: "buy", quantity: 428.76, total_usd: 127.373, price_usd: 127.373 / 428.76, date: "2026-10-11", coingecko_id_guess: "tectum" },
        { name: "Tectum", symbol: "TET", side: "buy", quantity: 500, total_usd: 132.536, price_usd: 132.536 / 500, date: "2026-10-07", coingecko_id_guess: "tectum" },
        { name: "Tectum", symbol: "TET", side: "buy", quantity: 601.8, total_usd: null, price_usd: null, paid: { amount: 0.05, currency: "ETH" }, date: "2026-04-01", coingecko_id_guess: "tectum" } ] };
      return { source_app: "CoinGecko", currency: "USD", warnings: ["Demo mode: these are sample results, not your screenshot."],
      holdings: [ { name: "Paal AI", symbol: "PAAL", quantity: 5200, avg_buy_price: 0.21, current_price: null, value: null, coingecko_id_guess: "paal-ai" },
                  { name: "Ethereum", symbol: "ETH", quantity: 0.8, avg_buy_price: 2850, current_price: null, value: null, coingecko_id_guess: "ethereum" },
                  { name: "Velo", symbol: "VELO", quantity: 42000, avg_buy_price: null, current_price: null, value: null, coingecko_id_guess: null } ] }; },
    async updateProfile(id, patch) { const p = store.profiles.find(x => x.id === id); Object.assign(p, patch); return clone(p); },
    async messages(memberId) { return clone(store.messages.filter(m => m.member_id === memberId).sort((a, b) => a.created_at.localeCompare(b.created_at))); },
    async notes(memberId) { return clone((store.notes ||= []).filter(n => n.member_id === memberId).sort((a, b) => b.created_at.localeCompare(a.created_at))); },
    async addNote(n) { const row = { id: uid(), author_id: currentId, created_at: new Date().toISOString(), ...n }; (store.notes ||= []).push(row); return clone(row); },
    async deleteNote(id) { store.notes = (store.notes || []).filter(n => n.id !== id); },
    async addMessage(m) { const row = { id: uid(), author_id: currentId, created_at: new Date().toISOString(), coin_id: null, ...m }; store.messages.push(row); return clone(row); },
    async addMessages(rows) { return rows.map(m => { const row = { id: uid(), author_id: currentId, created_at: new Date().toISOString(), coin_id: null, ...m }; store.messages.push(row); return clone(row); }); },
    async deleteMessage(id) { store.messages = store.messages.filter(m => m.id !== id); },
    async allProfiles() { await pause(); return clone(store.profiles); },
    async removeMember(id) { store.profiles = store.profiles.filter(p => p.id !== id); store.transactions = store.transactions.filter(t => t.user_id !== id); store.messages = store.messages.filter(m => m.member_id !== id && m.author_id !== id); store.notes = (store.notes || []).filter(n => n.member_id !== id); },
    async allTransactions() { return clone(store.transactions); },
    async allMessageMeta() { return clone(store.messages.map(({ member_id, author_id, created_at, kind }) => ({ member_id, author_id, created_at, kind }))); },
    async getSetting(key) { return store.settings[key] ? clone(store.settings[key]) : null; },
    async setSetting(key, value) { store.settings[key] = { value: clone(value), updated_at: new Date().toISOString() }; return clone(store.settings[key]); },
    async updates() { return clone([...store.updates].sort((a, b) => b.created_at.localeCompare(a.created_at))); },
    async addUpdate(u) { const row = { id: uid(), author_id: currentId, created_at: new Date().toISOString(), coin_id: null, body: null, buy_low: null, buy_high: null, expires_at: null, ...u }; store.updates.push(row); return clone(row); },
    async deleteUpdate(id) { store.updates = store.updates.filter(u => u.id !== id); },
    async groupHoldings() {
      const admins = new Set(store.profiles.filter(p => p.role === "admin").map(p => p.id)), q = {};
      for (const t of store.transactions) { if (admins.has(t.user_id)) continue; const k = t.user_id + "|" + t.coin_id; q[k] = (q[k] || 0) + (t.side === "buy" ? 1 : -1) * num(t.quantity); }
      const by = {}, users = new Set();
      for (const [k, v] of Object.entries(q)) if (v > 0) { const [u, c] = k.split("|"); users.add(u); (by[c] ||= { coin_id: c, qty: 0, holders: 0 }); by[c].qty += v; by[c].holders++; }
      return Object.values(by).map(r => ({ ...r, members: users.size }));
    },
    onAuthChange() {},
  };
}

/* ===================== STATE ===================== */
const S = {
  me: null, email: null,
  txs: [], msgs: [],
  admin: { profiles: [], txs: [], meta: [], loadedAt: 0 },
  tradeFilter: null,
  proj: null,
  model: null, modelUpdatedAt: null, updates: [], reb: null,
  memberFilter: "all", memberSort: "review", memberQuery: "",
  charts: {},
};
const isAdmin = () => S.me?.role === "admin";

