import type { BadgeVariant } from "@/components/ui/badge";
import type { LeadIntent } from "@/types/lead";

/**
 * The hot / warm / cold vocabulary.
 *
 * The label map existed in three files and the variant map in two. They agreed
 * today, which is the only reason nobody noticed.
 */
export const INTENT_LABEL: Record<LeadIntent, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
};

export const INTENT_VARIANT: Record<LeadIntent, BadgeVariant> = {
  hot: "destructive",
  warm: "secondary",
  cold: "outline",
};

export function isLeadIntent(value: unknown): value is LeadIntent {
  return value === "hot" || value === "warm" || value === "cold";
}

/**
 * Label + variant for a value that is only *probably* an intent.
 *
 * `calls.lead_intent_extracted` is typed `LeadIntent` on `Call` but plain
 * `string` on `RecoveryCallRow` — it comes from an LLM extraction, so an
 * unexpected word is a data reality, not an impossible state. An unknown value
 * renders as itself in a neutral chip rather than an empty badge.
 */
export function intentBadge(
  value: string | null | undefined,
): { label: string; variant: BadgeVariant } | null {
  if (!value) return null;
  if (isLeadIntent(value)) {
    return { label: INTENT_LABEL[value], variant: INTENT_VARIANT[value] };
  }
  return { label: value, variant: "outline" };
}
