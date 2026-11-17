# CC Portfolio Desk

Portfolio tracker for the ~250-member CC Telegram group. Members log trades; Dkay reviews each portfolio and leaves feedback. Plain HTML/JS, no build step. Hosted on GitHub Pages (pushing to `main` = deploying). Backend: Supabase project `cc-portfolio`. Opens inside Telegram as a Mini App via @CCPortfolioManagerBot.

## Files
- `index.html`: shell only (CDN libraries + links to the two files below).
- `css/app.css`: all styles (~25 KB).
- `js/app.js`: all app logic (~245 KB, ~3,000 lines). **Never read it whole.**
- `supabase/functions/*`: backups of the deployed Edge Functions (see their README).
- `supabase/*.sql`: migrations that have already been applied.

## How to work efficiently (read this first)
1. Find the section in the map below, `grep -n` for the exact function, then `Read` only that range (offset/limit). Don't read whole files and don't scan the repo.
2. Line numbers drift. Search for the section header (e.g. `grep -n "MEMBER: TRADES" js/app.js`) instead of trusting them.
3. Make targeted `Edit`s. Don't rewrite big blocks.
4. Before committing: `node --check js/app.js`.
5. After changing `css/app.css` or `js/app.js`, bump `?v=` in `index.html` to today's date (YYYYMMDD). Otherwise Telegram and browsers keep serving the cached old version.
6. When adding a new section, use the same `/* ===== NAME ===== */` header style and add it to the map below.
7. Debug by looking, not guessing: print or query the real values first (console output, a Supabase SQL query, the function logs), then fix.
8. No test suites. Verification is `node --check js/app.js` plus checking the changed screen on the live site. Keep every check under a minute.
9. Keep this file short. It should only hold what the code doesn't already make obvious. Update the map when sections move, and cut stale notes.
10. When you deploy or change an Edge Function, copy the code into `supabase/functions/<name>/index.ts` and update that README.

## js/app.js map (approximate starting lines)
| Line | Section |
|---|---|
| 1 | CONFIG (Supabase URL/publishable key, REVIEWER_NAME) |
| 14 | UTILITIES |
| 93 | ATTACHMENTS (charts, voice notes, videos, PDFs on Dkay's messages) |
| 170 | COINGECKO |
| 248 | PORTFOLIO MATH (average cost) |
| 287 | DATA LAYER (all Supabase reads/writes) |
| 452 | STATE |
| 465 | CHARTS / 493 DELTA-STYLE CHARTS |
| 635 | Live prices: Coinbase (BTC/ETH) + MEXC via `prices` function, CoinGecko fallback |
| 684 | Chart helpers (price tag, axes, tooltips) |
| 710 | Price charts (BTC, ETH, group coins) |
| 824 | SHELL (tabs, navigation) |
| 894 | MEMBER: OVERVIEW |
| 958 | MEMBER: TRADES, trade modal (1055), screenshot import (1155), CSV import (1286) |
| 1599 | FEEDBACK THREAD |
| 1653 | PROJECTIONS |
| 1782 | MEMBER: PROFILE |
| 1816 | MODEL PORTFOLIO (Dkay's target mix) |
| 1923 | MARKET ALERTS / 1952 GROUP TOTAL |
| 1964 | MEMBER: REBALANCE (add-only) |
| 2062 | ADMIN: MODEL EDITOR |
| 2142 | MARKET UPDATES (weekly summary + urgent bids) |
| 2236 | EXIT PLAN |
| 2543 | ADMIN: BROADCAST |
| 2625 | ADMIN DATA / 2647 REVIEW QUEUE / 2706 MEMBER DETAIL / 2854 GROUP INSIGHTS |
| 2891 | AUTH |
| 2943 | BOOT / 2975 TELEGRAM MINI APP / 2993 MOBILE KEYBOARD |

css/app.css: THEME 1, LAYOUT 50, CONTROLS 81, TABLES 111, CHART 133, THREAD 144, MODAL/AUTH 166, DELTA-STYLE COMPONENTS 249.

## Product rules
- The name is spelled "Dkay", never "DKay".
- Coins are shown by ticker only (TET, ACN, PAAL, VELO, OTK…), not full names.
- Members always open on the Portfolio tab. Profile is the last tab.
- Charts show the live price and must be readable and tappable straight away.
- Model portfolio: TET 40% and ACN 30% are fixed. The other 30% is split however the member likes across PAAL/VELO/OTK. No stablecoin slice.
- Don't add new Telegram price-drop alert messages.
- Secrets live in Supabase → Edge Functions → Secrets, never in this repo. The publishable key in CONFIG is safe to keep (RLS protects the data).
- The screenshot import uses `claude-haiku-5-5` on purpose (cheapest model). Don't upgrade it unless reading accuracy is actually a problem.
