/* ===================== HELP ===================== */
// Apple-Support-style help: #help = search + popular + categories, #help-<slug> = one article.
// Each article: task title, one-line intro, numbered steps, "If it didn't work", related, Was this helpful?
// `keys` = extra words members might search for. `related` may name articles not written yet; they're skipped.
const HELP = [
  { slug: "waiting", cat: "Getting started", title: "Why am I seeing “Waiting for approval”?", keys: "approval approve locked blocked can't get in pending access join group",
    related: ["sign-in", "install"], body: `
    <p>The Desk is only for members of the CC group. This screen means it hasn't confirmed you're in yet. Most people get in within a minute.</p>
    <h3>Get in right away</h3>
    <ol class="steps"><li>Open Telegram and go to <b>@CCPortfolioManagerBot</b>.</li>
      <li>Open the Desk from the bot. It checks that you're in the CC group and lets you in.</li>
      <li>Still waiting? Go back to the waiting screen and tap <b>Check again</b>.</li></ol>
    <h3>If it says your account isn't in the CC group</h3>
    <ol class="steps"><li>Join the CC group with that same Telegram account.</li>
      <li>Open the Desk from the bot again.</li></ol>
    <h3>Or wait for approval</h3>
    <p>Admins get a list of everyone waiting. Once you're approved, tap <b>Check again</b>.</p>
    <h3>If it didn't work</h3>
    <ul class="fixes"><li><b>Signed in to the wrong account?</b> Tap <b>Sign out</b>, then sign in with the account you use in the CC group.</li>
      <li><b>Joined with a different Telegram account?</b> Open the Desk from the Telegram account that's in the group.</li>
      <li><b>Still stuck after a day?</b> Message an admin in the CC group.</li></ul>` },

  { slug: "install", cat: "App and notifications", title: "Put the Desk on your home screen", keys: "app download install icon pwa iphone android shortcut safari chrome home screen",
    related: ["notifications", "shortcut-vs-app"], body: `
    <p>There's nothing to download from an app store. Add the Desk to your home screen and it opens like an app.</p>
    <h3>Pick one of two ways</h3>
    <ul class="fixes"><li><b>Telegram shortcut.</b> Fastest. It opens inside Telegram and you're already signed in. App notifications don't work inside Telegram, but you still get Telegram pings.</li>
      <li><b>Safari app or Browser app.</b> Runs full screen on its own and can send app notifications, with a badge on the icon. You sign in once.</li></ul>
    <h3>From Telegram</h3>
    <ol class="steps"><li>Open the Desk from <b>@CCPortfolioManagerBot</b>.</li>
      <li>When the “Get the Desk on your home screen” banner appears, tap <b>Telegram shortcut</b>. Or tap <b>Safari app</b> (iPhone) or <b>Browser app</b> (Android), then follow the steps below.</li>
      <li>Missed the banner? Tap Telegram's <b>⋯</b> menu, then <b>Add to Home Screen</b>. Or send <b>/home</b> to the bot.</li></ol>
    <h3>From Safari on iPhone</h3>
    <ol class="steps"><li>Open the Desk in Safari.</li>
      <li>Tap <b>Share</b>. On iOS 26, tap <b>•••</b> next to the address bar first, then <b>Share</b>.</li>
      <li>Tap <b>Add to Home Screen</b>. You may need to tap <b>View More</b> first.</li>
      <li>Leave <b>Open as Web App</b> on and tap <b>Add</b>.</li>
      <li>Open the new icon and tap <b>Sign in with Telegram</b>. Tap <b>Start</b>, then <b>Approve</b> in the bot, and come back.</li></ol>
    <h3>From Chrome on Android or a computer</h3>
    <ol class="steps"><li>Open the Desk in Chrome.</li>
      <li>Tap <b>Install</b> on the banner. No banner? Tap <b>⋮</b>, then <b>Add to home screen</b>, then <b>Install</b>.</li>
      <li>Open the new icon and sign in.</li></ol>
    <h3>If it didn't work</h3>
    <ul class="fixes"><li><b>No “Add to Home Screen” on iPhone?</b> You're probably in Telegram's built-in browser. Tap <b>Safari app</b>, or open the link in Safari.</li>
      <li><b>The icon asks me to sign in again?</b> That's normal for the Safari app. It keeps its own sign-in, so sign in once inside it.</li>
      <li><b>The app looks out of date?</b> Pull down from the top of the screen and let go to refresh.</li></ul>` },

  { slug: "notifications", cat: "App and notifications", title: "Turn on notifications", keys: "notifications pings alerts push badge telegram bot sound muted not getting",
    related: ["install", "badge"], body: `
    <p>Get a ping when Dkay replies, when there's an urgent market update, or when a sell step in your Exit Plan hits.</p>
    <ol class="steps"><li>Tap your initial in the top-right corner to open <b>Profile</b>.</li>
      <li>Scroll to <b>Notifications</b>.</li>
      <li>Turn on <b>Telegram</b> to get pings from the CC bot.</li>
      <li>Turn on <b>App</b> to get notifications on your phone or computer, then tap <b>Allow</b>.</li>
      <li>Want a ping when a sell step hits? Go to <b>Plan</b>, then <b>Exit Plan</b>, and turn on <b>Sell pings</b>.</li></ol>
    <p><b>You'll get pinged for</b> Dkay's replies and suggestions, urgent market updates, your Exit Plan sell steps (if Sell pings is on), Signals (if you're on a Signals plan), and replies to bugs or ideas you've sent.</p>
    <h3>If it didn't work</h3>
    <ul class="fixes"><li><b>“App” is greyed out?</b> App notifications only work in the installed Safari app on iPhone, not inside Telegram. Add the Desk to your home screen from Safari, open it from that icon and try again.</li>
      <li><b>“Couldn't turn on notifications”?</b> You tapped Don't Allow earlier. On iPhone, go to <b>Settings</b>, <b>Notifications</b>, <b>CC Desk</b> and turn on <b>Allow Notifications</b>. On Android, go to <b>Settings</b>, <b>Apps</b>, <b>CC Desk</b> (or Chrome), <b>Notifications</b>.</li>
      <li><b>“Telegram” is greyed out?</b> Open the Desk from <b>@CCPortfolioManagerBot</b> once. The switch works after that.</li>
      <li><b>Telegram is on but no pings come?</b> Open the bot and tap <b>Start</b> (or <b>Restart</b>). Pings can't reach you if the bot was stopped.</li></ul>` },
];
const HELP_POPULAR = ["waiting", "install", "notifications"];
const helpBy = (slug) => HELP.find(a => a.slug === slug);
const helpText = (a) => (a._t ||= (a.title + " " + a.keys + " " + a.body.replace(/<[^>]+>/g, " ")).toLowerCase());
const helpRows = (list) => `<div class="card hl-card">${list.map(a => `<a class="hl-row help-row" href="#help-${a.slug}"><span class="nm">${esc(a.title)}</span><span class="chev">${ICON.arrow}</span></a>`).join("")}</div>`;

function viewHelp(v, slug) {
  scrollTo(0, 0);
  if (slug) return viewHelpArticle(v, helpBy(slug));
  const cats = [...new Set(HELP.map(a => a.cat))];
  const home = () => `${HELP.length > HELP_POPULAR.length ? `<div class="section-head"><h2>Popular</h2></div>${helpRows(HELP_POPULAR.map(helpBy))}` : ""}
    ${cats.map(c => `<div class="section-head help-cat"><h2>${esc(c)}</h2></div>${helpRows(HELP.filter(a => a.cat === c))}`).join("")}`;
  v.innerHTML = `<div class="help"><div class="page-head"><div><h1>Help</h1></div></div>
    <input type="search" id="help-q" placeholder="Search Help…" autocapitalize="off" spellcheck="false" aria-label="Search Help">
    <div id="help-list">${home()}</div></div>`;
  $("#help-q").oninput = (e) => {
    const words = e.target.value.toLowerCase().split(/\s+/).filter(Boolean), hits = HELP.filter(a => words.every(w => helpText(a).includes(w)));
    $("#help-list").innerHTML = !words.length ? home() : hits.length ? `<div class="section-head help-cat"><h2>${plural(hits.length, "result")}</h2></div>${helpRows(hits)}` : `<div class="empty">Nothing found. Try other words.</div>`;
  };
}
function viewHelpArticle(v, a) {
  if (!a) { v.innerHTML = `<div class="empty"><div class="big">Article not found</div><a href="#help">Back to Help</a></div>`; return; }
  const rel = a.related.map(helpBy).filter(Boolean);
  v.innerHTML = `<div class="help"><div class="page-head help-head"><a class="icon-btn sm back" href="#help" aria-label="Back to Help">${ICON.arrow}</a><h1>${esc(a.title)}</h1></div>
    <div class="card help-art">${a.body}</div>
    ${rel.length ? `<div class="section-head help-cat"><h2>Related</h2></div>${helpRows(rel)}` : ""}
    <div class="card help-vote"><b>Was this helpful?</b><div class="row" style="flex:none;gap:8px"><button class="btn" data-vote="no">No</button><button class="btn" data-vote="yes">Yes</button></div></div></div>`;
  v.querySelectorAll("[data-vote]").forEach(b => b.onclick = () => {
    if (b.dataset.vote === "yes") return $(".help-vote").innerHTML = `<b>Thanks for letting us know.</b>`;
    S.ticketDraft = `Help article "${a.title}" didn't help: `; location.hash = "profile";   // opens Report a bug as an Idea, pre-filled
  });
}
// Signed-out and waiting screens have no shell, so the article opens in a modal (no related links or vote).
function helpModal(slug) { const a = helpBy(slug); openModal(`<div class="help-art">${a.body}</div>`, { title: esc(a.title) }); }
