"use client";

import { CheckIcon, MousePointerClickIcon, XIcon } from "lucide-react";

import {
  classifyWhatsAppError,
  whatsappReasonLabel,
} from "@/lib/whatsapp/error-codes";
import type { RecoveryMessageRow } from "@/types/shopify";

// The delivery journey of one WhatsApp message, both sides of it:
//
//   Sent      — OURS.  We handed the template to the BSP and it accepted.
//   Delivered — META'S. Reported back via the delivery webhook.
//   Read      — META'S. Same.
//   Clicked   — OURS.  The shopper hit our redirect route (cart-level, so it
//               lives outside this component — see WhatsAppClickStep).
//
// Worth separating because "sent" says nothing about whether it landed: an
// accepted send that Meta later drops looks identical at our boundary. The
// `via` label makes it obvious who is asserting what when a cart goes quiet.

type StepState = "done" | "failed" | "pending";

interface Step {
  label: string;
  at: string | null;
  via: string;
  state: StepState;
  detail?: string | null;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })}, ${formatTime(iso)}`;
}

// Prefer OUR plain-English reading of the code over the provider's prose, which
// is long, changes wording without notice, and buries the point ("Message failed
// to send because more than 24 hours have passed…"). Fall back to their text
// when the code is one we haven't mapped — something beats nothing.
function failureDetail(m: RecoveryMessageRow): string | null {
  const info = classifyWhatsAppError(m.error_message, m.error_code);
  const label = whatsappReasonLabel(info.reason);
  if (label && info.reason !== "unknown" && info.reason !== "delivery_failed") {
    return label;
  }
  return m.error_message;
}

// Meta reports a failure as a terminal state, so a message that failed BEFORE
// we ever handed it over (no sent_at) must not render a green "Sent".
function stepsFor(m: RecoveryMessageRow): Step[] {
  const failed = m.status === "failed";
  const reachedBsp = Boolean(m.sent_at) || m.status !== "failed";

  const steps: Step[] = [
    {
      label: "Sent",
      at: m.sent_at,
      via: "us → provider",
      state: reachedBsp ? "done" : "failed",
      detail: reachedBsp ? null : m.error_message,
    },
  ];

  // Only meaningful once we actually got it to the provider.
  if (reachedBsp) {
    if (failed) {
      // Accepted by the BSP, then rejected by Meta — the single most confusing
      // state, because our side says "sent". The code is what makes it
      // actionable: 131049 (per-user cap) means do nothing, 132001 (template
      // not found) means the channel is dead until someone fixes it.
      steps.push({
        label: "Failed",
        at: null,
        via: m.error_code ? `Meta · #${m.error_code}` : "Meta",
        state: "failed",
        detail: failureDetail(m),
      });
    } else {
      steps.push({
        label: "Delivered",
        at: m.delivered_at,
        via: "Meta",
        state: m.delivered_at ? "done" : "pending",
      });
      steps.push({
        label: "Read",
        at: m.read_at,
        via: "Meta",
        state: m.read_at ? "done" : "pending",
      });
    }
  }

  return steps;
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return <CheckIcon className="size-3.5 shrink-0 text-emerald-600" />;
  }
  if (state === "failed") {
    return <XIcon className="size-3.5 shrink-0 text-destructive" />;
  }
  return (
    <span
      aria-hidden
      className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
      style={{ margin: "0 0.4rem" }}
    />
  );
}

function StepRow({ step }: { step: Step }) {
  return (
    <li className="flex items-baseline gap-2 text-xs">
      <span className="flex w-4 justify-center self-center">
        <StepIcon state={step.state} />
      </span>
      <span
        className={
          step.state === "pending"
            ? "w-16 text-muted-foreground/60"
            : step.state === "failed"
              ? "w-16 font-medium text-destructive"
              : "w-16 font-medium"
        }
      >
        {step.label}
      </span>
      <span className="w-20 font-mono tabular-nums text-muted-foreground">
        {step.at ? formatTime(step.at) : ""}
      </span>
      <span className="text-[11px] text-muted-foreground/70">{step.via}</span>
      {step.detail ? (
        <span className="min-w-0 flex-1 truncate text-[11px] text-destructive/80">
          {step.detail}
        </span>
      ) : null}
    </li>
  );
}

export function WhatsAppMessageTimeline({
  message,
}: {
  message: RecoveryMessageRow;
}) {
  const steps = stepsFor(message);
  return (
    <div className="rounded-md border border-border/60 bg-card px-3 py-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium">
          {message.template_name ?? "template"}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatStamp(message.sent_at ?? message.created_at)}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {steps.map((s) => (
          <StepRow key={s.label} step={s} />
        ))}
      </ul>
    </div>
  );
}

// Cart-level, so it sits below the message list rather than inside a message:
// the short-link token belongs to the ATTEMPT, so when retries sent several
// messages we genuinely cannot say which one was clicked.
export function WhatsAppClickStep({ clickedAt }: { clickedAt: string | null }) {
  if (!clickedAt) {
    return (
      <p className="flex items-center gap-2 px-3 text-xs text-muted-foreground/60">
        <MousePointerClickIcon className="size-3.5 shrink-0" />
        Link not opened yet
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 px-3 text-xs">
      <MousePointerClickIcon className="size-3.5 shrink-0 text-emerald-600" />
      <span className="font-medium">Link opened</span>
      <span className="font-mono tabular-nums text-muted-foreground">
        {formatStamp(clickedAt)}
      </span>
      <span className="text-[11px] text-muted-foreground/70">
        our redirect
      </span>
    </p>
  );
}

// The compact table cell that showed Meta's furthest delivery state + click was
// folded into the single Outreach column (recovery-badges.tsx OutreachStatus),
// so the carts table has one channel-status column instead of two. The
// per-message timeline + click step above remain, for the cart drawer.
