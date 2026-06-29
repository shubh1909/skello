import { NextResponse, type NextRequest } from "next/server";

import { dispatchDueCallbacks } from "@/lib/callbacks/dispatch";
import { dispatchDueCampaignContacts } from "@/lib/campaigns/dispatch";
import { dispatchDueRecoveries } from "@/lib/shopify/recovery";

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
    // All drains share the tick. Each runs independently so one subsystem
    // throwing can't starve the others.
    const [campaigns, callbacks, recoveries] = await Promise.allSettled([
      dispatchDueCampaignContacts(),
      dispatchDueCallbacks(),
      dispatchDueRecoveries(),
    ]);

    if (
      campaigns.status === "rejected" &&
      callbacks.status === "rejected" &&
      recoveries.status === "rejected"
    ) {
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
        recoveries:
          recoveries.status === "fulfilled"
            ? recoveries.value
            : { error: String(recoveries.reason) },
      },
      { status: 200 },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
