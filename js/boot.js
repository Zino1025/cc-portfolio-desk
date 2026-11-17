/* ===================== AUTH ===================== */
function renderAuth(mode = "signin", msg = "") {
  $("#app").innerHTML = `<div class="auth-wrap"><div class="auth">
    <div class="brand"><span class="logo">${esc(CONFIG.GROUP_NAME)}</span>Portfolio Desk</div>
    <p class="secondary" style="text-align:center;margin:0 0 18px">Track your bags. Get ${esc(CONFIG.REVIEWER_NAME)}'s feedback without the DMs.</p>
    <div class="card">
      ${mode === "recover" ? `
        <h2>Set a new password</h2>
        <label class="field"><span>New password</span><input type="password" enterkeyhint="go" id="a-pw" minlength="8" autocomplete="new-password"></label>
        <label class="showpw"><input type="checkbox" data-showpw="a-pw"> Show password</label>
        <div class="err" id="a-err">${esc(msg)}</div>
        <button class="btn primary" id="a-go" style="width:100%">Save password</button>` : `
      <div class="seg" style="width:100%;margin-bottom:16px"><button style="flex:1" class="${mode === "signin" ? "on" : ""}" data-m="signin">Sign in</button><button style="flex:1" class="${mode === "signup" ? "on" : ""}" data-m="signup">Create account</button></div>
      ${mode === "signup" ? `
        <label class="field"><span>Display name</span><input type="text" enterkeyhint="done" id="a-name" maxlength="60" autocomplete="nickname"></label>
        <label class="field"><span>Telegram handle</span><input type="text" enterkeyhint="done" id="a-tg" maxlength="40" placeholder="@yourhandle"></label>` : ""}
      <label class="field"><span>Email</span><input type="email" enterkeyhint="done" id="a-email" autocomplete="email"></label>
      <label class="field"><span>Password</span><input type="password" enterkeyhint="go" id="a-pw" minlength="8" autocomplete="${mode === "signup" ? "new-password" : "current-password"}"></label>
      <label class="showpw"><input type="checkbox" data-showpw="a-pw"> Show password</label>
      <div class="err" id="a-err">${esc(msg)}</div>
      <button class="btn primary" id="a-go" style="width:100%">${mode === "signup" ? "Create account" : "Sign in"}</button>
      ${mode === "signin" ? `<div style="text-align:center;margin-top:12px"><button class="link-btn" id="a-forgot">Forgot password?</button></div>` : ""}`}
    </div>
    <p class="muted" style="text-align:center;font-size:12px;margin-top:16px">Your portfolio is private: only you and ${esc(CONFIG.REVIEWER_NAME)} can see it.</p>
  </div></div>`;
  document.querySelectorAll("[data-m]").forEach(b => b.onclick = () => renderAuth(b.dataset.m));
  const err = (m) => $("#a-err").textContent = m;
  $("#a-go").onclick = async () => {
    const pw = $("#a-pw").value;
    try {
      if (mode === "recover") { if (pw.length < 8) return err("Password needs 8+ characters."); await api.updatePassword(pw); toast("Password updated"); return boot(); }
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
    } catch (e) { err(e.message || "Something went wrong."); }
  };
  $("#a-forgot") && ($("#a-forgot").onclick = async () => {
    const email = $("#a-email").value.trim(); if (!email) return err("Type your email above first.");
    try { await api.resetPassword(email); err("If that email has an account, a reset link is on its way."); } catch (e) { err(e.message); }
  });
  $("#a-pw").addEventListener("keydown", e => { if (e.key === "Enter") $("#a-go").click(); });
}

/* ===================== BOOT ===================== */
async function loadMe() {
  S.proj = null;
  S.me = await api.me();
  S.email = await api.email();
  S.txs = await api.transactions(S.me.id);
  S.msgs = await api.messages(S.me.id);
  try { const st = await api.getSetting("model"); S.model = st?.value?.version === 2 ? { ...DEFAULT_MODEL, ...st.value } : null; S.modelUpdatedAt = st?.updated_at || null; } catch (e) { S.model = null; }
  try { S.updates = await api.updates(); } catch (e) { S.updates = []; }
  CG.ensure(modelCoinIds()).then(() => paintAlertBadge()).catch(() => {});
  S.admin.loadedAt = 0;
  if (isAdmin()) await loadAdmin(true);
}
let recovering = false, authListening = false;
async function boot() {
  try {
    if (!DEMO && typeof window.supabase === "undefined") throw new Error("Couldn't load Supabase library. Check your connection.");
    if (!DEMO && !authListening && (authListening = true)) api.onAuthChange((ev) => { if (ev === "PASSWORD_RECOVERY") { recovering = true; renderAuth("recover"); } });
    const s = await api.session();
    if (recovering) return;
    if (!s) return renderAuth();
    await loadMe();
    await tgLink();
    // Members always open on their portfolio, whatever page they were on last time.
    if (!isAdmin() && location.hash !== "#overview") history.replaceState(null, "", location.pathname + location.search + "#overview");
    render();
    LIVE.start();
  } catch (e) {
    $("#app").innerHTML = `<div class="auth-wrap"><div class="card" style="max-width:440px"><h2>Couldn't load</h2><p class="secondary">${esc(e.message || e)}</p><button class="btn" onclick="location.reload()">Retry</button></div></div>`;
  }
}
setInterval(() => { if (S.me && !document.hidden && ["overview"].includes(currentRoute())) { CG.ensure(S.txs.map(t => t.coin_id)).then(() => { if (currentRoute() === "overview" && !document.querySelector(".overlay")) render(); }); } }, 60000);
/* ===================== TELEGRAM MINI APP ===================== */
const TG = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) ? window.Telegram.WebApp : null;
function tgTheme() { try { if (!localStorage.getItem("cc-theme")) document.documentElement.dataset.theme = TG.colorScheme === "dark" ? "dark" : "light"; } catch (e) {} }
if (TG) { try { TG.ready(); TG.expand(); tgTheme(); TG.onEvent("themeChanged", tgTheme); document.documentElement.classList.add("in-telegram"); } catch (e) {}
  // Scrolling to the very top/bottom of a long page shouldn't minimise or close the Mini App.
  try {
    if (TG.isVersionAtLeast && TG.isVersionAtLeast("7.7")) TG.disableVerticalSwipes();
    else if (TG.enableClosingConfirmation) TG.enableClosingConfirmation();   // older Telegram: at least ask before closing
  } catch (e) {}
}
async function tgLink() {
  try {
    const u = TG && TG.initDataUnsafe && TG.initDataUnsafe.user;
    if (!u || api.demo || !sb || !S.me || String(S.me.telegram_chat_id || "") === String(u.id)) return;
    const { data, error } = await sb.functions.invoke("tg-link", { body: { initData: TG.initData } });
    if (!error && data && data.ok) S.me.telegram_chat_id = u.id;
  } catch (e) {}
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
try { const go = new URLSearchParams(location.search).get("go"); if (go && /^[\w-]+$/.test(go)) history.replaceState(null, "", location.pathname + "#" + go); } catch (e) {}
boot();
