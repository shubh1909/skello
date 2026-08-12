"use client";

import * as React from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INTENT_LABEL } from "@/lib/leads/intent";
import { LEAD_STATUS_LABEL, LEAD_STATUS_ORDER } from "@/lib/leads/status";
import { cn } from "@/lib/utils";
import type { ResolvedBinding } from "@/lib/leads/sheet-bindings";
import type { LeadIntent, LeadStatus } from "@/types/lead";

const INTENTS: readonly LeadIntent[] = ["hot", "warm", "cold"];

/** Sentinel for "no value". Base UI selects can't hold an empty string value. */
const UNSET = "__unset__";

/**
 * Tints for the two state pickers.
 *
 * These carry the colour a badge used to. The sheet showed BOTH a "Cold" badge
 * and a "cold" picker sitting two centimetres apart — the same word twice, one
 * of them inert. Colouring the control that actually does something keeps the
 * at-a-glance signal and removes the duplicate.
 *
 * Muted fills only: these sit in the header beside a filled primary button, and
 * a saturated chip here would out-shout the action.
 */
const INTENT_TINT: Record<LeadIntent, string> = {
  hot: "border-destructive/30 bg-destructive-muted text-destructive",
  warm: "border-warning/30 bg-warning-muted text-warning",
  cold: "border-info/30 bg-info-muted text-info",
};

const STATUS_TINT: Record<LeadStatus, string> = {
  new: "border-info/30 bg-info-muted text-info",
  contacted: "border-border bg-muted text-muted-foreground",
  qualified: "border-success/30 bg-success-muted text-success",
  negotiating: "border-warning/30 bg-warning-muted text-warning",
  won: "border-success/30 bg-success-muted text-success",
  lost: "border-destructive/30 bg-destructive-muted text-destructive",
};

/**
 * The three pickers under the lead's name: intent, pipeline status, owner.
 *
 * They save on change rather than behind an Edit button. These are the fields a
 * salesperson changes mid-call, and making them wait for edit → change → save
 * is what pushes people to stop maintaining them at all. Everything else about
 * the lead still edits through the Details tab's form.
 */
export function LeadHeaderControls({
  intent,
  status,
  ownerLabel,
  ownerOptions,
  meta,
  disabled,
  onIntentChange,
  onStatusChange,
  onOwnerChange,
}: {
  intent: LeadIntent | null;
  status: LeadStatus;
  ownerLabel: string | null;
  /** Curated per org via lead_field_definitions.enum_options for owner_label. */
  ownerOptions: string[];
  /** The configurable meta line: phone · city · budget · source. */
  meta: ResolvedBinding[];
  disabled: boolean;
  onIntentChange: (next: LeadIntent | null) => void;
  onStatusChange: (next: LeadStatus) => void;
  onOwnerChange: (next: string | null) => void;
}) {
  return (
    <div className="w-full space-y-2">
      {meta.length > 0 ? (
        <p className="text-sm leading-relaxed whitespace-normal text-muted-foreground">
          {meta.map((m, i) => (
            <React.Fragment key={m.id}>
              {i > 0 ? <span className="px-1.5">·</span> : null}
              <span title={m.label}>{m.display}</span>
            </React.Fragment>
          ))}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={intent ?? UNSET}
          onValueChange={(v) =>
            onIntentChange(v === UNSET ? null : (v as LeadIntent))
          }
          disabled={disabled}
        >
          <SelectTrigger
            size="sm"
            aria-label="Intent"
            className={cn(
              "w-32 font-medium",
              intent ? INTENT_TINT[intent] : "text-muted-foreground",
            )}
          >
            {/* The label has to be passed as children. Base UI's SelectValue
                renders the raw VALUE when given none, which put a lowercase
                "cold" in the trigger while the badge beside it said "Cold". */}
            <SelectValue>{intent ? INTENT_LABEL[intent] : "No intent"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>No intent</SelectItem>
            {INTENTS.map((v) => (
              <SelectItem key={v} value={v}>
                {INTENT_LABEL[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={status}
          onValueChange={(v) => onStatusChange(v as LeadStatus)}
          disabled={disabled}
        >
          <SelectTrigger
            size="sm"
            aria-label="Status"
            className={cn("w-36 font-medium", STATUS_TINT[status])}
          >
            <SelectValue>{LEAD_STATUS_LABEL[status]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {LEAD_STATUS_ORDER.map((v) => (
              <SelectItem key={v} value={v}>
                {LEAD_STATUS_LABEL[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* The owner picker only appears once an admin has curated the option
            list. An empty dropdown labelled "Owner" invites a click that can
            never do anything, and the fix for it lives in a different app. */}
        {ownerOptions.length > 0 ? (
          <>
            <span className="text-sm text-muted-foreground">Owner</span>
            <Select
              value={ownerLabel ?? UNSET}
              onValueChange={(v) => onOwnerChange(v === UNSET ? null : v)}
              disabled={disabled}
            >
              <SelectTrigger size="sm" className="w-44" aria-label="Owner">
                <SelectValue>{ownerLabel ?? "Unassigned"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Unassigned</SelectItem>
                {ownerOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : null}
      </div>
    </div>
  );
}
