# Edge Functions (backup of what's deployed on Supabase project `cc-portfolio`)

| Function | Verify JWT | What it does | Secrets it needs |
|---|---|---|---|
| `prices` | on | Live MEXC prices for the alts, cached 5s for everyone | none |
| `import-screenshot` | off (checks the member's session itself) | Reads portfolio screenshots with Claude | `ANTHROPIC_API_KEY` (opt. `ANTHROPIC_MODEL`, `IMPORT_DAILY_LIMIT`) |
| `tg-link` | on | Links a member to their Telegram chat, checks CC group membership; sends CSV/PNG files to their bot chat | `TELEGRAM_BOT_TOKEN` |
| `tg-notify` | off (called by database triggers + hourly `tp-check` cron) | Telegram messages for feedback, review requests, updates, price checks, exit-plan TP pings; re-checks group membership | `TELEGRAM_BOT_TOKEN` |
| `tg-bot` | off (Telegram webhook, checks its secret header) | Members log trades by text or screenshot in the bot chat; `/setgroup` in the CC group. `GET ?setup=1` sets the webhook, `?info=1` shows it | `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY` |

Secret values live in Supabase → Edge Functions → Secrets, never in this repo.
Backed up 2026-11-18 from the live versions (prices v2, import-screenshot v6, tg-link v6, tg-notify v12, tg-bot v1).
