# TallyBack: developer notes

User-facing overview: [../README.md](../README.md). Handover: [../docs/HANDOVER.md](../docs/HANDOVER.md).

## Run
```bash
cp .env.example .env.local   # GEMINI_API_KEY required; GROQ_API_KEY and SUPABASE_* optional
npm install
npm run dev                  # http://localhost:3000
npm test                     # node:test via tsx: checker, verifier, history, real scans
npm run build
```
Without any AI key, only "Try a sample receipt" works. Without Supabase, rows go to `.data/db.json` and photos aren't kept.

## Environment
| Variable | Needed | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | Main reader and writer |
| `GEMINI_MODEL` | no | Default `gemini-3.8-flash`; falls back to `gemini-3.5-flash`, then `gemini-flash-latest` |
| `GROQ_API_KEY` | no | Backup when Gemini fails or is busy |
| `GROQ_MODEL` / `GROQ_TEXT_MODEL` | no | Defaults `qwen/qwen3.8-27b` (vision) / `openai/gpt-oss-20b` (messages) |
| `SUPABASE_URL` | no | Base project URL. Quotes, a trailing slash or `/rest/v1` are tolerated |
| `SUPABASE_SERVICE_ROLE_KEY` | no | Secret key, server only. Never prefix with `NEXT_PUBLIC_` |

## Where things live
| Piece | Runs on | File |
|---|---|---|
| UI: capture, highlights, promise, verdict, message, My bills | phone browser | `src/app/page.tsx` |
| API (keys stay here) | Vercel functions | `src/app/api/{scan,check,message,sent,bills}` |
| AI with fallbacks: Gemini → Groq | Google / Groq | `src/lib/llm.ts`, `gemini.ts`, `groq.ts`, `prompts.ts` |
| Clean-up of model JSON; tax mode decided from numbers | server | `src/lib/normalize.ts` |
| **Code decides**: all checks and verdicts | server + browser | `src/lib/checks.ts`, `taxRules.ts`, `money.ts` |
| Message fill, number verifier, words changed | server | `src/lib/message.ts` |
| "Seen before" price history | server | `src/lib/history.ts`, `billView.ts` |
| Storage (Supabase or local JSON), masking | server | `src/lib/store.ts`, `mask.ts` |
| Every reply is JSON; saving is best-effort | server | `src/lib/route.ts` |
| Schema / migrations | Supabase | `supabase/schema.sql`, `supabase/migrations-001-my-bills.sql` |

## Verdicts
- **wrong**: provable by code (line maths, totals, tax arithmetic, legal rate, above the promise, late fee paid on time) → ask for a refund.
- **unexplained**: the user doesn't recognise the line, or a fee repeats → ask them to explain and reverse.
- **info**: worth knowing, never messaged (an old rate that undercharged you, "did the shelf price include tax?").

## Adding a golden pair
Save a real extraction to `tests/fixtures/<name>.json` (copy `extraction` from an `/api/scan` response) and assert the verdict you reached by hand in `tests/real-scans.test.ts`.
