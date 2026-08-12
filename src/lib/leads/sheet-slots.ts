import type { LeadSheetSlot } from "@/types/lead-sheet-binding";

/**
 * Names and explanations for the three configurable slots on the lead sheet.
 *
 * ⚠️ **This lives in `lib/`, not beside the editor component, because a Server
 * Component reads it.** It first sat in `lead-sheet-layout-manager.tsx`, which
 * carries `"use client"` — and every export of a client module reaches a Server
 * Component as a client *reference*, not as the value. Property access on that
 * reference yields `undefined`, so `LEAD_SHEET_SLOT_INFO[slot].tab` threw at
 * request time. A production build does not catch it: the module graph is
 * legal, the failure is a runtime read.
 *
 * One home for the copy so the admin tab label, the page's intro paragraph and
 * the editor's own heading cannot drift apart.
 */
export const LEAD_SHEET_SLOT_INFO: Record<
  LeadSheetSlot,
  { tab: string; title: string; blurb: string }
> = {
  stat_card: {
    tab: "Sheet cards",
    title: "The three cards at the top",
    blurb:
      "First thing anyone sees when they open a lead. Best used for numbers and one-word states. A card with no value for a lead shows a dash rather than disappearing, so the row keeps its shape.",
  },
  wants: {
    tab: "What they want",
    title: "“What they want” panel",
    blurb:
      "The list beside Last contact, for what the conversation established — budget, location, size. A row with no value is hidden for that lead, so it is safe to configure more rows than every lead will fill.",
  },
  header_meta: {
    tab: "Header line",
    title: "The line under the lead's name",
    blurb:
      "Joined with dots, one line. Keep to short identifying facts — phone, city, what they're after. Long values crowd the name.",
  },
};
