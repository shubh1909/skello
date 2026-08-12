import type { BadgeVariant } from "@/components/ui/badge";
import type { LeadStatus } from "@/types/lead";

// One home for how a pipeline status is named and coloured — the same reason
// `lib/campaigns/status.ts` exists. Before the lead sheet gained a status
// picker there was nowhere central for this, so the leads table title-cased the
// raw enum and anything else would have re-derived it.

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
};

/** Pipeline order, for the picker. Enum declaration order is the funnel. */
export const LEAD_STATUS_ORDER: readonly LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "negotiating",
  "won",
  "lost",
];

export const LEAD_STATUS_VARIANT: Record<LeadStatus, BadgeVariant> = {
  new: "info",
  contacted: "neutral",
  // Qualified is the first status a human decision produced, so it reads at
  // full weight rather than as another step along the way.
  qualified: "success",
  negotiating: "warning",
  won: "success",
  lost: "destructive",
};
