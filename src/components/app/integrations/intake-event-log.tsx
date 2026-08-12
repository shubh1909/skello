"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { replayIntakeEvent } from "@/actions/lead-intake";
import {
  LEAD_INTAKE_STATUS_LABEL,
  type LeadIntakeEvent,
  type LeadIntakeEventStatus,
} from "@/types/lead-intake";

/**
 * Who the delivery was about, pulled from the raw payload.
 *
 * The ledger stores bodies, not parsed leads, so a row would otherwise read
 * "Lead created · 12 Aug 16:04" with no way to tell which lead. Per-channel
 * because each provider names its fields differently; an unknown shape simply
 * returns null and the row falls back to its timestamp alone.
 */
function describeEvent(event: LeadIntakeEvent): {
  label: string | null;
  phone: string | null;
} {
  const empty = { label: null, phone: null };
  if (event.channel !== "google_ads") return empty;

  const payload = event.payload as
    | { user_column_data?: Array<{ column_id?: string; string_value?: string }> }
    | null;
  const columns = Array.isArray(payload?.user_column_data)
    ? payload.user_column_data
    : [];

  const pick = (...ids: string[]): string | null => {
    for (const id of ids) {
      const hit = columns.find((c) => c?.column_id === id);
      const value = typeof hit?.string_value === "string" ? hit.string_value.trim() : "";
      if (value) return value;
    }
    return null;
  };

  const name =
    pick("FULL_NAME") ??
    [pick("FIRST_NAME"), pick("LAST_NAME")].filter(Boolean).join(" ").trim() ??
    null;
  const phone = pick("PHONE_NUMBER", "WORK_PHONE");
  return { label: name || phone || pick("EMAIL"), phone };
}

/** Badge tone per outcome. `test` is deliberately not a failure colour. */
const STATUS_VARIANT: Record<
  LeadIntakeEventStatus,
  "success" | "warning" | "destructive" | "neutral" | "info"
> = {
  processed: "success",
  duplicate: "neutral",
  test: "info",
  ignored: "neutral",
  received: "warning",
  failed: "destructive",
};

interface Props {
  events: LeadIntakeEvent[];
  total: number;
  /** Shown when nothing has arrived — the state most new endpoints are in. */
  emptyHint: string;
}

/**
 * The delivery log.
 *
 * The answer to "did my form work?", which is the only question anyone asks
 * during onboarding. Deliberately shows raw payloads: for a channel whose
 * schema we're still learning, the body IS the documentation.
 */
export function IntakeEventLog({ events, total, emptyHint }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Recent deliveries</CardTitle>
          {total > 0 ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {total.toLocaleString()} total
            </span>
          ) : null}
        </div>
        <CardDescription>
          Every delivery is recorded before anything else happens, so a lead that
          failed to save is still here and can be re-run.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
            {emptyHint}
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EventRow({ event }: { event: LeadIntakeEvent }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { label, phone } = describeEvent(event);

  function replay() {
    startTransition(async () => {
      const result = await replayIntakeEvent({ id: event.id });
      if (result.success) toast.success("Lead re-created from this delivery");
      else toast.error(result.error);
    });
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={STATUS_VARIANT[event.status]}>
          {LEAD_INTAKE_STATUS_LABEL[event.status]}
        </Badge>
        {label ? (
          <span className="truncate text-sm font-medium">{label}</span>
        ) : null}
        <span className="text-sm tabular-nums text-muted-foreground">
          {new Date(event.received_at).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
        {/* `?q=<phone>`, not `?lead=<id>`: the lead sheet opens from client
            state and there is no deep link to a single lead. Same workaround
            the call-detail pane and the ⌘K palette already use. */}
        {event.lead_id && phone ? (
          <Link
            href={`/leads?q=${encodeURIComponent(phone)}`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Find in Leads
          </Link>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          {/* Replay is offered for anything that did not become a lead. A
              processed row is excluded not because re-running would break — the
              ingest is find-or-create — but because there is nothing to fix. */}
          {event.status === "failed" || event.status === "received" ? (
            <Button variant="outline" size="sm" disabled={pending} onClick={replay}>
              <RotateCcwIcon /> {pending ? "Running…" : "Re-run"}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide payload" : "Payload"}
          </Button>
        </div>
      </div>

      {event.error ? (
        <p className="mt-1.5 text-xs leading-relaxed text-destructive">
          {event.error}
        </p>
      ) : null}

      {open ? (
        <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border/70 bg-muted/40 p-3 text-[11px] leading-relaxed">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}
