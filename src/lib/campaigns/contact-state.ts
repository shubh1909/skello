import type { BadgeVariant } from "@/components/ui/badge";
import type { ContactState } from "@/actions/campaigns";

/**
 * Why a contact is where it is, in the operator's words.
 *
 * The whole point of splitting "pending" into deferred / callback / retry /
 * queued is to answer "why hasn't this number been called yet?" without anyone
 * having to read the dispatcher. `hint` carries that answer.
 *
 * Variants, not class strings. This map was the last survivor of the semantic
 * colour pass — it held `bg-warning-muted text-warning` literals, so a grep for
 * raw Tailwind palette classes never flagged it and a grep for status→variant
 * maps never found it.
 *
 * The order here also drives the summary strip: **actionable first.** Deferred
 * and callback are things an operator can do something about; succeeded is not.
 */
export const CONTACT_STATE_META: ReadonlyArray<{
  key: ContactState;
  label: string;
  variant: BadgeVariant;
  hint: string;
}> = [
  {
    key: "deferred",
    label: "Deferred",
    variant: "warning",
    hint: "Every caller ID is resting — the dispatcher is backing off",
  },
  {
    key: "callback",
    label: "Callback",
    variant: "info",
    hint: "The customer asked to be called at a specific time",
  },
  {
    key: "retry",
    label: "Retrying",
    variant: "warning",
    hint: "Waiting out the retry interval after a no-answer or busy",
  },
  { key: "dialing", label: "Dialing", variant: "info", hint: "On the phone now" },
  { key: "queued", label: "Queued", variant: "neutral", hint: "Never dialed yet" },
  { key: "failed", label: "Failed", variant: "destructive", hint: "Out of attempts" },
  {
    key: "succeeded",
    label: "Succeeded",
    variant: "success",
    hint: "Reached and marked successful",
  },
];

const BY_KEY = new Map(CONTACT_STATE_META.map((m) => [m.key, m]));

export function contactStateMeta(state: ContactState) {
  return (
    BY_KEY.get(state) ?? {
      key: state,
      label: state,
      variant: "neutral" as BadgeVariant,
      hint: "",
    }
  );
}
