# Edge Functions (backup of what's deployed on Supabase project `cc-portfolio`)

| Function | Verify JWT | What it does | Secrets it needs |
|---|---|---|---|
| `prices` | on | Live MEXC prices for the alts, cached 5s for everyone | none |
| `import-screenshot` | off (checks the member's session itself) | Reads portfolio screenshots with Claude | `ANTHROPIC_API_KEY` (opt. `ANTHROPIC_MODEL`, `IMPORT_DAILY_LIMIT`) |
| `tg-link` | on | Links a member to their Telegram chat; sends CSV exports to their bot chat | `TELEGRAM_BOT_TOKEN` |
| `tg-notify` | off (called by database triggers) | Telegram messages for feedback, review requests, updates, price checks | `TELEGRAM_BOT_TOKEN` |

Secret values live in Supabase → Edge Functions → Secrets, never in this repo.
Backed up 2026-11-17 from the live versions (prices v2, import-screenshot v6, tg-link v5, tg-notify v11).
