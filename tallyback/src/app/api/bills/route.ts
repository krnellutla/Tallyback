import { NextResponse } from "next/server";
import { listBills } from "@/lib/store";
import { summarise } from "@/lib/billView";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const deviceId = new URL(req.url).searchParams.get("deviceId");
  if (!deviceId || deviceId === "anon") return NextResponse.json({ bills: [] });
  const bills = (await listBills(deviceId)).map(summarise);
  return NextResponse.json({ bills });
}
