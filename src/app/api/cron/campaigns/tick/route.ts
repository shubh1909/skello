import { NextResponse, type NextRequest } from "next/server";

import { dispatchDueCallbacks } from "@/lib/callbacks/dispatch";
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
    // Both drains share the tick. Run callbacks even if the campaign drain
    // throws (and vice-versa) so one subsystem can't starve the other.
    const [campaigns, callbacks] = await Promise.allSettled([
      dispatchDueCampaignContacts(),
      dispatchDueCallbacks(),
    ]);

    if (campaigns.status === "rejected" && callbacks.status === "rejected") {
      const message =
        campaigns.reason instanceof Error
          ? campaigns.reason.message
          : "dispatch failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return NextResponse.json(
      {
        campaigns:
          campaigns.status === "fulfilled"
            ? campaigns.value
            : { error: String(campaigns.reason) },
        callbacks:
          callbacks.status === "fulfilled"
            ? callbacks.value
            : { error: String(callbacks.reason) },
      },
      { status: 200 },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
