import { CheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
}: {
  status: RecoveryWhatsAppTrackStatus;
}) {
  const meta = WHATSAPP_SENT_META[status] ?? {
    label: status,
    className: "bg-muted text-muted-foreground",
  };
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

// Combined "did we reach them" status across BOTH channels (voice + WhatsApp),
// collapsed to three states for the carts table:
//   Failed    — either channel failed (failure wins; we name which one).
//   Done      — otherwise, if either channel reached/sent.
//   Scheduled — otherwise, if either channel is still queued/in progress.
//   —         — neither channel is active (both skipped/none).
export function ReachOutStatusBadge({
  voiceStatus,
  whatsappStatus,
}: {
  voiceStatus: RecoveryAttemptStatus;
  whatsappStatus: RecoveryWhatsAppTrackStatus;
}) {
  const voiceFailed = voiceStatus === "failed";
  const waFailed = whatsappStatus === "failed";
  const voiceDone = voiceStatus === "succeeded";
  const waDone = whatsappStatus === "sent";
  const voiceScheduled = voiceStatus === "pending" || voiceStatus === "in_flight";
  const waScheduled =
    whatsappStatus === "pending" || whatsappStatus === "in_flight";

  if (voiceFailed || waFailed) {
    const which = [voiceFailed ? "Call" : null, waFailed ? "WhatsApp" : null]
      .filter(Boolean)
      .join(" & ");
    return (
      <div className="flex items-center gap-1.5">
        <Badge className="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
          Failed
        </Badge>
        <span className="text-[11px] text-muted-foreground">{which}</span>
      </div>
    );
  }
  if (voiceDone || waDone) {
    return (
      <Badge className="gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
        <CheckIcon className="size-3" />
        Closed
      </Badge>
    );
  }
  if (voiceScheduled || waScheduled) {
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
        Scheduled
      </Badge>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

// A single WhatsApp message's delivery status (ledger row) for the timeline.
const MESSAGE_STATUS_META: Record<
  RecoveryMessageStatus,
  { label: string; className: string }
> = {
  queued: {
    label: "Queued",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  sent: {
    label: "Sent",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  },
  delivered: {
    label: "Delivered",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  },
  read: {
    label: "Read",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
};

export function MessageStatusBadge({
  status,
}: {
  status: RecoveryMessageStatus;
}) {
  const meta = MESSAGE_STATUS_META[status] ?? {
    label: status,
    className: "bg-muted text-muted-foreground",
  };
  return <Badge className={meta.className}>{meta.label}</Badge>;
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
