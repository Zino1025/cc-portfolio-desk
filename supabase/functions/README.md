# Edge Functions (backup of what's deployed on Supabase project `cc-portfolio`)

| Function | Verify JWT | What it does | Secrets it needs |
|---|---|---|---|
| `prices` | on | Live MEXC prices for the alts, cached 5s for everyone | none |
| `import-screenshot` | off (checks the member's session itself) | Reads portfolio screenshots with Claude | `ANTHROPIC_API_KEY` (opt. `ANTHROPIC_MODEL`, `IMPORT_DAILY_LIMIT`) |
| `tg-link` | on | Links a member to their Telegram chat, checks CC group membership; sends CSV/PNG files to their bot chat | `TELEGRAM_BOT_TOKEN` |
| `tg-notify` | off (called by database triggers + hourly `tp-check` cron) | Telegram messages for feedback, review requests, bug/idea tickets (new → `gets_tickets` admins only; marked done → the reporter), updates, signals (new signal + analyst updates → Signals/Both members, Signals Admins, admins), price checks, exit-plan TP pings; re-checks group membership | `TELEGRAM_BOT_TOKEN` |
| `tg-bot` | off (Telegram webhook, checks its secret header) | Members log trades by text or screenshot in the bot chat; `/setgroup` in the CC group; `/home` → Telegram shortcut or Safari app buttons (`?setup=1` also registers the / command list); `/start login_<nonce>` → Approve writes `tg_logins`. If one Telegram account is linked to several Desk accounts, uses the most recently updated profile. `GET ?setup=1` sets the webhook, `?info=1` shows it | `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY` |
| `tg-login` | off (no session yet; the nonce is the secret) | Home-screen app polls with its nonce; once approved in the bot, returns a one-time magic-link `token_hash` for `verifyOtp` (no email sent) | none |

Secret values live in Supabase → Edge Functions → Secrets, never in this repo.
Backed up 2026-11-18 from the live versions (prices v2, import-screenshot v6, tg-link v6, tg-notify v14 (2026-11-19), tg-bot v1). 2026-11-20: tg-bot v6, tg-login v1 (Sign in with Telegram). 2026-11-21: tg-bot v7 (/home), tg-notify v17 (Signals; the poster gets a copy; edit pings).
