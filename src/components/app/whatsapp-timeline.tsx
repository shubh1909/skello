"use client";

import {
  CheckIcon,
  ClockIcon,
  MousePointerClickIcon,
  XIcon,
} from "lucide-react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  classifyWhatsAppError,
  whatsappReasonLabel,
} from "@/lib/whatsapp/error-codes";
import { cn } from "@/lib/utils";
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
// `via` attribution makes it obvious who is asserting what when a cart goes
// quiet.

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

/** The furthest state the message actually reached, for the card's header. */
function headlineStatus(m: RecoveryMessageRow): {
  label: string;
  variant: BadgeVariant;
} {
  if (m.status === "failed") return { label: "Failed", variant: "destructive" };
  if (m.read_at) return { label: "Read", variant: "success" };
  if (m.delivered_at) return { label: "Delivered", variant: "success" };
  if (m.sent_at) return { label: "Sent", variant: "info" };
  return { label: "Queued", variant: "neutral" };
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="grid size-5 place-items-center rounded-full bg-success-muted">
        <CheckIcon className="size-3 text-success" />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="grid size-5 place-items-center rounded-full bg-destructive-muted">
        <XIcon className="size-3 text-destructive" />
      </span>
    );
  }
  return (
    <span className="grid size-5 place-items-center rounded-full border border-dashed border-border">
      <ClockIcon className="size-2.5 text-muted-foreground/60" />
    </span>
  );
}

/**
 * One step of the journey.
 *
 * The old version was five fixed-width spans on one line (`w-16`, `w-20`, …)
 * with the failure reason **truncated** at the end — so the one field that says
 * what to do about a dead channel was the one field you couldn't read. Label and
 * time share the first line, the attribution sits opposite, and any detail gets
 * a full-width line of its own.
 */
function StepRow({ step, last }: { step: Step; last: boolean }) {
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {/* The connector, drawn behind the icons and stopped on the last row. */}
      {last ? null : (
        <span
          aria-hidden
          className="absolute top-5 bottom-0 left-2.25 w-px bg-border"
        />
      )}
      <span className="relative z-10 shrink-0 bg-card">
        <StepIcon state={step.state} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={cn(
              "text-sm font-medium",
              step.state === "pending" && "text-muted-foreground/70",
              step.state === "failed" && "text-destructive",
            )}
          >
            {step.label}
          </span>
          {step.at ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {formatTime(step.at)}
            </span>
          ) : step.state === "pending" ? (
            <span className="text-xs text-muted-foreground/60">
              not yet reported
            </span>
          ) : null}
          <span className="ml-auto text-[11px] text-muted-foreground/70">
            {step.via}
          </span>
        </div>
        {step.detail ? (
          <p className="mt-1 rounded bg-destructive-muted px-2 py-1 text-xs leading-relaxed text-destructive wrap-break-word">
            {step.detail}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function WhatsAppMessageTimeline({
  message,
}: {
  message: RecoveryMessageRow;
}) {
  const steps = stepsFor(message);
  const headline = headlineStatus(message);

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-primary/3 px-3.5 py-2">
        <span className="truncate font-mono text-xs">
          {message.template_name ?? "template"}
        </span>
        <Badge variant={headline.variant}>{headline.label}</Badge>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatStamp(message.sent_at ?? message.created_at)}
        </span>
      </header>
      <ol className="px-3.5 py-3">
        {steps.map((step, i) => (
          <StepRow key={step.label} step={step} last={i === steps.length - 1} />
        ))}
      </ol>
    </section>
  );
}

/**
 * Cart-level, so it sits below the message list rather than inside a message:
 * the short-link token belongs to the ATTEMPT, so when retries sent several
 * messages we genuinely cannot say which one was clicked.
 */
export function WhatsAppClickStep({ clickedAt }: { clickedAt: string | null }) {
  const opened = Boolean(clickedAt);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3.5 py-2.5",
        opened ? "border-success/25 bg-success-muted" : "border-dashed bg-card",
      )}
    >
      <MousePointerClickIcon
        className={cn(
          "size-4 shrink-0",
          opened ? "text-success" : "text-muted-foreground/50",
        )}
      />
      <span
        className={cn(
          "text-sm font-medium",
          opened ? "text-success" : "text-muted-foreground",
        )}
      >
        {opened ? "Link opened" : "Link not opened yet"}
      </span>
      {opened ? (
        <span className="font-mono text-xs tabular-nums text-success/80">
          {formatStamp(clickedAt)}
        </span>
      ) : null}
      <span className="ml-auto text-[11px] text-muted-foreground/70">
        our redirect
      </span>
    </div>
  );
}

// The compact table cell that showed Meta's furthest delivery state + click was
// folded into the single Outreach column (recovery-badges.tsx OutreachStatus),
// so the carts table has one channel-status column instead of two. The
// per-message timeline + click step above remain, for the cart drawer.
