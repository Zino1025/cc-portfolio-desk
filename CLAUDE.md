# CC Portfolio Desk

Portfolio tracker for the ~250-member CC Telegram group. Members log trades; Dkay reviews each portfolio and leaves feedback. Plain HTML/JS, no build step. Hosted on GitHub Pages (pushing to `main` = deploying). Backend: Supabase project `cc-portfolio`. Opens inside Telegram as a Mini App via @CCPortfolioManagerBot.

## Files
- `index.html`: shell only (CDN libraries + links to the CSS and the JS files below).
- `css/app.css`: all styles (~25 KB).
- `js/*.js`: app logic, split into 10 plain `<script>` files (not modules), each under ~37 KB. See the map below. Open only the file you need.
- `supabase/functions/*`: backups of the deployed Edge Functions (see their README).
- `supabase/*.sql`: migrations that have already been applied.

## How to work efficiently (read this first)
1. Find the file and section in the map below, `grep -n` for the exact function, then `Read` only that range (offset/limit). Don't scan the repo.
2. Line numbers drift. Search for the section header (e.g. `grep -n "MEMBER: TRADES" js/*.js`) instead of trusting them.
3. Make targeted `Edit`s. Don't rewrite big blocks.
4. Before committing: `for f in js/*.js; do node --check $f; done`.
5. After changing `css/app.css` or any `js/*.js`, bump `?v=` on that file's tag in `index.html` to today's date (YYYYMMDD). Otherwise Telegram and browsers keep serving the cached old version.
6. When adding a new section, use the same `/* ===== NAME ===== */` header style and add it to the map below. Load order matters: files share one global scope, but function declarations only hoist within their own file, so top-level code that runs immediately may only call things from the same or an earlier file. `boot()` runs last, from `boot.js`. A new file needs its own `<script>` tag in `index.html`, in the right place.
7. Debug by looking, not guessing: print or query the real values first (console output, a Supabase SQL query, the function logs), then fix.
8. No test suites. Verification is `node --check` on the changed files plus checking the changed screen on the live site. Keep every check under a minute.
9. Keep this file short. It should only hold what the code doesn't already make obvious. Update the map when sections move, and cut stale notes.
10. When you deploy or change an Edge Function, copy the code into `supabase/functions/<name>/index.ts` and update that README.

## JS map (load order = order in index.html; numbers are approximate starting lines)
| File | Sections |
|---|---|
| `core.js` | CONFIG 1 (Supabase URL/publishable key, REVIEWER_NAME), UTILITIES 14, ATTACHMENTS 93 (charts, voice notes, videos, PDFs on Dkay's messages), COINGECKO 170, PORTFOLIO MATH 248 (average cost), DATA LAYER 287 (all Supabase reads/writes), STATE 452 |
| `charts.js` | CHARTS 1, DELTA-STYLE CHARTS 29, live prices 171 (Coinbase BTC/ETH + MEXC via `prices` function, CoinGecko fallback), chart helpers 220 (price tag, axes, tooltips), price charts 246 (BTC, ETH, group coins) |
| `shell.js` | SHELL 1 (tabs, navigation), MEMBER: OVERVIEW 71 |
| `trades.js` | MEMBER: TRADES 1, trade modal 98 |
| `trade-import.js` | Screenshot import 1, CSV import 132 |
| `member.js` | FEEDBACK THREAD 1, PROJECTIONS 55, MEMBER: PROFILE 184, MODEL PORTFOLIO 218 (Dkay's target mix), MARKET ALERTS 325, GROUP TOTAL 354, MEMBER: REBALANCE 366 (add-only) |
| `market.js` | ADMIN: MODEL EDITOR 1, MARKET UPDATES 81 (weekly summary + urgent bids) |
| `exit-plan.js` | EXIT PLAN 1 |
| `admin.js` | ADMIN: BROADCAST 1, ADMIN DATA 83, REVIEW QUEUE 105, MEMBER DETAIL 164, GROUP INSIGHTS 312 |
| `boot.js` | AUTH 1, BOOT 53 (calls `boot()` at the end), TELEGRAM MINI APP 85, MOBILE KEYBOARD 103 |

css/app.css: THEME 1 (tokens), LAYOUT 73, CONTROLS 104, TABLES 135, CHART 157, THREAD 168, MODAL/AUTH 190, DELTA-STYLE COMPONENTS 274, CALM COMPONENTS (end: `.icon-btn`, `.acts`, `.section-head`, `.cta-card`). Icons: `ICON` in core.js.

## Design system (every screen, every change)
- Font: Inter Tight. Title (h1) 22/28 600 −0.7px. Section header (h2) 19/24 600 −0.6px. Body 14.5/18 400 +0.3px. Captions 13px. All headings and big numbers get negative letter-spacing. Weights 400/500/600 only.
- Colors: `var(--text)` primary, `var(--muted)` secondary, `var(--strong)` icons. No new grays or hex colors in JS/inline styles; add a token in THEME if truly needed (light and dark).
- Dividers: 1px `var(--track)`. No visible borders anywhere (`--border` is transparent on purpose). Status = tinted background, not a colored border.
- Cards: no border, layered shadows: `--sh-1` normal cards, `--sh-2` hero and modals. Radius by depth: 18 hero/modal, 16 card, 14 nested/CTA, 12 inputs/small.
- Buttons: never flat fills. Text buttons = `.btn` / `.btn.primary`. Icon buttons = `.icon-btn` (38 `.sm`, 40, 46 `.lg`) with an `ICON` svg and an `aria-label`. No emoji in buttons.
- Old token names (`--text-primary`, `--text-secondary`, `--grid`, `--shadow`…) still work but don't use them in new code.

## Product rules
- The name is spelled "Dkay", never "DKay".
- Coins are shown by ticker only (TET, ACN, PAAL, VELO, OTK…), not full names.
- Members always open on the Portfolio tab. Profile is the last tab.
- Charts show the live price and must be readable and tappable straight away.
- Model portfolio: TET 40% and ACN 30% are fixed. The other 30% is split however the member likes across PAAL/VELO/OTK. No stablecoin slice.
- Don't add new Telegram price-drop alert messages.
- Secrets live in Supabase → Edge Functions → Secrets, never in this repo. The publishable key in CONFIG is safe to keep (RLS protects the data).
- The screenshot import uses `claude-haiku-5-5` on purpose (cheapest model). Don't upgrade it unless reading accuracy is actually a problem.
