/* ===================== AUTH ===================== */
function renderAuth(mode = "signin", msg = "") {
  document.querySelector(".install:not(.pre-signin)")?.remove();
  // Outside Telegram (browser / home-screen app), members sign in through the bot instead of typing a password.
  const tgBtn = mode === "signin" && !TG, pend = tgPending();
  const nonce = pend?.n || Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  $("#app").innerHTML = `<div class="auth-wrap"><div class="auth">
    <div class="brand"><span class="logo" role="img" aria-label="${esc(CONFIG.GROUP_NAME)}"></span>Portfolio Desk</div>
    <div class="card">
      ${mode === "recover" ? `
        <h2>Set a new password</h2>
        <label class="field"><span>New password</span><input type="password" enterkeyhint="go" id="a-pw" minlength="8" autocomplete="new-password"></label>
        <label class="showpw"><input type="checkbox" data-showpw="a-pw"> Show password</label>
        <div class="err" id="a-err">${esc(msg)}</div>
        <button class="btn primary" id="a-go" style="width:100%">Save password</button>` : `
      <div class="seg" style="width:100%;margin-bottom:16px"><button style="flex:1" class="${mode === "signin" ? "on" : ""}" data-m="signin">Sign in</button><button style="flex:1" class="${mode === "signup" ? "on" : ""}" data-m="signup">Create account</button></div>
      ${mode === "signup" ? `
        <label class="field"><span>Display name</span><input type="text" id="a-name" maxlength="60" autocomplete="nickname"></label>
        <label class="field"><span>Telegram handle</span><input type="text" id="a-tg" maxlength="40" autocapitalize="off" spellcheck="false" placeholder="@yourhandle"></label>` : ""}
      ${tgBtn ? `<a class="btn primary tg-go" id="a-tg-go" href="https://t.me/${CONFIG.BOT}?start=login_${nonce}" target="_blank" rel="noopener">${pend ? "Waiting for Telegram…" : "Sign in with Telegram"}</a><div class="secondary tg-hint${pend ? "" : " hidden"}">In Telegram, tap <b>Start</b>, then <b>Approve</b>, then come back here.</div><div class="or">or use email</div>` : ""}
      <label class="field"><span>Email</span><input type="email" id="a-email" autocomplete="email" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>Password</span><input type="password" enterkeyhint="go" id="a-pw" minlength="8" autocomplete="${mode === "signup" ? "new-password" : "current-password"}"></label>
      <label class="showpw"><input type="checkbox" data-showpw="a-pw"> Show password</label>
      <div class="err" id="a-err">${esc(msg)}</div>
      <button class="btn${tgBtn ? "" : " primary"}" id="a-go" style="width:100%">${mode === "signup" ? "Create account" : "Sign in"}</button>
      ${mode === "signin" ? `<div style="text-align:center;margin-top:12px"><button class="link-btn" id="a-forgot">Forgot password?</button></div>` : ""}`}
    </div>
  </div></div>`;
  document.querySelectorAll("[data-m]").forEach(b => b.onclick = () => renderAuth(b.dataset.m));
  installBanner();   // shows here only for members sent from the Telegram Desk (?install=1)
  const err = (m) => $("#a-err").textContent = m;
  $("#a-go").onclick = async () => {
    const pw = $("#a-pw").value;
    try {
      if (mode === "recover") { if (pw.length < 8) return err("Password needs 8+ characters."); await api.updatePassword(pw); recovering = false; recFlag(false); toast("Password updated"); return boot(); }
      const email = $("#a-email").value.trim();
      if (!email || !pw) return err("Enter email and password.");
      if (mode === "signup") {
        if (pw.length < 8) return err("Password needs 8+ characters.");
        const name = $("#a-name").value.trim(), tg = $("#a-tg").value.trim().replace(/^@/, "");
        if (!name) return err("Add a display name so " + CONFIG.REVIEWER_NAME + " knows who you are.");
        const hasSession = await api.signUp(email, pw, { display_name: name, telegram_handle: tg || null });
        if (!hasSession) return renderAuth("signin", "Account created. Check your email to confirm, then sign in.");
      } else {
        await api.signIn(email, pw);
      }
      boot();
    } catch (e) { err(e.message || "Couldn't reach the Desk. Check your connection and try again."); }
  };
  $("#a-forgot") && ($("#a-forgot").onclick = async () => {
    const email = $("#a-email").value.trim(); if (!email) return err("Type your email above first.");
    try { await api.resetPassword(email); err("If that email has an account, a reset link is on its way."); } catch (e) { err(e.message); }
  });
  $("#a-pw").addEventListener("keydown", e => { if (e.key === "Enter") $("#a-go").click(); });
  $("#a-tg-go") && ($("#a-tg-go").onclick = (e) => { try { localStorage.setItem("cc-tg-login", JSON.stringify({ n: nonce, t: Date.now() })); } catch (x) {} e.currentTarget.textContent = "Waiting for Telegram…"; $(".tg-hint").classList.remove("hidden"); setTimeout(tgLoginPoll, 1500); });
  if (pend) tgLoginPoll();
}
// The member approves in the bot, then comes back here: poll while visible (iOS pauses the app while Telegram is open).
const tgPending = () => { try { const p = JSON.parse(localStorage.getItem("cc-tg-login")); return p && Date.now() - p.t < 6e5 ? p : null; } catch (e) { return null; } };
let tgPoll = 0;
async function tgLoginPoll() {
  clearTimeout(tgPoll);
  const p = tgPending();
  if (!p || document.hidden) return;
  try {
    if (await api.tgLogin(p.n)) { localStorage.removeItem("cc-tg-login"); return boot(); }
    tgPoll = setTimeout(tgLoginPoll, 2000);
  } catch (e) { localStorage.removeItem("cc-tg-login"); renderAuth("signin", e.message); }
}
document.addEventListener("visibilitychange", tgLoginPoll);

/* ===================== BOOT ===================== */
// All startup reads run in parallel. Group data (Dkay) loads in the background; admin views await it themselves.
async function loadMe(user) {
  S.proj = null; S.email = user.email; S.admin.loadedAt = 0;
  let st;
  [S.me, S.txs, S.msgs, S.flows, st, S.updates] = await Promise.all([api.me(), api.transactions(user.id), api.messages(user.id),
    api.flows(user.id).catch(() => []), api.getSetting("model").catch(() => null), api.updates().catch(() => [])]);
  S.model = st?.value?.version === 2 ? { ...DEFAULT_MODEL, ...st.value } : null; S.modelUpdatedAt = st?.updated_at || null;
  CG.ensure(modelCoinIds()).then(() => paintBadge("updates", alertCount())).catch(() => {});
  if (canPostSignals()) inboxData().catch(() => {});
  if (isAdmin()) loadAdmin(true).then(() => paintBadge("members", openReviewCount())).catch(() => {});
}
// A reset link signs you in (that's how Supabase lets you set the new password). Until the new password is saved,
// that session only shows the reset screen; leaving without saving signs it out on the next open.
let recovering = RECOVERY_LINK, authListening = false;
const recFlag = (on) => { try { if (on != null) on ? localStorage.setItem("cc-recover", "1") : localStorage.removeItem("cc-recover"); return localStorage.getItem("cc-recover"); } catch (e) { return null; } };
async function boot() {
  try {
    if (!sb) throw new Error("Couldn't load Supabase library. Check your connection.");
    if (!authListening && (authListening = true)) api.onAuthChange((ev) => { if (ev === "PASSWORD_RECOVERY") { recovering = true; recFlag(true); renderAuth("recover"); } });
    const s = await api.session();
    if (recovering && s) { recFlag(true); return renderAuth("recover"); }
    if (s && recFlag()) { recFlag(false); await api.signOut(); return renderAuth("signin", "Password reset wasn't finished. Tap Forgot password to get a new link."); }
    if (!s) return renderAuth();
    await loadMe(s.user);
    const gated = () => !isAdmin() && !signalsOnly() && S.me.in_group === false;
    if (gated()) return renderGate();
    // Members always open on their portfolio, whatever page they were on last time.
    if (!isAdmin() && location.hash !== "#overview") history.replaceState(null, "", location.pathname + location.search + "#overview");
    render();
    installBanner();
    LIVE.start();
    tgLink().then(() => gated() && renderGate());   // re-checks group membership without holding up the first paint
  } catch (e) {
    $("#app").innerHTML = `<div class="auth-wrap"><div class="card" style="max-width:440px"><h2>Couldn't load</h2><p class="secondary">${esc(e.message || e)}</p><button class="btn" onclick="location.reload()">Retry</button></div></div>`;
  }
}
setInterval(() => { if (S.me && !document.hidden && currentRoute() === "overview") { CG.ensure(S.txs.map(t => t.coin_id)).then(() => { if (currentRoute() === "overview" && !document.querySelector(".overlay")) render(); }); } }, 60000);
/* ===================== TELEGRAM MINI APP ===================== */
const TG = window.Telegram?.WebApp?.initData ? window.Telegram.WebApp : null;
function tgTheme() { try { if (!localStorage.getItem("cc-theme")) document.documentElement.dataset.theme = TG.colorScheme === "dark" ? "dark" : "light"; } catch (e) {} }
if (TG) { try { TG.ready(); TG.expand(); tgTheme(); TG.onEvent("themeChanged", tgTheme); TG.onEvent("fullscreenChanged", paintFsBtn); document.documentElement.classList.add("in-telegram"); } catch (e) {}
  // Scrolling to the very top/bottom of a long page shouldn't minimise or close the Mini App.
  try {
    if (TG.isVersionAtLeast?.("7.7")) TG.disableVerticalSwipes();
    else if (TG.enableClosingConfirmation) TG.enableClosingConfirmation();   // older Telegram: at least ask before closing
  } catch (e) {}
}
// Every open from Telegram: link the chat and re-check CC group membership.
async function tgLink() {
  try {
    const u = TG?.initDataUnsafe?.user;
    if (!u || !S.me) return;
    const { data, error } = await sb.functions.invoke("tg-link", { body: { initData: TG.initData } });
    if (!error && data && data.ok) Object.assign(S.me, { telegram_chat_id: u.id, in_group: data.in_group ?? S.me.in_group });
  } catch (e) {}
}
function renderGate() {
  $("#app").innerHTML = `<div class="auth-wrap"><div class="card" style="max-width:440px"><h2>${esc(CONFIG.GROUP_NAME)} members only</h2><p class="secondary">This Telegram account isn't in the ${esc(CONFIG.GROUP_NAME)} group. Join it, then open the Desk again.</p><button class="btn primary" onclick="location.reload()">I've joined</button></div></div>`;
}
/* ===================== MOBILE KEYBOARD ===================== */
// "Done"/Enter closes the keyboard (and commits the value) on every input; tapping outside does too.
const isTypingEl = (el) => el && ((el.tagName === "INPUT" && !["checkbox", "radio", "range", "button", "submit", "file", "color"].includes(el.type)) || el.tagName === "TEXTAREA" || el.isContentEditable);
document.addEventListener("keydown", (e) => {
  const el = e.target;
  if (e.key !== "Enter" || e.isComposing || !el || el.tagName !== "INPUT" || !isTypingEl(el)) return;
  if (el.type !== "password") e.preventDefault();
  setTimeout(() => { if (document.activeElement === el) el.blur(); }, 0);
});
document.addEventListener("focusin", (e) => { const el = e.target; if (el && el.tagName === "INPUT" && isTypingEl(el) && !el.hasAttribute("enterkeyhint")) el.setAttribute("enterkeyhint", "done"); });
document.addEventListener("pointerdown", (e) => {
  const a = document.activeElement;
  if (!isTypingEl(a) || e.pointerType === "mouse") return;
  const t = e.target;
  if (t === a || (t.closest && t.closest("input, textarea, select, label, button, a, [contenteditable], [tabindex], .dropdown, .chip"))) return;
  a.blur();
}, true);
/* ===================== INSTALL (PWA) ===================== */
// Home-screen install: Android/desktop Chrome get the real Install prompt, iPhone gets the Share → Add to Home Screen steps,
// Telegram gets "Open in browser". Hidden once installed; dismissing hides it for a week (Profile → Add to home screen brings it back).
let installEvt = null;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; installBanner(); });
addEventListener("appinstalled", () => $(".install")?.remove());
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || !!navigator.standalone;
// The installed app has no browser reload: pull down from the top of the page and let go to reload (also picks up new versions).
if (isStandalone()) {
  let y0 = null, ind = null;
  // Never inside a box that scrolls on its own (message thread, tables): a fast swipe up through it would otherwise reload.
  const inScroller = (el) => { for (; el && el !== document.body; el = el.parentElement) if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) return true; };
  addEventListener("touchstart", (e) => { y0 = scrollY <= 0 && !e.target.closest("canvas, .overlay, .install") && !inScroller(e.target) ? e.touches[0].clientY : null; }, { passive: true });
  addEventListener("touchmove", (e) => {
    const d = y0 == null || scrollY > 0 ? 0 : e.touches[0].clientY - y0;
    if (d <= 10) return;
    ind ||= document.body.appendChild(Object.assign(document.createElement("div"), { className: "ptr icon-btn", innerHTML: ICON.refresh }));
    ind.style.transform = `translate(-50%, ${Math.min(d, 140) * .5}px) rotate(${d * 2}deg)`; ind.classList.toggle("on", d > 90);
  }, { passive: true });
  addEventListener("touchend", () => { if (ind?.classList.contains("on")) { ind.classList.add("spin"); location.reload(); } else ind?.remove(); ind = y0 = null; });
}
// Pops up on its own only once per member (remembered on the device and in Telegram's CloudStorage, which survives Telegram clearing web storage).
// ?install=1 links show it any time; afterwards members use Telegram's ⋯ menu (Add to Home Screen) or the bot's /home.
let installForced = false;
function installBanner() {
  const preSignin = !!$(".auth-wrap"), linked = new URLSearchParams(location.search).has("install");
  if (preSignin && !linked) return;   // signed-out screens: only for members sent from the Telegram Desk
  if (isStandalone() || $(".install")) return;
  installForced = linked;
  if (!installForced) {
    try { if (localStorage.getItem("cc-install-seen")) return; } catch (e) {}
    if (TG?.isVersionAtLeast?.("6.9")) return TG.CloudStorage.getItem("install_seen", (e, v) => v ? markInstallSeen() : showInstall(preSignin));
  }
  showInstall(preSignin);
}
function markInstallSeen() { try { localStorage.setItem("cc-install-seen", "1"); } catch (e) {} try { TG?.isVersionAtLeast?.("6.9") && TG.CloudStorage.setItem("install_seen", "1"); } catch (e) {} }
function showInstall(preSignin) {
  // Telegram 8.0+: native Mini App shortcut (opens in Telegram, already signed in). Older Telegram or unsupported device: the browser install below.
  if (tgHome()) return TG.checkHomeScreenStatus((st) => st === "added" ? null : st === "unsupported" ? browserInstall(preSignin) :
    paintInstall(preSignin, `Telegram shortcut opens here, signed in. The ${isIOS ? "Safari" : "browser"} app runs full screen on its own.`, "Telegram shortcut", () => TG.addToHomeScreen(), [isIOS ? "Safari app" : "Browser app", openBrowserInstall]));
  browserInstall(preSignin);
}
const openBrowserInstall = () => TG.openLink(location.origin + location.pathname + "?install=1");
const tgHome = () => !!TG?.isVersionAtLeast?.("8.0");
function browserInstall(preSignin) {
  const how = TG ? (isIOS ? "Open it in Safari, then tap Share → Add to Home Screen." : "Open it in your browser, then install it.") : installEvt ? null : isIOS ? `Tap Share, then Add to Home Screen${preSignin ? ", and sign in from there" : ""}.` : "";
  if (how === "") return;
  paintInstall(preSignin, how, TG ? "Open in browser" : installEvt ? "Install" : null, () => {
    if (TG) return openBrowserInstall();
    installEvt.prompt(); installEvt.userChoice.then((c) => c.outcome === "accepted" && $(".install")?.remove());
  });
}
function paintInstall(preSignin, how, label, go, alt) {
  if ($(".install")) return;
  if (!installForced) markInstallSeen();
  const el = document.createElement("div");
  el.className = "install" + (preSignin ? " pre-signin" : ""); el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Install the Desk");
  el.innerHTML = `<img src="icons/icon-192.png?v=20261120b" alt=""><div class="t"><b>Get the Desk on your home screen</b>${how ? `<div class="secondary">${how}</div>` : ""}
    ${label ? `<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn primary small" data-go>${label}</button>${alt ? `<button class="btn small" data-alt>${alt[0]}</button>` : ""}</div>` : ""}</div>
    <button class="icon-btn sm" data-x aria-label="Dismiss">${ICON.x}</button>`;
  document.body.appendChild(el);
  el.querySelector("[data-x]").onclick = () => el.remove();
  el.querySelector("[data-go]") && (el.querySelector("[data-go]").onclick = go);
  el.querySelector("[data-alt]") && (el.querySelector("[data-alt]").onclick = alt[1]);
}
if (TG && tgHome() && new URLSearchParams(location.search).get("add") === "home") try { history.replaceState(null, "", location.pathname + location.hash); TG.addToHomeScreen(); } catch (e) {}   // from the bot's /home button, once
if (TG) try { TG.onEvent("homeScreenAdded", () => { $(".install")?.remove(); toast("Added to your home screen"); }); } catch (e) {}
try { const go = new URLSearchParams(location.search).get("go"); if (go && /^[\w-]+$/.test(go)) history.replaceState(null, "", location.pathname + "#" + go); } catch (e) {}
boot();
