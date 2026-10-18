import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { CheckResult, Extraction, ExtractedLine, Promise as BillPromise } from "./types";
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

// Columns added by migrations-001; dropped on insert if the migration hasn't been run yet.
const OPTIONAL_COLS = ["box_2d", "merchant_contact"];

async function insert(table: string, rows: Row[]) {
  const s = supabase();
  if (!s) return localInsert(table, rows);
  let { error } = await s.from(table).insert(rows);
  if (error && OPTIONAL_COLS.some((c) => error!.message.includes(c))) {
    console.warn(`${table}: run supabase/migrations-001-my-bills.sql (${error.message})`);
    ({ error } = await s.from(table).insert(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !OPTIONAL_COLS.includes(k))))));
  }
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function localAll(): Promise<Record<string, Row[]>> {
  try {
    return JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  } catch {
    return {};
  }
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
      merchant_contact: ex.merchant_whatsapp,
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
        box_2d: l.box_2d,
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

// ---------- Reads for "My bills" ----------

export interface StoredBill {
  bill: Row;
  lines: Row[];
  promise: Row | null; // latest: history is rows, the newest one wins
  messages: Row[];
}

const num = (v: unknown) => (v == null ? null : Number(v));

export function toExtraction(bill: Row, lines: Row[]): Extraction {
  return {
    is_bill: true,
    merchant_name: (bill.merchant_name as string) ?? null,
    merchant_country: (bill.merchant_country as string) ?? null,
    merchant_whatsapp: (bill.merchant_contact as string) ?? null,
    bill_type: (bill.bill_type as string) ?? null,
    bill_number: (bill.bill_ref_masked as string) ?? null,
    bill_date: (bill.bill_date as string) ?? null,
    due_date: (bill.due_date as string) ?? null,
    period_start: null,
    period_end: null,
    currency: (bill.currency as string) ?? null,
    tax_mode: (bill.tax_mode as Extraction["tax_mode"]) ?? "unknown",
    printed_subtotal: num(bill.printed_subtotal),
    printed_tax_total: num(bill.printed_tax_total),
    printed_tax_rate_pct: num(bill.printed_tax_rate_pct),
    printed_total: num(bill.printed_total),
    lines: [...lines]
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map(
        (l): ExtractedLine => ({
          description: String(l.description ?? ""),
          plain_words: String(l.plain_words ?? ""),
          qty: num(l.qty),
          unit_price: num(l.unit_price),
          amount: Number(l.amount),
          kind: l.kind as ExtractedLine["kind"],
          tax_rate_pct: num(l.tax_rate_pct),
          box_2d: Array.isArray(l.box_2d) && l.box_2d.length === 4 ? (l.box_2d as ExtractedLine["box_2d"]) : null,
        }),
      ),
  };
}

export function toPromise(p: Row | null): BillPromise {
  return {
    expectedTotal: num(p?.expected_total),
    pricesIncludeTax: (p?.prices_include_tax as boolean | null) ?? null,
    paidOn: (p?.paid_on as string) ?? null,
    lineExpected: (p?.line_expected as Record<number, number>) ?? {},
    unrecognised: (p?.unrecognised as number[]) ?? [],
  };
}

const newest = (rows: Row[]) => [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

export async function listBills(deviceId: string, limit = 50): Promise<StoredBill[]> {
  const s = supabase();
  if (!s) {
    const db = await localAll();
    return newest((db.bills ?? []).filter((b) => b.device_id === deviceId))
      .slice(0, limit)
      .map((b) => ({
        bill: b,
        lines: (db.line_items ?? []).filter((l) => l.bill_id === b.id),
        promise: newest((db.promises ?? []).filter((p) => p.bill_id === b.id))[0] ?? null,
        messages: newest((db.messages ?? []).filter((m) => m.bill_id === b.id)),
      }));
  }
  const { data, error } = await s
    .from("bills")
    .select("*, line_items(*), promises(*), messages(*)")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`bills: ${error.message}`);
  return (data ?? []).map((b: Row) => {
    const { line_items, promises, messages, ...bill } = b as Row & { line_items: Row[]; promises: Row[]; messages: Row[] };
    return { bill, lines: line_items ?? [], promise: newest(promises ?? [])[0] ?? null, messages: newest(messages ?? []) };
  });
}

export async function getBill(id: string, deviceId: string): Promise<StoredBill | null> {
  const all = await listBills(deviceId, 200);
  return all.find((b) => b.bill.id === id) ?? null;
}

export async function signedImageUrl(imagePath: unknown): Promise<string | null> {
  const s = supabase();
  if (!s || typeof imagePath !== "string" || imagePath.endsWith(".pdf")) return null;
  const { data } = await s.storage.from("bills").createSignedUrl(imagePath, 3600);
  return data?.signedUrl ?? null;
}

// Earlier lines from the same shop, on this device, for "has this shown up before?"
export async function pastLines(deviceId: string, merchant: string | null, excludeBillId: string) {
  if (!merchant) return [];
  const all = await listBills(deviceId, 200);
  const key = merchant.trim().toLowerCase();
  return all
    .filter((b) => b.bill.id !== excludeBillId && String(b.bill.merchant_name ?? "").trim().toLowerCase() === key)
    .flatMap((b) => toExtraction(b.bill, b.lines).lines.map((l) => ({ ...l, bill_date: (b.bill.bill_date as string) ?? String(b.bill.created_at).slice(0, 10) })));
}
