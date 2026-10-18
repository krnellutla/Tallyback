# TallyBack

*One place to store your bills for the future.*

Snap any bill or receipt → see the line that doesn't add up → send one message on WhatsApp.
Built for the 100xEngineers Cohort 8 hackathon, problem 1: **BillShield**.

**The rule:** the model reads the bill and writes the words; **code computes every number**.
A verifier rejects any number in the message that code didn't produce, and falls back to a code template.

## Run
```bash
cp .env.example .env.local   # add GEMINI_API_KEY (free at aistudio.google.com/apikey)
npm install
npm run dev                  # http://localhost:3000, open on your phone via the same Wi-Fi IP
npm test                     # golden-pair tests for the checker
```
Without a key, use "Try a sample receipt".

## Where things live
| Piece | Machine | File |
|---|---|---|
| UI (camera/upload, highlights, message, WhatsApp) | user's phone | `src/app/page.tsx` |
| Server (key lives here) | Vercel | `src/app/api/*` |
| LLM: photo → lines + boxes; message prose with `{{placeholders}}` | Google | `src/lib/gemini.ts` |
| Code decides: line maths, totals, tax, legal rate, promise, late fee, duplicates | server + browser | `src/lib/checks.ts`, `src/lib/taxRules.ts` |
| Message fill + verifier + words-changed | server | `src/lib/message.ts` |
| DB (bills, line_items, promises, findings, messages→line_item) | Supabase | `supabase/schema.sql`, `src/lib/store.ts` |

## Wrong vs unexplained
- **wrong**: code can prove it (maths, legal tax rate, above the promise, late fee paid on time) → ask for a refund.
- **unexplained**: the user doesn't recognise a line, or it repeats → ask them to explain and reverse.
- **info**: worth knowing, not worth a message (e.g. an old tax rate that undercharged you).
