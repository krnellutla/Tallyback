import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { CheckResult, Extraction, Promise as BillPromise } from "./types";
import { maskDigits } from "./mask";

// Supabase when configured; otherwise a local JSON file so the app runs with zero setup.
let sb: SupabaseClient | null | undefined;
function supabase() {
  if (sb !== undefined) return sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  sb = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return sb;
}

type Row = Record<string, unknown>;
const DB_FILE = path.join(process.env.VERCEL ? os.tmpdir() : process.cwd(), ".data", "db.json");

async function localInsert(table: string, rows: Row[]) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  let db: Record<string, Row[]> = {};
  try {
    db = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  } catch {}
  db[table] = [...(db[table] ?? []), ...rows];
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

async function localUpdate(table: string, id: string, patch: Row) {
  const db: Record<string, Row[]> = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  db[table] = (db[table] ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r));
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

async function insert(table: string, rows: Row[]) {
  const s = supabase();
  if (!s) return localInsert(table, rows);
  const { error } = await s.from(table).insert(rows);
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function update(table: string, id: string, patch: Row) {
  const s = supabase();
  if (!s) return localUpdate(table, id, patch);
  const { error } = await s.from(table).update(patch).eq("id", id);
  if (error) throw new Error(`${table}: ${error.message}`);
}

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

export async function uploadImage(billId: string, bytes: Buffer, mime: string): Promise<string | null> {
  const s = supabase();
  if (!s) return null; // local mode: we don't keep the image
  const ext = mime.includes("pdf") ? "pdf" : "jpg";
  const p = `${billId}.${ext}`;
  const { error } = await s.storage.from("bills").upload(p, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(`storage: ${error.message}`);
  await update("bills", billId, { image_path: p }); // the row keeps the link to the file
  return p;
}

export async function saveBill(deviceId: string, ex: Extraction, imagePath: string | null, model: string) {
  const billId = uuid();
  await insert("bills", [
    {
      id: billId,
      device_id: deviceId,
      merchant_name: ex.merchant_name,
      merchant_country: ex.merchant_country,
      bill_type: ex.bill_type,
      bill_ref_masked: maskDigits(ex.bill_number),
      bill_date: ex.bill_date,
      due_date: ex.due_date,
      currency: ex.currency,
      tax_mode: ex.tax_mode,
      printed_subtotal: ex.printed_subtotal,
      printed_tax_total: ex.printed_tax_total,
      printed_tax_rate_pct: ex.printed_tax_rate_pct,
      printed_total: ex.printed_total,
      image_path: imagePath,
      model,
      created_at: now(),
    },
  ]);
  const lineIds = ex.lines.map(() => uuid());
  if (ex.lines.length)
    await insert(
      "line_items",
      ex.lines.map((l, i) => ({
        id: lineIds[i],
        bill_id: billId,
        position: i,
        description: maskDigits(l.description),
        plain_words: l.plain_words,
        qty: l.qty,
        unit_price: l.unit_price,
        amount: l.amount,
        kind: l.kind,
        tax_rate_pct: l.tax_rate_pct,
      })),
    );
  return { billId, lineIds };
}

export async function saveCheck(billId: string, deviceId: string, lineIds: string[], promise: BillPromise, result: CheckResult) {
  // Promises are rows, so "what was I promised, and when did it change?" is a query.
  await insert("promises", [
    {
      id: uuid(),
      bill_id: billId,
      device_id: deviceId,
      expected_total: promise.expectedTotal,
      prices_include_tax: promise.pricesIncludeTax,
      paid_on: promise.paidOn,
      line_expected: promise.lineExpected,
      unrecognised: promise.unrecognised,
      created_at: now(),
    },
  ]);
  const ids: Record<string, string> = {};
  const rows = result.findings.map((f) => {
    const id = uuid();
    ids[f.id] = id;
    return {
      id,
      bill_id: billId,
      line_item_id: f.lineIndex != null ? (lineIds[f.lineIndex] ?? null) : null,
      code: f.id,
      verdict: f.verdict,
      title: f.title,
      maths: f.maths,
      charged: f.charged,
      expected: f.expected,
      diff: f.diff,
      created_at: now(),
    };
  });
  if (rows.length) await insert("findings", rows);
  return ids;
}

export async function saveDraft(m: {
  billId: string;
  lineItemId: string | null;
  findingId: string | null;
  text: string;
  source: "model" | "template";
}) {
  const id = uuid();
  await insert("messages", [
    {
      id,
      bill_id: m.billId,
      line_item_id: m.lineItemId, // the proof link: message → line_item
      finding_id: m.findingId,
      drafted_text: m.text,
      drafted_by: m.source,
      created_at: now(),
    },
  ]);
  return id;
}

export async function markSent(messageId: string, sentText: string, wordsChanged: number, channel: string) {
  await update("messages", messageId, { sent_text: sentText, words_changed: wordsChanged, channel, sent_at: now() });
}
