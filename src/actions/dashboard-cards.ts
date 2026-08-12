"use server";

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { warnSkelo } from "@/lib/errors";
import { ok, type ActionResult } from "@/types/action";

/**
 * The three "what needs me right now" cards under the dashboard charts.
 *
 * Deliberately NOT range-scoped, unlike everything above them on the page.
 * "Overdue" and "needs attention" are states, not period totals — filtering
 * them to the last 14 days would hide the oldest and most urgent items, which
 * is the exact opposite of what the row is for. The card row carries a `now`
 * label so it doesn't read as a period metric.
 */
export interface DashboardActionCards {
  leads: {
    total: number;
    /** `leads.pending_action` — flagged for a human, surfaced nowhere else. */
    needsAttention: number;
  };
  reminders: {
    dueToday: number;
    overdue: number;
  };
}

// Counts only — `head: true` means PostgREST returns no rows at all, so these
// stay cheap no matter how large the tenant is.
export async function getDashboardActionCards(): Promise<
  ActionResult<DashboardActionCards>
> {
  const session = await requireSession();
  const orgId = session.organisation.id;
  const supabase = await createClient();

  const now = new Date();
  // End of today in the server's reckoning. Anything before now that is still
  // pending is overdue; anything from now to midnight is due today.
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const [totalRes, attentionRes, dueRes, overdueRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .eq("pending_action", true),
    supabase
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .eq("status", "pending")
      .gte("remind_at", now.toISOString())
      .lte("remind_at", endOfToday.toISOString()),
    supabase
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .eq("status", "pending")
      .lt("remind_at", now.toISOString()),
  ]);

  // A failed count degrades to zero rather than taking the whole dashboard
  // down — the charts above are the page's reason for existing, and a card
  // reading "0 overdue" is a smaller lie than a blank screen. Logged so the
  // failure is still visible.
  for (const [name, res] of [
    ["leads total", totalRes],
    ["leads needing attention", attentionRes],
    ["reminders due today", dueRes],
    ["reminders overdue", overdueRes],
  ] as const) {
    if (res.error) {
      warnSkelo("ANALYTICS", `Dashboard card count failed: ${name}`, {
        organisationId: orgId,
        cause: res.error,
      });
    }
  }

  return ok({
    leads: {
      total: totalRes.count ?? 0,
      needsAttention: attentionRes.count ?? 0,
    },
    reminders: {
      dueToday: dueRes.count ?? 0,
      overdue: overdueRes.count ?? 0,
    },
  });
}
