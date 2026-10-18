"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runChecks } from "@/lib/checks";
import { allClearSummary } from "@/lib/message";
import { fmt } from "@/lib/money";
import type { Extraction, Finding, Promise as BillPromise } from "@/lib/types";

type Stage = "start" | "scanning" | "review";

const EMPTY_PROMISE: BillPromise = { expectedTotal: null, pricesIncludeTax: null, paidOn: null, lineExpected: {}, unrecognised: [] };

function deviceId(): string {
  try {
    let id = localStorage.getItem("bs-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("bs-device", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

// Phone photos are 3–8 MB; shrink before upload so serverless limits and the free tier are happy.
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.85));
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("start");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(false);
  const [billId, setBillId] = useState("");
  const [lineIds, setLineIds] = useState<string[]>([]);
  const [ex, setEx] = useState<Extraction | null>(null);
  const [promise, setPromise] = useState<BillPromise>(EMPTY_PROMISE);
  const [selected, setSelected] = useState<number | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  // Code decides, live, as the user tells us what they were promised.
  const result = useMemo(() => (ex ? runChecks(ex, promise) : null), [ex, promise]);
  const flagged = useMemo(() => {
    const m = new Map<number, Finding["verdict"]>();
    result?.findings.forEach((f) => {
      if (f.lineIndex == null) return;
      const prev = m.get(f.lineIndex);
      if (prev !== "wrong") m.set(f.lineIndex, f.verdict === "info" && prev ? prev : f.verdict);
    });
    return m;
  }, [result]);

  async function scan(file: File | null, sample = false) {
    setError(null);
    setStage("scanning");
    setPromise(EMPTY_PROMISE);
    setSelected(null);
    const fd = new FormData();
    fd.append("deviceId", deviceId());
    if (sample) {
      fd.append("sample", "1");
      setPreview("/sample-receipt.jpg");
      setIsPdf(false);
    } else if (file) {
      const pdf = file.type === "application/pdf";
      setIsPdf(pdf);
      setPreview(pdf ? null : URL.createObjectURL(file));
      const blob = await shrink(file);
      fd.append("file", blob, pdf ? file.name : "bill.jpg");
    }
    try {
      const r = await fetch("/api/scan", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Something went wrong");
      setEx(j.extraction);
      setBillId(j.billId);
      setLineIds(j.lineIds);
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("start");
    }
  }

  function reset() {
    setStage("start");
    setEx(null);
    setPreview(null);
    setError(null);
  }

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pb-24 pt-6">
      <header className="mb-6 flex items-center justify-between">
        <button onClick={reset} className="flex items-center gap-2.5 text-left">
          <Logo />
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-semibold tracking-tight">TallyBack</span>
            <span className="text-xs text-muted">One place to store your bills for the future</span>
          </span>
        </button>
        {stage === "review" && (
          <button onClick={reset} className="text-sm text-muted underline underline-offset-4">
            New bill
          </button>
        )}
      </header>

      {stage === "start" && (
        <section>
          <h1 className="text-[1.9rem] font-semibold leading-tight tracking-tight">
            A bill you don&apos;t trust, turned into one message worth sending.
          </h1>
          <p className="mt-3 text-muted">
            Snap any bill or receipt. We check every line and the maths, show you the line that doesn&apos;t add up, and write the message. Every number comes from code, not AI.
          </p>
          <div className="mt-8 grid gap-3">
            <button onClick={() => cameraRef.current?.click()} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-ink text-base font-medium text-white active:scale-[.99]">
              <CameraIcon /> Take a photo of the bill
            </button>
            <button onClick={() => uploadRef.current?.click()} className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-line bg-card text-base font-medium active:scale-[.99]">
              <UploadIcon /> Upload photo or PDF
            </button>
            <button onClick={() => scan(null, true)} className="mt-1 text-sm text-muted underline underline-offset-4">
              No bill handy? Try a sample receipt
            </button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && scan(e.target.files[0])} />
          <input ref={uploadRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => e.target.files?.[0] && scan(e.target.files[0])} />
          {error && <p className="mt-6 rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p>}
          <p className="mt-10 text-xs text-muted">We never store account numbers, phone numbers or addresses.</p>
        </section>
      )}

      {stage === "scanning" && (
        <section className="flex flex-col items-center pt-10 text-center">
          {preview && <img src={preview} alt="" className="max-h-72 rounded-xl opacity-60 shadow" />}
          <div className="mt-6 h-1.5 w-40 overflow-hidden rounded-full bg-line">
            <div className="h-full w-1/3 animate-[pulse_1s_ease-in-out_infinite] rounded-full bg-ink" />
          </div>
          <p className="mt-4 text-muted">Reading every line…</p>
        </section>
      )}

      {stage === "review" && ex && result && (
        <Review
          ex={ex}
          setEx={setEx}
          preview={isPdf ? null : preview}
          result={result}
          flagged={flagged}
          promise={promise}
          setPromise={setPromise}
          selected={selected}
          setSelected={setSelected}
          billId={billId}
          lineIds={lineIds}
        />
      )}
    </main>
  );
}

function Review(props: {
  ex: Extraction;
  setEx: (e: Extraction) => void;
  preview: string | null;
  result: NonNullable<ReturnType<typeof runChecks>>;
  flagged: Map<number, Finding["verdict"]>;
  promise: BillPromise;
  setPromise: (p: BillPromise) => void;
  selected: number | null;
  setSelected: (i: number | null) => void;
  billId: string;
  lineIds: string[];
}) {
  const { ex, result, flagged, promise, setPromise, selected, setSelected } = props;
  const cur = ex.currency ?? "";
  const p = result.primary;
  const infos = result.findings.filter((f) => f.verdict === "info");
  const showPaidOn = ex.lines.some((l) => l.kind === "late_fee") || !!ex.due_date;
  const showInclusive = ex.tax_mode === "added" && (ex.printed_tax_total ?? 0) > 0;

  return (
    <section className="space-y-5">
      {/* Bill with highlighted rows */}
      <div className="rounded-2xl border border-line bg-card p-3">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <div>
            <p className="font-medium">{ex.merchant_name ?? "Bill"}</p>
            <p className="text-xs text-muted">
              {[ex.bill_type, ex.bill_date, ex.bill_number].filter(Boolean).join(" · ")}
            </p>
          </div>
          {ex.printed_total != null && <p className="font-mono text-lg font-semibold">{fmt(ex.printed_total, cur)}</p>}
        </div>
        {props.preview && (
          <div className="relative overflow-hidden rounded-xl">
            <img src={props.preview} alt="Your bill" className="block w-full" />
            {ex.lines.map((l, i) => {
              const v = flagged.get(i);
              if (!l.box_2d || (!v && selected !== i)) return null;
              const [y0, x0, y1, x1] = l.box_2d;
              const cls =
                v === "wrong"
                  ? "border-bad bg-bad/15 box-bad"
                  : v === "unexplained"
                    ? "border-bad bg-bad/10"
                    : v === "info"
                      ? "border-warn bg-warn/15"
                      : "border-ink bg-ink/10";
              return (
                <button
                  key={i}
                  aria-label={l.description}
                  onClick={() => setSelected(i)}
                  className={`absolute rounded-md border-2 ${cls}`}
                  style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%` }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Verdict */}
      {p ? (
        <div className={`rounded-2xl p-4 ${p.verdict === "wrong" ? "bg-bad-soft" : "bg-warn-soft"}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider ${p.verdict === "wrong" ? "text-bad" : "text-warn"}`}>
            {p.verdict === "wrong" ? "Doesn't add up" : "Unexplained charge"}
          </p>
          <p className="mt-1 text-xl font-semibold leading-snug">{p.title}</p>
          <p className="mt-2 font-mono text-sm">{p.maths}</p>
          {p.diff > 0 && (
            <p className="mt-3 text-sm">
              You could get back <span className="font-mono text-base font-semibold">{fmt(p.diff, cur)}</span>
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-2xl bg-good-soft p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-good">Every line checks out</p>
          <p className="mt-1 text-xl font-semibold">Nothing to dispute{infos.length ? " yet" : ""}.</p>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-relaxed">{allClearSummary(result)}</pre>
        </div>
      )}

      {infos.map((f) => (
        <div key={f.id} className="rounded-2xl border border-warn/30 bg-warn-soft/60 p-3 text-sm">
          <p className="font-medium">{f.title}</p>
          <p className="mt-1 text-muted">{f.maths}</p>
        </div>
      ))}

      {/* Promise */}
      <div className="rounded-2xl border border-line bg-card p-4">
        <p className="font-medium">What were you promised?</p>
        <p className="text-sm text-muted">Plan price, shelf price, quote, menu, or just what you expected to pay.</p>
        <label className="mt-4 block text-sm">
          Expected total ({cur || "amount"})
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder={ex.printed_total != null ? String(ex.printed_total) : "0.00"}
            value={promise.expectedTotal ?? ""}
            onChange={(e) => setPromise({ ...promise, expectedTotal: e.target.value === "" ? null : Number(e.target.value) })}
            className="mt-1 h-12 w-full rounded-xl border border-line bg-paper px-3 font-mono text-base"
          />
        </label>
        {showInclusive && (
          <div className="mt-4 text-sm">
            Did the shelf / menu prices already include tax?
            <div className="mt-2 grid grid-cols-3 gap-2">
              {([
                ["Yes", true],
                ["No", false],
                ["Not sure", null],
              ] as const).map(([label, val]) => (
                <button
                  key={label}
                  onClick={() => setPromise({ ...promise, pricesIncludeTax: val })}
                  className={`h-10 rounded-xl border ${promise.pricesIncludeTax === val ? "border-ink bg-ink text-white" : "border-line bg-paper"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {showPaidOn && (
          <label className="mt-4 block text-sm">
            When did you pay your last bill?
            <input
              type="date"
              value={promise.paidOn ?? ""}
              onChange={(e) => setPromise({ ...promise, paidOn: e.target.value || null })}
              className="mt-1 h-12 w-full rounded-xl border border-line bg-paper px-3"
            />
          </label>
        )}
      </div>

      {/* Lines */}
      <div className="rounded-2xl border border-line bg-card">
        <p className="px-4 pt-4 font-medium">Every line</p>
        <p className="px-4 text-sm text-muted">Tap a line you don&apos;t recognise or that was meant to cost less.</p>
        <ul className="mt-2 divide-y divide-line">
          {ex.lines.map((l, i) => {
            const v = flagged.get(i);
            const open = selected === i;
            const isCharge = !["subtotal", "total", "payment", "rounding"].includes(l.kind);
            return (
              <li key={i} className={v === "wrong" || v === "unexplained" ? "bg-bad-soft" : v === "info" ? "bg-warn-soft/60" : ""}>
                <button onClick={() => setSelected(open ? null : i)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${l.kind === "total" || l.kind === "subtotal" ? "font-semibold" : ""}`}>{l.description}</p>
                    <p className="truncate text-xs text-muted">
                      {l.qty != null && l.unit_price != null && l.kind === "item" ? `${l.qty} × ${fmt(l.unit_price, cur)} · ` : ""}
                      {l.plain_words}
                    </p>
                  </div>
                  <span className={`font-mono text-sm ${v === "wrong" || v === "unexplained" ? "font-semibold text-bad" : ""}`}>{fmt(l.amount, cur)}</span>
                </button>
                {open && isCharge && (
                  <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-sm">
                    <button
                      onClick={() => {
                        const has = promise.unrecognised.includes(i);
                        setPromise({ ...promise, unrecognised: has ? promise.unrecognised.filter((x) => x !== i) : [...promise.unrecognised, i] });
                      }}
                      className={`h-9 rounded-lg border px-3 ${promise.unrecognised.includes(i) ? "border-bad bg-bad text-white" : "border-line bg-card"}`}
                    >
                      I don&apos;t recognise this
                    </button>
                    <span className="text-muted">or should cost</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder="0.00"
                      value={promise.lineExpected[i] ?? ""}
                      onChange={(e) => {
                        const le = { ...promise.lineExpected };
                        if (e.target.value === "") delete le[i];
                        else le[i] = Number(e.target.value);
                        setPromise({ ...promise, lineExpected: le });
                      }}
                      className="h-9 w-24 rounded-lg border border-line bg-paper px-2 font-mono"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <details className="rounded-2xl border border-line bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">Show all the maths</summary>
        <ul className="mt-3 space-y-2">
          {result.checks.map((c) => (
            <li key={c.name} className="flex gap-2">
              <span className={c.ok === null ? "text-muted" : c.ok ? "text-good" : "text-bad"}>{c.ok === null ? "–" : c.ok ? "✓" : "✗"}</span>
              <span>
                <span className="font-medium">{c.name}.</span> <span className="font-mono text-xs">{c.maths}</span>
              </span>
            </li>
          ))}
        </ul>
      </details>

      {p && <MessagePanel key={p.id} {...props} finding={p} />}
    </section>
  );
}

function MessagePanel(props: {
  ex: Extraction;
  promise: BillPromise;
  finding: Finding;
  billId: string;
  lineIds: string[];
}) {
  const { ex, promise, finding, billId, lineIds } = props;
  const [tone, setTone] = useState<"polite" | "firm">("polite");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafted, setDrafted] = useState("");
  const [text, setText] = useState("");
  const [messageId, setMessageId] = useState("");
  const [phone, setPhone] = useState(ex.merchant_whatsapp?.replace(/\D/g, "") ?? "");
  const [sent, setSent] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDrafted("");
    setText("");
    setSent(null);
  }, [finding.id, finding.diff]);

  async function draft() {
    setBusy(true);
    setErr(null);
    try {
      const deviceIdVal = (() => {
        try {
          return localStorage.getItem("bs-device") ?? "anon";
        } catch {
          return "anon";
        }
      })();
      const c = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billId, deviceId: deviceIdVal, lineIds, extraction: ex, promise }),
      }).then((r) => r.json());
      const r = await fetch("/api/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billId, lineIds, findingDbIds: c.findingIds, extraction: ex, promise, findingId: finding.id, tone, note }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setDrafted(j.text);
      setText(j.text);
      setMessageId(j.messageId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function logSent(channel: string) {
    const r = await fetch("/api/sent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId, drafted, sentText: text, channel }),
    }).then((r) => r.json());
    setSent(r.wordsChanged ?? 0);
  }

  function whatsapp() {
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    logSent("whatsapp");
    window.open(url, "_blank");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
    logSent("copied");
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="font-medium">Your message</p>
      {!drafted ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {(["polite", "firm"] as const).map((t) => (
              <button key={t} onClick={() => setTone(t)} className={`h-10 rounded-xl border capitalize ${tone === t ? "border-ink bg-ink text-white" : "border-line bg-paper"}`}>
                {t}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything to add, in your words? (optional)"
            className="mt-3 h-12 w-full rounded-xl border border-line bg-paper px-3 text-sm"
          />
          <button onClick={draft} disabled={busy} className="mt-3 h-12 w-full rounded-xl bg-ink font-medium text-white disabled:opacity-60">
            {busy ? "Writing…" : "Write the message"}
          </button>
          {err && <p className="mt-2 text-sm text-bad">{err}</p>}
        </>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            className="mt-3 w-full rounded-xl border border-line bg-paper p-3 text-[15px] leading-relaxed"
          />
          <p className="mt-1 text-xs text-muted">Edit freely. Every amount above was computed by code.</p>
          <label className="mt-4 block text-sm">
            Send to (WhatsApp number with country code, or leave blank to pick a contact)
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="tel"
              placeholder="e.g. 6598444327"
              className="mt-1 h-12 w-full rounded-xl border border-line bg-paper px-3 font-mono"
            />
          </label>
          <button onClick={whatsapp} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-wa font-medium text-white">
            <WaIcon /> Send on WhatsApp
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <button onClick={copy} className="h-10 rounded-xl border border-line bg-paper">
              Copy text
            </button>
            <button onClick={() => logSent("other")} className="h-10 rounded-xl border border-line bg-paper">
              I sent it another way
            </button>
          </div>
          {sent !== null && (
            <p className="mt-3 rounded-xl bg-good-soft p-3 text-sm text-good">
              Logged as sent · {sent} word{sent === 1 ? "" : "s"} changed from the draft.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// A receipt with a return arrow: tally the bill, get it back.
const Logo = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M5 2.5h14v19l-2.33-1.5-2.34 1.5L12 20l-2.33 1.5L7.33 20 5 21.5v-19Z" fill="#1c1b19" />
    <path d="M14.5 9.5H10a2 2 0 0 0 0 4h4.5M12.5 7.5l2 2-2 2" stroke="#f6f4ef" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CameraIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
const UploadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M12 16V4m0 0-4 4m4-4 4 4M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const WaIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.2Z" />
  </svg>
);
