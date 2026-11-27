# CC Portfolio Desk

Portfolio tracker for the ~250-member CC Telegram group. Members log trades; Dkay reviews each portfolio and leaves feedback. Plain HTML/JS, no build step. Hosted on GitHub Pages (pushing to `main` = deploying). Backend: Supabase project `cc-portfolio`. Opens inside Telegram as a Mini App via @CCPortfolioManagerBot, or as an installed home-screen app (PWA: `manifest.webmanifest`, `sw.js`, `icons/`).

## Files
- `index.html`: shell only (CDN libraries + links to the CSS and the JS files below). Every script is `defer`, and library versions are pinned so phones cache them; keep both when adding one.
- `css/app.css`: all styles (~25 KB).
- `js/*.js`: app logic, split into 11 plain `<script>` files (not modules), each under ~37 KB. See the map below. Open only the file you need.
- `supabase/functions/*`: backups of the deployed Edge Functions (see their README).
- `supabase/*.sql`: migrations that have already been applied.
- `.claude/skills/`: official Supabase skills (`supabase`, `supabase-postgres-best-practices`), pinned in `skills-lock.json`. Load them for any Supabase, SQL or RLS work.
- `sw.js`: network-first pages, cache-first for `?v=` files and pinned CDN libs. If you ever add an unversioned file it must not match those rules, or bump `C`.

## How to work efficiently (read this first)
1. Find the file and section in the map below, `grep -n` for the exact function, then `Read` only that range (offset/limit). Don't scan the repo.
2. Line numbers drift. Search for the section header (e.g. `grep -n "MEMBER: TRADES" js/*.js`) instead of trusting them.
3. Keep it lean: fix the existing code path with the fewest lines, reuse helpers, and delete whatever a change makes dead (functions, CSS, comments). No duplicate logic, no speculative code.
4. Before committing: `for f in js/*.js; do node --check $f; done`.
5. After changing `css/app.css` or any `js/*.js`, bump `?v=` on that file's tag in `index.html` to today's date (YYYYMMDD). Otherwise Telegram and browsers keep serving the cached old version.
6. When adding a new section, use the same `/* ===== NAME ===== */` header style and add it to the map below. Load order matters: files share one global scope, but function declarations only hoist within their own file, so top-level code that runs immediately may only call things from the same or an earlier file. `boot()` runs last, from `boot.js`. A new file needs its own `<script>` tag in `index.html`, in the right place.
7. Debug by looking, not guessing: print or query the real values first (console output, a Supabase SQL query, the function logs), then fix.
8. No test suites. Verification is `node --check` on the changed files plus checking the changed screen on the live site. Keep every check under a minute.
9. Keep this file short. It should only hold what the code doesn't already make obvious. Update the map when sections move, and cut stale notes.
10. When you deploy or change an Edge Function, copy the code into `supabase/functions/<name>/index.ts` and update that README.
11. Rollback: `git revert <sha>` and push (Pages redeploys in ~1 min). Edge Function: redeploy its copy from `supabase/functions/`. Never force-push main (blocked in `.claude/settings.json`).

## JS map (load order = order in index.html; numbers are approximate starting lines)
| File | Sections |
|---|---|
| `core.js` | CONFIG 1 (Supabase URL/publishable key, REVIEWER_NAME), UTILITIES 9 (formatters, `openModal`/`confirmModal`, `coinSearch`, `plural`), ATTACHMENTS 160 (photos, voice notes incl. in-app recording, videos, PDFs on Dkay's posts and both sides of the thread), COINGECKO 268 (last prices saved on the device as `cc-prices` so the portfolio paints instantly), PORTFOLIO MATH 346 (average cost, `applyTx`), DATA LAYER 384 (all Supabase reads/writes), STATE 444 |
| `charts.js` | CHARTS 1 (donut + allocation rewind), DELTA-STYLE CHARTS 53 (portfolio history; hero coin chips `S.heroCoin` switch header, chart and stats to one coin), share card PNG 220 (always the dark brand look with fixed brand colors, the one place hex colors are allowed in JS), live prices 239 (Coinbase BTC/ETH + MEXC via `prices` function, CoinGecko fallback), chart helpers 288 (price tag, axes, hold-to-scrub: header shows the held point, no tooltips), price charts 330 (BTC, ETH, group coins) |
| `shell.js` | SHELL 1 (bottom tab bar, max 5 tabs per Apple HIG: `tabs()`; `GROUPS` put Plan = Exit Plan/Rebalance/Projections, Market = Updates/Signals and Admin = Review/Group/Model behind a `.subnav` segmented control; Profile opens from the header avatar, Sign out lives in Profile), MEMBER: OVERVIEW 57 |
| `trades.js` | MEMBER: TRADES 1 (export: Desk backup or Koinly tax file), money in/out 111 (`cash_flows`), trade modal 141 |
| `trade-import.js` | Screenshot import 1, CSV import 120 |
| `member.js` | FEEDBACK THREAD 1, PROJECTIONS 72 (My portfolio / Custom; What if hero: past value + dashed line to target, Today/Profit/Return stats; Targets list: 1×·2×·3×·5×·10×·50×·100× for all, per-coin Price or Exit TP (Dkay's exit prices)), MEMBER: PROFILE 232 (incl. bug/idea tickets: `tickets` table, only `profiles.gets_tickets` admins see them and get the tg-notify ping, set by SQL, not in the app; Mark done pings the reporter), MODEL PORTFOLIO 266 (Dkay's target mix), MARKET ALERTS 372 (badge = unseen alerts, `profiles.alerts_seen`; opening Market updates clears it), GROUP TOTAL 414, MEMBER: REBALANCE 426 (add-only) |
| `market.js` | ADMIN: MODEL EDITOR 1, MARKET UPDATES 79 (weekly summary + urgent bids) |
| `signals.js` | SIGNALS 1 (Waiting/Active/Closed cards, post/edit form with `sigCheck` validation (`edit_signal` RPC), update modal, confirm before every ping; Delete = admins only, any status, no ping; ELITE UPSELL `viewElite`; `seesSignals()`/`canPostSignals()` in core.js STATE; tables, RLS, `post_signal` RPC and the triggers that apply updates are in `supabase/signals.sql`; tier + Signals Admin are set in Member detail; INBOX `viewInbox` (header bell, badge = members waiting for a reply; `#inbox-<id>` thread; New message = all Signals members or one): admins see every member, Signals Admins only Signals-only members (RLS + `author_name` in `supabase/signals_inbox.sql`); Signals-only members write from their Messages tab (`viewFeedback` without the review card)) |
| `exit-plan.js` | EXIT PLAN 1 (steps store their price in `st.at` for the `sell-check` pings (every 5 min, recent MEXC high; also a 5x-in-24h spike ping for holders)) |
| `admin.js` | ADMIN: BROADCAST 1, ADMIN DATA 77, REVIEW QUEUE 99, MEMBER DETAIL 157, GROUP INSIGHTS 302 |
| `boot.js` | AUTH 1 (a reset link only opens the set-password screen; unfinished resets are signed out on next open; outside Telegram, Sign in with Telegram: nonce → bot Approve → `tg-login` poll → `api.tgLogin`, maps via `profiles.telegram_chat_id`), BOOT 51 (startup reads in parallel; group data and tg-link run after the first paint; calls `boot()` at the end), TELEGRAM MINI APP (tg-link on every open + CC group gate), MOBILE KEYBOARD (adds `enterkeyhint="done"` to every input, so don't write it in markup), INSTALL (service worker + home-screen banner; inside Telegram 8.0+ it uses the native Mini App shortcut `TG.addToHomeScreen()` (opens in Telegram, signed in), older Telegram falls back to the browser steps; signed-in members only, except on sign-in for `?install=1` from the Telegram Desk: Install prompt / iPhone Share steps / Open in browser from Telegram; pops up on its own only once per member (localStorage + Telegram CloudStorage `install_seen`); after that members use Telegram's ⋯ menu → Add to Home Screen or the bot's /home (no button in Profile); pull-to-refresh in the installed app), APP NOTIFICATIONS (`setPush` Web Push subscribe/unsubscribe → `push_subs`; Profile → Notifications has App + Telegram (`profiles.tg_mute`) switches; `syncAppBadge()` = sum of on-screen badges → icon badge, `sw.js` adds one per push until the app opens) |

css/app.css: THEME 1 (tokens), LAYOUT 73, CONTROLS 101, TABLES 133, CHART 156, THREAD 167, MODAL/AUTH 196, DELTA-STYLE COMPONENTS 278, CALM COMPONENTS (end: `.icon-btn`, `.acts`, `.section-head`, `.cta-card`). Icons: `ICON` in core.js.

## Design system (every screen, every change)
- Font: Inter Tight. Title (h1) 22/28 600 −0.7px. Section header (h2) 19/24 600 −0.6px. Body 14.5/18 400 +0.3px. Captions 13px. All headings and big numbers get negative letter-spacing. Weights 400/500/600 only.
- Brand roles (one meaning per color): yellow `--accent` = primary actions only (fill, black `--accent-ink`), `--link` = yellow text links/focus (darker in light mode for contrast); purple `--brand` = selection/identity (active tab, selected chips, Dkay's messages); black/plum-tinted neutrals everywhere else. Warnings are amber `--warn-*`, never brand yellow. Keep yellow to ~10% of a screen.
- Colors: `var(--text)` primary, `var(--muted)` secondary, `var(--strong)` icons. No new grays or hex colors in JS/inline styles; add a token in THEME if truly needed (light and dark).
- Dividers: 1px `var(--track)`. No visible borders anywhere. Status = tinted background, not a colored border.
- Cards: no border, layered shadows: `--sh-1` normal cards, `--sh-2` hero and modals. Radius by depth: 18 hero/modal, 16 card, 14 nested/CTA, 12 inputs/small.
- Feedback: `toast(msg)` treats "Couldn't…"-style messages as errors (5s, tap to dismiss, Telegram error haptic) and the rest as success; pass `"error"` as the 2nd arg for raw `e.message`. Dark-mode modals use `--surface-elev`.
- Modals: use `openModal()` / `confirmModal()` from core.js, never build the overlay by hand.
- Buttons: never flat fills. Text buttons = `.btn` / `.btn.primary`. Icon buttons = `.icon-btn` (38 `.sm`, 40, 46 `.lg`) with an `ICON` svg and an `aria-label`. No emoji in buttons. Icon + text buttons: icon side gets less padding than the text side (CSS handles it when the svg is a direct first/last child).

## Design review (after every feature, before pushing)
Build first, then check the new screen fits the rest of the app:
- Same components and tokens as existing screens (no one-off styles, borders or flat fills).
- No subtitles under page titles, no hints for obvious actions, no captions that just restate a label. Keep only text that changes what the user does (warnings, errors, real numbers).
- Touch targets ≥44px on phones; inputs stay 16px (no iOS zoom).
- `:hover` styles go only in the `@media (hover:hover)` block (else they stick after a tap). Anything tappable gets an `:active` response: `scale(.96)` (never below .95), never `transition: all`.
- Copy: rewrite every label until it can't get shorter; one name per thing, used everywhere; buttons are short verbs. Paragraph text (`p`, `.hint`, `.callout`, `.empty`, `.msg`) uses line-height 1.45; keep line-heights unitless so they scale with text size.
- Counts use `plural(n, "word")` (no "1 members"). Placeholders and loading text end with `…`. Handle/email inputs get `autocapitalize="off" spellcheck="false"`.
- Images get the `--img-line` outline (pure black/white at 10%), already set for `.coin img` and `.atts img`.
- Worst-case data at 320px: long names/handles/URLs and 7-figure values must not overflow. Flex/grid text columns need `min-width:0`; never truncate numbers.
- 2–4 short choices = segmented buttons (`select.as-seg`), not a dropdown.
- Look at it at 390px wide before pushing.

## Product rules
- The name is spelled "Dkay", never "DKay".
- Coins are shown by ticker only (TET, ACN, PAAL, VELO, OTK…), not full names.
- Members always open on the Portfolio tab. Profile opens from the header avatar. Exception: Signals-only members (`signalsOnly()`) get just Signals + Elite (upsell, sends an "Upgrade to Elite" thread message) and skip the CC group gate.
- Charts show the live price and must be readable and tappable straight away.
- Model portfolio: TET 40% and ACN 30% are fixed. The other 30% is split however the member likes across PAAL/VELO/OTK. No stablecoin slice.
- Signals: tier `elite` (default) / `signals` / `both`; Signals Admins (`profiles.signals_admin`) post. Pings only for new signal and analyst updates (tg-notify). Profit split = `split_rules` rows, empty until Dkay decides (cards show "TBD"). Waiting signals auto-fill: the `fill-check` cron (every 5 min, tg-notify) posts the `entry` update once the MEXC low (CoinGecko fallback) reaches the limit/zone top. Auto TP/stop pings are phase 3. Signals Admins (Anton, Saad) are signals-only for now: they post signals and reply to Signals-only members (Inbox) but can't see CC members' portfolios or threads. Saad may later post CC TA updates (not member-specific access).
- Don't add new Telegram price-drop alert messages. (TP-hit pings are opt-in, per member, from their own exit plan.)
- Access: `has_access()` (supabase/approval.sql, `hasAccess()` in core.js) = admin, Signals Admin, `approved` (admin sets in Member detail), in the CC group, or a Signals plan. Others see the "Waiting for approval" screen; RLS hides updates, settings, group totals and shared files from them, and tp-check pings admins once per waiting person. An admin sends `/setgroup` in the CC group once so group members get in automatically. `profiles.in_group` is set only by tg-link / tg-notify.
- Secrets live in Supabase → Edge Functions → Secrets, never in this repo. The publishable key in CONFIG is safe to keep (RLS protects the data).
- The screenshot import uses `claude-haiku-5-5` on purpose (cheapest model). Don't upgrade it unless reading accuracy is actually a problem.
