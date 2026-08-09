import type { BadgeVariant } from "@/components/ui/badge";
import type { CodConfirmationRow } from "@/types/cod";

/**
 * The disposition a merchant actually reads, layered over the dial status.
 *
 * "Confirmed" is not a dial outcome — it only exists once we reached the
 * customer AND they said yes, which is why this can't be a plain status map.
 *
 * Previously inlined in `cod-confirmations-table.tsx` with hand-written
 * `bg-success-muted` / `bg-destructive/10` class strings — the one status map
 * Stage 2's semantic-colour pass missed, because it returned a `className`
 * rather than a variant. It returns a variant now, so the token carries both
 * themes and a typo is a type error.
 */
export function codOutcome(
  row: Pick<CodConfirmationRow, "status" | "confirmed">,
): { label: string; variant: BadgeVariant } {
  switch (row.status) {
    case "confirmed_call":
      if (row.confirmed === true) return { label: "Confirmed", variant: "success" };
      if (row.confirmed === false)
        return { label: "Declined", variant: "destructive" };
      // Reached, but the agent extracted no yes/no — a real and distinct state.
      return { label: "Reached", variant: "neutral" };
    case "failed":
      return { label: "Not reached", variant: "destructive" };
    case "pending":
      return { label: "Queued", variant: "warning" };
    case "in_flight":
      return { label: "Calling", variant: "warning" };
    case "canceled":
      return { label: "Canceled", variant: "neutral" };
    case "skipped":
      return { label: "Skipped", variant: "neutral" };
    default:
      return { label: row.status, variant: "neutral" };
  }
}
