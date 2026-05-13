import { NextResponse, type NextRequest } from "next/server";

import { dispatchDueCampaignContacts } from "@/lib/campaigns/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return unauthorized();
  const headerSecret = request.headers.get("x-cron-secret");
  if (!headerSecret || !timingSafeEqual(headerSecret, expected)) {
    return unauthorized();
  }

  try {
    const result = await dispatchDueCampaignContacts();
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
