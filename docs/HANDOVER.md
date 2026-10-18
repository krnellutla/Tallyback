# TallyBack: handover to TinkerYard

**From:** the 100x hackathon session (BillShield problem) · **To:** the TinkerYard project · **Date:** 18 Oct 2026

TallyBack is a mobile web app. You snap any bill, it highlights the line that doesn't add up, and it writes one WhatsApp message to send. "AI reads, code decides": the model never computes a number. This note is everything needed to run it, own it, and put it on the bench at tinkeryard.dev.

---

## 1. Status at handover

| Area | State |
|---|---|
| App | Working end to end: scan → highlight → promise → verdict → message → WhatsApp → logged. My bills and "seen before" price history are done. |
| Tests | 21 passing (`npm test`), including real Gemini and Groq scans of hand-checked receipts |
| Repo | Public: https://github.com/krnellutla/Tallyback (branch `main`) |
| Hosting | Vercel, team `knellutla-org`, project `tallyback`, root directory `tallyback/`. Deploys on every push to `main`. |
| Database | Supabase project `billshield`: 5 tables, RLS on, private bucket `bills`. `schema.sql` and `migrations-001` both applied. |
| Live link | ⚠️ **Not confirmed.** `tallyback.vercel.app` served a different app ("deduction diagnostic for Canadian CPG brands") with `/api/scan` returning 404 at the time of writing. `tallyback-knellutla-org.vercel.app` sits behind Vercel login. See §6. |

## 2. Put it on tinkeryard.dev

**Target:** `https://tallyback.tinkeryard.dev`, the same pattern as `omni.`, `portfolix.` and `geo.`

1. Vercel → project `tallyback` → **Settings → Domains → Add** `tallyback.tinkeryard.dev`. If tinkeryard.dev's DNS is managed in Vercel (as for the other subdomains), it configures itself; otherwise add the CNAME Vercel shows.
2. **Settings → Deployment Protection → Vercel Authentication → Disabled for production.** Strangers must be able to open it without a Vercel login.
3. Check it: `curl -X POST https://tallyback.tinkeryard.dev/api/scan -F deviceId=check -F sample=1` should return JSON with `"merchant_name":"FairPrice Finest"`.
4. Update the "Try it" link in `README.md` to the new domain.
5. Add this card to `TinkerYard/index.html`, inside `<ul class="projects" id="list">` under "On the bench":

```html
<li data-s="running">
  <h3><a href="https://tallyback.tinkeryard.dev">TallyBack</a></h3>
  <p class="what">Snap any bill and it highlights the line that doesn't add up, then writes one WhatsApp message to send. The AI only reads the bill; code does every sum.</p>
  <span class="status"><svg viewBox="0 0 22 22" aria-hidden="true"><path d="M4 2v19" stroke="#16231F" stroke-width="2.4"/><path d="M5 3h14l-4 5 4 5H5z" fill="#2D6A3E"/></svg>Running</span>
  <p class="stack">tallyback.tinkeryard.dev &middot; Next.js, Gemini, Supabase</p>
</li>
```

Only mark it "Running" after step 3 passes.

## 3. How it's built (one screen)

```
Phone ──► Next.js API on Vercel (keys live here)
            ├─ readBill():  Gemini 3.8 → 3.5 → flash-latest (35 s budget) → Groq qwen3.8-27b (no boxes)
            ├─ normalize(): clean model JSON; tax added vs included decided by the printed numbers
            ├─ runChecks(): every check + verdict (pure, deterministic, also runs in the browser)
            ├─ message:     model writes {{placeholders}} → code fills → verifier rejects stray numbers → template fallback
            └─ store:       Supabase (or .data/db.json locally); masking before save; saving is best-effort
```

Key files: `tallyback/src/lib/checks.ts` (decides), `message.ts` (verifier), `llm.ts` (fallbacks), `store.ts` (data), `src/app/page.tsx` (whole UI). See `tallyback/README.md` for the full map.

**Data model:** `bills` 1–n `line_items`, plus `promises` (history as rows), `findings` and `messages`. The proof link the brief asks for is **`messages.line_item_id → line_items`**, with `sent_at` and `words_changed`. Identity is an anonymous `device_id` in localStorage, with no login.

## 4. Accounts, keys and where they live

Never commit or paste these. Names only:

| Secret | Where it's set | Where to rotate |
|---|---|---|
| `GEMINI_API_KEY` | `tallyback/.env.local`, Vercel env | aistudio.google.com/apikey |
| `GROQ_API_KEY` | same | console.groq.com/keys |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | same | Supabase → Project Settings → API Keys |

⚠️ **Rotate all three before going public on tinkeryard.dev.** They appeared in a working session's output on 18 Oct (they were never committed or pushed). After rotating, update both `.env.local` and Vercel, then redeploy.

## 5. Gotchas learned the hard way

1. **`*.vercel.app` names are global.** `tallyback.vercel.app` may belong to someone else. Use a tinkeryard subdomain.
2. **Supabase URL pasted with `/rest/v1/`** caused "Invalid path specified in request URL" and an empty-reply crash. The code now tolerates it; still prefer the base URL.
3. **Vercel blocks vulnerable Next.js.** We're on the patched 15.5.28 line. Next 16 would clear the remaining moderate audit notes.
4. **`gemini-2.5-flash` is closed to new keys.** List the models your key can use (`GET /v1beta/models`) instead of guessing.
5. **The free Gemini tier returns 503 "high demand"**, so the fallback chain matters. **Groq's free tier allows only ~1,000 output tokens a minute** (about one receipt), hence the compact Groq prompt and `max_tokens: 900`.
6. **Real bills broke our assumptions**, and each case is now a test:
   - Card payment rows printed *after* the total were subtracted from it (false S$56.95 "error").
   - Tax rates often aren't printed, so the legal rate is used for the arithmetic.
   - The model guessed tax "included" when it was added, so the printed numbers now decide.
   - Footer rows ("GST Summary") were counted as items, so only rows above the subtotal count.
   - Item names sometimes include the copied qty and price ("4. Carrot 0.88 2.46"), so they're stripped when matching history.
   - Shops print two WhatsApp numbers without a country code, so the first is kept and the dialling code added.
7. **Don't run two `next dev` servers in the same folder.** They share `.next/` and corrupt it.
8. **Claude Code auto-mode blocks creating public surfaces** (public repos, DNS changes). Expect to do those yourself in the dashboards.

## 6. Open items, in priority order

| # | Item | Why |
|---|---|---|
| 1 | Domain + turn off deployment protection (§2) | No working public link yet |
| 2 | Rotate keys (§4) | Precaution |
| 3 | Duplicate scans create two bills | Seen in testing; match on shop + date + total |
| 4 | `/api/sent` trusts the draft text the browser sends | Words-changed should come from the stored draft |
| 5 | Device-only identity | Clearing the browser loses My bills; add a magic-link login if it becomes a product |
| 6 | Follow-up questions ("Is 18% GST right?") | The brief's Move 2 points at memory/chat; not built |
| 7 | More tax rules (`taxRules.ts`) | Only SG, IN, GB, AU, NZ, AE are on file |
| 8 | Next 16 upgrade | Remaining moderate audit notes |

## 7. Hackathon context (if continuing the submission)

- Brief: BillShield, problem 1 of 3, 100xEngineers C8 Module 2. The win is **"they send the message"**, measured in words changed.
- Move 1 by-hand records: `docs/byhand-01-santhosh.md` (all OK), `docs/byhand-02-manish.md` (S$2.73 if the shelf prices included tax; check the receipts are real). Golden pairs: `docs/golden-pairs.csv` (3 of 10).
- Testers for Move 5 (Tue): Chetan (classmate), Manish and Santhosh (outside the cohort). They should test with bills the team **hasn't** seen.
- Receipt photos and the course PDFs are in the local `References/` folder (gitignored, not in the repo).
