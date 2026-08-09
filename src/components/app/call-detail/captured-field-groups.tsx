import * as React from "react";

import { formatDateTime } from "@/lib/format";
import { humaniseFieldKey } from "@/lib/format/keys";
import type { CustomFieldsGroup } from "@/lib/leads/captured-fields";
import { cn } from "@/lib/utils";

/**
 * The generic "whatever else the agent extracted" grid.
 *
 * Grouped by `custom_data` category, with the flat `lead_data` leftovers hoisted
 * into an unlabelled first group. Keys are humanised rather than dumped raw —
 * this list used to render `lead_intent_extracted` at the user.
 */
export function CapturedFieldGroups({
  groups,
  bare = false,
}: {
  groups: CustomFieldsGroup[];
  /**
   * Drop each group's own border and fill.
   *
   * Set this when the caller already frames the content — a `DetailPanel` is a
   * bordered card, and a bordered group inside it is a border inside a border.
   */
  bare?: boolean;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group, i) => (
        <div
          key={`${group.category || "ungrouped"}-${i}`}
          className="flex flex-col gap-1.5"
        >
          {group.category ? (
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {humaniseFieldKey(group.category)}
            </div>
          ) : null}
          <dl
            className={cn(
              "grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 text-sm",
              !bare && "rounded-md border border-border/70 bg-card px-3 py-2.5",
            )}
          >
            {group.entries.map(([key, value]) => (
              <React.Fragment key={key}>
                <dt className="text-xs leading-relaxed text-muted-foreground">
                  {humaniseFieldKey(key)}
                </dt>
                <dd className="min-w-0 leading-relaxed wrap-break-word">
                  {renderFieldValue(value)}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function looksLikeIsoDate(s: string): boolean {
  const t = s.trim();
  if (t.length < 8) return false;
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
    t,
  );
}

/**
 * Render a value out of an open-ended JSONB blob.
 *
 * The types are whatever the extractor produced, so every branch here is a real
 * case seen in production: booleans arrive as `true` and as `"yes"`, dates as
 * ISO strings, and the occasional nested object.
 */
export function renderFieldValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString() : String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return <span className="text-muted-foreground">—</span>;
    const lower = trimmed.toLowerCase();
    if (lower === "yes" || lower === "true") return "Yes";
    if (lower === "no" || lower === "false") return "No";
    if (looksLikeIsoDate(trimmed)) {
      const d = new Date(trimmed);
      if (!Number.isNaN(d.getTime())) {
        return <span suppressHydrationWarning>{formatDateTime(trimmed)}</span>;
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    if (value.length === 0)
      return <span className="text-muted-foreground">—</span>;
    return value
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join(", ");
  }
  // Plain object — a compact code block keeps the structure legible without
  // dumping a multi-line JSON tree into a detail panel.
  return (
    <code className="text-xs text-muted-foreground wrap-break-word">
      {JSON.stringify(value)}
    </code>
  );
}
