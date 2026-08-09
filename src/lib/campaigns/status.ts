import type { BadgeVariant } from "@/components/ui/badge";
import type { CampaignStatus } from "@/types/campaign";

// One home for how a campaign status is named and coloured.
//
// These maps previously existed TWICE — verbatim in `campaigns-table.tsx` and in
// `campaigns/[id]/page.tsx` — so the list page and the detail page could drift on
// the same campaign. Import from here; don't restate.

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  in_progress: "Running",
  paused: "Paused",
  stopped: "Stopped",
  completed: "Completed",
  failed: "Failed",
};

export const CAMPAIGN_STATUS_VARIANT: Record<CampaignStatus, BadgeVariant> = {
  // Dim: not started yet, nothing to report.
  draft: "neutral",
  scheduled: "info",
  in_progress: "success",
  paused: "warning",
  // `secondary` rather than `neutral`: a finished campaign is a real outcome, so
  // it reads at full text weight — the previous `bg-muted text-foreground`
  // distinguished these from draft in exactly the same way.
  stopped: "secondary",
  completed: "secondary",
  failed: "destructive",
};
