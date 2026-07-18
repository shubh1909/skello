import { MessageCircleIcon, PhoneIcon, ShoppingBagIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format/recovery";
import {
  classifyWhatsAppError,
  whatsappReasonLabel,
} from "@/lib/whatsapp/error-codes";
import type {
  RecoveryAttemptStatus,
  RecoveryMessageStatus,
  RecoveryWhatsAppTrackStatus,
} from "@/types/shopify";

// The recovery attempt's pipeline status (queue → dial → outcome).
const ATTEMPT_STATUS_META: Record<
  RecoveryAttemptStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Waiting",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  in_flight: {
    label: "Calling",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  },
  succeeded: {
    label: "Reached",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  failed: {
    label: "Not reached",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
  canceled: { label: "Stopped", className: "bg-muted text-muted-foreground" },
  skipped: { label: "Skipped", className: "bg-muted text-muted-foreground" },
};

export function AttemptStatusBadge({
  status,
}: {
  status: RecoveryAttemptStatus;
}) {
  const meta = ATTEMPT_STATUS_META[status];
  if (!meta) return <Badge variant="secondary">{status}</Badge>;
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

// Event-based colours for a recovery call's lifecycle status. Green = live call,
// blue = connected/finished, red = failed, amber/orange = dialing / not reached.
const CALL_STATUS_META: Record<string, { label: string; className: string }> = {
  initiated: {
    label: "Queued",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  },
  ringing: {
    label: "Ringing",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  in_progress: {
    label: "In call",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  completed: {
    label: "Connected",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
  no_answer: {
    label: "No answer",
    className:
      "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  },
  busy: {
    label: "Busy",
    className:
      "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  },
  canceled: { label: "Canceled", className: "bg-muted text-muted-foreground" },
};

export function CallStatusBadge({ status }: { status: string }) {
  const meta = CALL_STATUS_META[status];
  if (!meta) return <Badge variant="secondary">{status}</Badge>;
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

// The cart's real-world outcome, independent of the dial pipeline status.
// The WhatsApp channel track on a cart. 'none' (no WhatsApp for this cart)
// renders nothing so voice-only carts stay clean.
const WHATSAPP_TRACK_META: Record<
  RecoveryWhatsAppTrackStatus,
  { label: string; className: string } | null
> = {
  none: null,
  pending: {
    label: "WhatsApp queued",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  in_flight: {
    label: "WhatsApp sending",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  },
  sent: {
    label: "WhatsApp sent",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  failed: {
    label: "WhatsApp failed",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
  skipped: { label: "WhatsApp skipped", className: "bg-muted text-muted-foreground" },
  canceled: { label: "WhatsApp stopped", className: "bg-muted text-muted-foreground" },
};

export function WhatsAppStatusBadge({
  status,
}: {
  status: RecoveryWhatsAppTrackStatus;
}) {
  const meta = WHATSAPP_TRACK_META[status];
  if (!meta) return null;
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

// Concise variant for the dedicated "WhatsApp" table column + the cart drawer
// header. Unlike WhatsAppStatusBadge it never returns null — `none` renders an
// explicit "Not sent" so the column always answers "did we WhatsApp them?".
const WHATSAPP_SENT_META: Record<
  RecoveryWhatsAppTrackStatus,
  { label: string; className: string }
> = {
  none: { label: "Not sent", className: "bg-muted text-muted-foreground" },
  pending: {
    label: "Queued",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  in_flight: {
    label: "Sending",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  },
  sent: {
    label: "Sent",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
  skipped: { label: "Skipped", className: "bg-muted text-muted-foreground" },
  canceled: { label: "Stopped", className: "bg-muted text-muted-foreground" },
};

export function WhatsAppSentBadge({
  status,
  reason,
}: {
  status: RecoveryWhatsAppTrackStatus;
  reason?: string | null;
}) {
  // A skipped track carries a reason (marketing cap, opted out, undeliverable,
  // no template…). Surface the friendly label so a Meta per-user cap reads as
  // "Capped" (amber) rather than a plain "Skipped" or a red failure.
  if (status === "skipped") {
    const label = whatsappReasonLabel(reason);
    if (label) {
      const soft = reason === "cannot_receive" || reason === "invalid_recipient";
      return (
        <Badge
          className={
            soft
              ? "bg-muted text-muted-foreground"
              : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
          }
        >
          {label}
        </Badge>
      );
    }
  }
  const meta = WHATSAPP_SENT_META[status] ?? {
    label: status,
    className: "bg-muted text-muted-foreground",
  };
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

// Outreach status for the carts table — ONE cell, TWO independent channel chips
// (Call · WhatsApp), each coloured by its own state.
//
// The previous single combined badge went red whenever EITHER channel had a
// technical failure — so a cart we reached by phone still showed red because a
// WhatsApp template errored. Per-channel chips remove that: no combined verdict
// means one channel can never red-wash the row, and the colour vocabulary is
// deliberately calm —
//   emerald  reached / delivered / read / clicked   (good)
//   blue     actively calling / sending             (in motion)
//   amber    waiting / queued / marketing-capped     (temporary, will clear)
//   slate    no answer / busy / opted-out /          (normal, NOT our fault)
//            undeliverable / skipped / stopped
//   rose     a FIXABLE technical error only —        (needs a human)
//            couldn't place the call, template/param/policy problem
// Rose is the only alarming colour and it fires only for things someone can act
// on. When BOTH channels finish having reached nobody, the soft misses are
// bumped slate → amber so the dead cart still stands out, but never in red.

export type ChipTone = "good" | "active" | "waiting" | "soft" | "attention";

export interface Chip {
  icon: "call" | "whatsapp" | "bought";
  label: string;
  tone: ChipTone;
  // Static tooltip text (e.g. which cap was hit). Combined with `scheduledAt`.
  hint?: string;
  // ISO time this channel is next due — rendered as "next: <time>" on hover.
  // Kept raw here (not formatted) so the decision layer stays pure/testable;
  // ChipView formats it.
  scheduledAt?: string | null;
}

const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  active: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  waiting: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  soft: "bg-muted text-muted-foreground",
  attention: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

// Compact, human label for a hard WhatsApp failure — the full text lives in the
// drawer timeline. Long Meta reasons ("param count mismatch") would blow out the
// column, so collapse them to a word.
function shortWaFailure(errorText: string | null): string {
  const { reason } = classifyWhatsAppError(errorText);
  if (reason.startsWith("template")) return "Template";
  if (reason.includes("param")) return "Bad params";
  if (reason === "policy_violation") return "Policy";
  if (reason === "account_restricted") return "Account";
  if (reason === "provider_error" || reason === "service_unavailable")
    return "Provider";
  return whatsappReasonLabel(reason) ?? "Failed";
}

// The call channel's chip. null when there's no voice channel on this cart (a
// WhatsApp-only cart sits pending with skip_reason 'no_voice_agent' — showing it
// as "Waiting" forever would be a lie).
function callChip(
  status: RecoveryAttemptStatus,
  lastStatus: string | null,
  skipReason: string | null,
  nextAttemptAt: string | null,
): Chip | null {
  if (skipReason === "no_voice_agent") return null;
  const base = { icon: "call" as const };
  switch (status) {
    case "succeeded":
      return { ...base, label: "Reached", tone: "good" };
    case "in_flight":
      return { ...base, label: "Calling", tone: "active" };
    case "pending":
      // Scheduled — carry the next-attempt time so hovering shows *when*.
      return {
        ...base,
        label: "Waiting",
        tone: "waiting",
        scheduledAt: nextAttemptAt,
      };
    case "failed":
      // last_status disambiguates our-fault (technical) from customer-side.
      if (lastStatus === "no_answer") return { ...base, label: "No answer", tone: "soft" };
      if (lastStatus === "busy") return { ...base, label: "Busy", tone: "soft" };
      if (lastStatus === "canceled") return { ...base, label: "Stopped", tone: "soft" };
      return { ...base, label: "Call failed", tone: "attention" };
    case "canceled":
      return { ...base, label: "Stopped", tone: "soft" };
    case "skipped":
      // The per-lead 48h connected-call cap suppresses voice → skipped. Surface
      // it as "Capped" (amber, temporary) rather than hiding the channel, so the
      // reason a cart went quiet is visible. Any other skip has no call to show.
      if (skipReason === "per_lead_cap_reached") {
        return {
          ...base,
          label: "Capped",
          tone: "waiting",
          hint: "Per-lead call cap reached (48h)",
        };
      }
      return null;
  }
}

// The WhatsApp channel's chip. Clicked outranks everything — it's the strongest
// engagement signal we have.
function waChip(
  status: RecoveryWhatsAppTrackStatus,
  skipReason: string | null,
  errorText: string | null,
  delivery: RecoveryMessageStatus | null | undefined,
  clickedAt: string | null,
  nextAt: string | null,
): Chip | null {
  if (status === "none") return null;
  const base = { icon: "whatsapp" as const };
  if (clickedAt) return { ...base, label: "Clicked", tone: "good" };

  switch (status) {
    case "sent":
      if (delivery === "read") return { ...base, label: "Read", tone: "good" };
      if (delivery === "delivered")
        return { ...base, label: "Delivered", tone: "good" };
      if (delivery === "failed")
        return { ...base, label: shortWaFailure(errorText), tone: "attention" };
      return { ...base, label: "Sent", tone: "active" };
    case "pending":
      // Scheduled — carry WhatsApp's own next-send time.
      return { ...base, label: "Queued", tone: "waiting", scheduledAt: nextAt };
    case "in_flight":
      return { ...base, label: "Sending", tone: "active" };
    case "canceled":
      // Canceled by the per-lead cap reads as "Capped" (amber), not a bare
      // "Stopped": a limit we hit, not the shopper's own outcome.
      if (skipReason === "per_lead_cap_reached")
        return {
          ...base,
          label: "Capped",
          tone: "waiting",
          hint: "Per-lead call cap reached (48h)",
        };
      return { ...base, label: "Stopped", tone: "soft" };
    case "skipped": {
      // Policy / recipient reasons — soft, not our fault — except an unset
      // template, which is a setup gap a human can fix.
      if (skipReason === "marketing_cap" || skipReason === "per_user_cap")
        return {
          ...base,
          label: "Capped",
          tone: "waiting",
          hint: "Meta marketing-message limit for this recipient",
        };
      if (skipReason === "per_lead_cap_reached")
        return {
          ...base,
          label: "Capped",
          tone: "waiting",
          hint: "Per-lead call cap reached (48h)",
        };
      if (skipReason === "no_template")
        return { ...base, label: "No template", tone: "attention" };
      return {
        ...base,
        label: whatsappReasonLabel(skipReason) ?? "Skipped",
        tone: "soft",
      };
    }
    case "failed":
      return { ...base, label: shortWaFailure(errorText), tone: "attention" };
  }
}

const CHIP_ICON = {
  call: PhoneIcon,
  whatsapp: MessageCircleIcon,
  bought: ShoppingBagIcon,
} as const;

function ChipView({ chip }: { chip: Chip }) {
  const Icon = CHIP_ICON[chip.icon];
  // Tooltip: the static hint (cap explanation) and/or the scheduled time.
  const scheduled = chip.scheduledAt
    ? `Next: ${formatDateTime(chip.scheduledAt)}`
    : null;
  const title = [chip.hint, scheduled].filter(Boolean).join(" · ") || undefined;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
        CHIP_TONE_CLASS[chip.tone]
      }`}
    >
      <Icon className="size-3 shrink-0" />
      {chip.label}
    </span>
  );
}

// Labels that mean the customer actually received something, and tones that mean
// a channel is still working — used to detect a cart that FINISHED reaching
// nobody (→ bump its soft misses amber for visibility, never red).
const CONTACTED_LABELS = new Set(["Reached", "Delivered", "Read", "Clicked"]);
const IN_MOTION_TONES = new Set<ChipTone>(["active", "waiting"]);

export interface OutreachInput {
  voiceStatus: RecoveryAttemptStatus;
  voiceLastStatus: string | null;
  voiceSkipReason: string | null;
  voiceNextAttemptAt: string | null;
  whatsappStatus: RecoveryWhatsAppTrackStatus;
  whatsappSkipReason: string | null;
  whatsappError: string | null;
  whatsappDelivery: RecoveryMessageStatus | null | undefined;
  whatsappNextAt: string | null;
  clickedAt: string | null;
  convertedAt: string | null;
}

// Pure decision layer — the two channel chips with the total-non-contact
// emphasis already applied. Exported so the branch logic is unit-testable
// without rendering (there's no jsdom in this test env).
export function computeOutreachChips(input: OutreachInput): Chip[] {
  // Converted wins outright. Both channels get `canceled` when an order lands,
  // which used to render "Stopped · Stopped" — reading like a dead cart on the
  // abandoned tab when in fact they BOUGHT. One clear "Bought" chip instead; the
  // Cart column still carries recovered-vs-organic attribution.
  if (input.convertedAt) {
    return [{ icon: "bought", label: "Bought", tone: "good" }];
  }

  const call = callChip(
    input.voiceStatus,
    input.voiceLastStatus,
    input.voiceSkipReason,
    input.voiceNextAttemptAt,
  );
  const wa = waChip(
    input.whatsappStatus,
    input.whatsappSkipReason,
    input.whatsappError,
    input.whatsappDelivery,
    input.clickedAt,
    input.whatsappNextAt,
  );

  const chips = [call, wa].filter((c): c is Chip => c !== null);

  const anyContacted = chips.some((c) => CONTACTED_LABELS.has(c.label));
  const anyInMotion = chips.some((c) => IN_MOTION_TONES.has(c.tone));
  const noContactAllDone = chips.length > 0 && !anyContacted && !anyInMotion;

  if (!noContactAllDone) return chips;
  return chips.map((c) => (c.tone === "soft" ? { ...c, tone: "waiting" } : c));
}

export function OutreachStatus(props: OutreachInput) {
  const chips = computeOutreachChips(props);
  if (chips.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((c) => (
        <ChipView key={c.icon} chip={c} />
      ))}
    </div>
  );
}

export function CartOutcomeBadge({
  convertedAt,
  attributed,
}: {
  convertedAt: string | null;
  attributed?: boolean;
}) {
  if (!convertedAt) {
    return <Badge className="bg-muted text-muted-foreground">Abandoned</Badge>;
  }
  if (attributed) {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
        Recovered · by us
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300">
      Recovered
    </Badge>
  );
}
