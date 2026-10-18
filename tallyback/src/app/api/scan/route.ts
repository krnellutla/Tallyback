import { NextResponse } from "next/server";
import { llmEnabled, readBill } from "@/lib/llm";
import { saveBill, uploadImage } from "@/lib/store";
import sample from "@/lib/sample.json";
import type { Extraction } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const form = await req.formData();
  const deviceId = String(form.get("deviceId") ?? "anon");

  if (form.get("sample") === "1") {
    const ex = sample as unknown as Extraction;
    const { billId, lineIds } = await saveBill(deviceId, ex, null, "sample");
    return NextResponse.json({ billId, lineIds, extraction: ex });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!llmEnabled())
    return NextResponse.json({ error: "The server has no AI key yet. Try the sample receipt.", code: "no_key" }, { status: 503 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";
  try {
    const { extraction: ex, model } = await readBill(bytes.toString("base64"), mime);
    if (!ex.is_bill || !ex.lines.length)
      return NextResponse.json({ error: "That doesn't look like a bill. Try a clearer, flatter photo." }, { status: 422 });
    const { billId, lineIds } = await saveBill(deviceId, ex, null, model);
    // Store the image after we have a row to link it to. A storage hiccup must not lose the result.
    await uploadImage(billId, bytes, mime).catch((e) => console.error(e));
    return NextResponse.json({ billId, lineIds, extraction: ex });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("scan failed", msg);
    const quota = /429|503|quota|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand/i.test(msg);
    return NextResponse.json(
      { error: quota ? "The reader is busy right now. Wait a few seconds and try again." : "Couldn't read the bill. Try again." },
      { status: quota ? 429 : 500 },
    );
  }
}
