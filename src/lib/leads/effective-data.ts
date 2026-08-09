import type { Call } from "@/types/call";

/**
 * The lead's captured fields, with gaps backfilled from its call snapshots.
 *
 * ## Why backfill at all
 *
 * The canonical store is `leads.lead_data` / `leads.custom_data`, which the
 * webhook merge keeps current. But a legacy lead (created before that merge
 * existed) or a row where a per-key merge silently failed can be empty while
 * every one of its calls carries the snapshot. Backfilling keeps the summary
 * useful without depending on the merge having been perfect.
 *
 * **Precedence is lead row first.** Calls only fill gaps, and never overwrite.
 *
 * ## ⚠️ Pass only the FIRST page of calls
 *
 * This is the whole reason the function takes a `calls` argument instead of
 * reading a component's state: the caller must decide *which* calls, and there
 * is exactly one right answer.
 *
 * The detail sheet's Calls tab pages — 20 at a time, appending as you scroll —
 * and the summary reads from the same array. So passing the full array made the
 * Summary tab's captured fields **grow as you scrolled the Calls tab**: open a
 * lead and see 6 fields, scroll the call list, come back to 6 + however many
 * older calls happened to carry. Nothing about the lead changed.
 *
 * Worse, the edit form prefills from these values and the save diffs against
 * the lead row — so scrolling first and then saving wrote *more* keys to the
 * database than not scrolling. Same click, different write.
 *
 * Pinning to the first page makes the value a function of the lead, not of
 * scroll depth. Calls arrive newest-first (`started_at DESC` in `listCalls`),
 * so the first page is also the most recent and most relevant.
 */
type CallSnapshot = Pick<Call, "lead_data" | "custom_data">;

function isUsable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
}

function isBag(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildEffectiveLeadData(
  leadData: Record<string, unknown> | null | undefined,
  calls: readonly CallSnapshot[] | null | undefined,
): Record<string, unknown> | null {
  const base: Record<string, unknown> = {};

  if (isBag(leadData)) {
    for (const [k, v] of Object.entries(leadData)) {
      if (isUsable(v)) base[k] = v;
    }
  }

  for (const call of calls ?? []) {
    if (!isBag(call.lead_data)) continue;
    for (const [k, v] of Object.entries(call.lead_data)) {
      if (!isUsable(v)) continue;
      // First writer wins: the lead row seeded `base`, and calls are
      // newest-first, so an older call can never shadow a newer one.
      if (base[k] !== undefined) continue;
      base[k] = v;
    }
  }

  return Object.keys(base).length > 0 ? base : null;
}

export function buildEffectiveCustomData(
  customData: Record<string, unknown> | null | undefined,
  calls: readonly CallSnapshot[] | null | undefined,
): Record<string, Record<string, unknown>> | null {
  const base: Record<string, Record<string, unknown>> = {};

  if (isBag(customData)) {
    for (const [cat, bag] of Object.entries(customData)) {
      if (!isBag(bag)) continue;
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(bag)) {
        if (isUsable(v)) cleaned[k] = v;
      }
      if (Object.keys(cleaned).length > 0) base[cat] = cleaned;
    }
  }

  for (const call of calls ?? []) {
    if (!isBag(call.custom_data)) continue;
    for (const [cat, bag] of Object.entries(call.custom_data)) {
      if (!isBag(bag)) continue;
      for (const [k, v] of Object.entries(bag)) {
        if (!isUsable(v)) continue;
        const target = (base[cat] ??= {});
        if (target[k] !== undefined) continue;
        target[k] = v;
      }
    }
  }

  return Object.keys(base).length > 0 ? base : null;
}
