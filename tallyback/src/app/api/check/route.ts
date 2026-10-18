import { NextResponse } from "next/server";
import { runChecks } from "@/lib/checks";
import { saveCheck } from "@/lib/store";
import type { Extraction, Promise } from "@/lib/types";

export const runtime = "nodejs";

// The server re-runs the checks itself: the browser's numbers are never trusted.
export async function POST(req: Request) {
  const { billId, deviceId, lineIds, extraction, promise } = (await req.json()) as {
    billId: string;
    deviceId: string;
    lineIds: string[];
    extraction: Extraction;
    promise: Promise;
  };
  const result = runChecks(extraction, promise);
  const findingIds = await saveCheck(billId, deviceId, lineIds, promise, result);
  return NextResponse.json({ result, findingIds });
}
