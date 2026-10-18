import { NextResponse } from "next/server";
import { markSent } from "@/lib/store";
import { wordsChanged } from "@/lib/message";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { messageId, drafted, sentText, channel } = (await req.json()) as {
    messageId: string;
    drafted: string;
    sentText: string;
    channel: string;
  };
  const changed = wordsChanged(drafted, sentText);
  await markSent(messageId, sentText, changed, channel);
  return NextResponse.json({ wordsChanged: changed });
}
