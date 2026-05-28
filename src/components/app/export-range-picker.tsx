"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EXPORT_RANGE_OPTIONS,
  type ExportRangePreset,
  boundsForPreset,
  localDateInputToFromIso,
  localDateInputToToIso,
} from "@/lib/csv-date-ranges";

export interface ExportRangeValue {
  preset: ExportRangePreset;
  // Bound to the <input type="date"> components (YYYY-MM-DD, local tz).
  // Only relevant when preset === "custom"; the picker keeps them as
  // controlled state so re-opening the dialog preserves what the user
  // typed.
  customFrom: string;
  customTo: string;
}

export const DEFAULT_EXPORT_RANGE_VALUE: ExportRangeValue = {
  preset: "last_30_days",
  customFrom: "",
  customTo: "",
};

// Resolve a picker value to the ISO from/to pair that gets posted to the
// export API. Returns an `error` string when the user picked "custom" but
// the inputs are missing / invalid / inverted so the dialog can refuse to
// submit instead of silently producing an empty CSV.
export function resolveExportRange(value: ExportRangeValue): {
  from: string | null;
  to: string | null;
  error: string | null;
} {
  if (value.preset !== "custom") {
    const bounds = boundsForPreset(value.preset);
    return { from: bounds.from, to: bounds.to, error: null };
  }
  const trimmedFrom = value.customFrom.trim();
  const trimmedTo = value.customTo.trim();
  if (!trimmedFrom && !trimmedTo) {
    return {
      from: null,
      to: null,
      error: "Pick a from and / or to date for the custom range.",
    };
  }
  const fromIso = trimmedFrom ? localDateInputToFromIso(trimmedFrom) : null;
  const toIso = trimmedTo ? localDateInputToToIso(trimmedTo) : null;
  if (trimmedFrom && !fromIso) {
    return { from: null, to: null, error: "Invalid 'from' date." };
  }
  if (trimmedTo && !toIso) {
    return { from: null, to: null, error: "Invalid 'to' date." };
  }
  if (fromIso && toIso && new Date(fromIso) >= new Date(toIso)) {
    return {
      from: null,
      to: null,
      error: "'From' must be earlier than 'to'.",
    };
  }
  return { from: fromIso, to: toIso, error: null };
}

export function ExportRangePicker({
  value,
  onChange,
  disabled,
  idPrefix = "export",
}: {
  value: ExportRangeValue;
  onChange: (next: ExportRangeValue) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const presetId = `${idPrefix}-range-preset`;
  const fromId = `${idPrefix}-range-from`;
  const toId = `${idPrefix}-range-to`;
  const isCustom = value.preset === "custom";

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={presetId}>Duration</Label>
        <Select
          value={value.preset}
          onValueChange={(v) =>
            onChange({ ...value, preset: (v as ExportRangePreset) ?? value.preset })
          }
          disabled={disabled}
        >
          <SelectTrigger id={presetId} className="w-full">
            <SelectValue>
              {EXPORT_RANGE_OPTIONS.find((o) => o.value === value.preset)
                ?.label ?? null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {EXPORT_RANGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                <div className="flex flex-col">
                  <span>{o.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {o.hint}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isCustom ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={fromId} className="text-xs">
              From
            </Label>
            <Input
              id={fromId}
              type="date"
              value={value.customFrom}
              onChange={(e) =>
                onChange({ ...value, customFrom: e.target.value })
              }
              disabled={disabled}
              max={value.customTo || undefined}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={toId} className="text-xs">
              To
            </Label>
            <Input
              id={toId}
              type="date"
              value={value.customTo}
              onChange={(e) =>
                onChange({ ...value, customTo: e.target.value })
              }
              disabled={disabled}
              min={value.customFrom || undefined}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
