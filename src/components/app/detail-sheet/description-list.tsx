import * as React from "react";
import { InfoIcon } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isEmptyValue } from "@/lib/format/empty";
import { cn } from "@/lib/utils";

/**
 * The label/value list every detail sheet uses.
 *
 * Replaces THREE separate `Field` implementations (lead sheet, cart drawer, call
 * drawer) with different markup and — worse — different empty-value behaviour.
 *
 * Bespoke rather than shadcn's `Field`, which is form infrastructure:
 * `FieldControl`/`FieldError`/`data-invalid`, all wired to a control `id`. Using
 * it for read-only pairs ships a form component that renders no control and
 * mis-signals editability. shadcn `Field` is the right call for the EDIT forms;
 * this is the right call for display.
 *
 * ## Label LEFT, value right
 *
 * `dt` and `dd` are direct children of a `grid-cols-[auto_minmax(0,1fr)]` list,
 * which is what makes every label in a panel share one column and line up. The
 * earlier version wrapped each pair in its own `flex-col` box — label above
 * value — and because each box sized itself, nothing aligned with anything.
 * Reading a record is a scanning task: one label column, one value column.
 *
 * `minmax(0,1fr)` on the value column is load-bearing. Plain `1fr` floors at
 * min-content, so a single long unbroken value (an email, a URL, an id) widens
 * the whole sheet past the viewport. That exact bug shipped once already.
 *
 * ## The empty-value policy — this is the reflow fix
 *
 * The old `Field` returned `null` for an empty value *while being a direct child
 * of `grid grid-cols-2`*. A null child doesn't occupy a grid cell, so which
 * column each surviving field landed in changed from render to render and the
 * layout visibly reshuffled.
 *
 * So: an item NEVER returns null. Empty renders an em dash. Omission is a
 * LIST-level decision applied to the items array before layout (`omitEmpty`),
 * and it defaults to `false` — in a section describing a record, "Email —" is
 * information ("we don't have one"); silently vanishing is not. Turn it on only
 * for unbounded key lists (custom fields, "other extracted data").
 */

export interface DescriptionItemSpec {
  label: string;
  value: React.ReactNode;
  /** `(i)` tooltip. Prefer fixing the label — see the note in DetailTimeline. */
  hint?: string;
  /** e.g. a field-lock control that belongs beside the label. */
  adornment?: React.ReactNode;
  /**
   * Long values — a product list, a summary, an audio player.
   *
   * The label moves ABOVE the value and the value takes the full width. Keeping
   * it beside the label would squeeze a paragraph into the value column.
   */
  span?: "full";
  /** Phone numbers, ids. */
  mono?: boolean;
  /** Preserve newlines — summaries and notes. */
  multiline?: boolean;
  /** Skip this item entirely. Cleaner than a conditional at the call site. */
  when?: boolean;
}

export function DescriptionList({
  items,
  columns = 1,
  omitEmpty = false,
  className,
}: {
  items: DescriptionItemSpec[];
  /**
   * `2` puts two label/value pairs on a row once there's room for them.
   * Below `md` it always collapses to one pair — two label columns in a
   * phone-width sheet leaves nothing for the values.
   */
  columns?: 1 | 2;
  omitEmpty?: boolean;
  className?: string;
}) {
  const visible = items
    .filter((i) => i.when !== false)
    .filter((i) => (omitEmpty ? !isEmptyValue(i.value) : true));

  if (visible.length === 0) return null;

  return (
    <dl
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2.5",
        columns === 2 &&
          "md:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-x-6",
        className,
      )}
    >
      {visible.map((item) => (
        <DescriptionItem key={item.label} {...item} />
      ))}
    </dl>
  );
}

function DescriptionItem({
  label,
  value,
  hint,
  adornment,
  span,
  mono,
  multiline,
}: DescriptionItemSpec) {
  const empty = isEmptyValue(value);
  const full = span === "full";

  return (
    <>
      <dt
        className={cn(
          "flex items-center gap-1 text-xs leading-relaxed text-muted-foreground",
          // A full-width item puts its label on its own row above the value.
          full && "col-span-full",
        )}
      >
        {label}
        {hint ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`About ${label}`}
                  className="inline-flex cursor-help text-muted-foreground hover:text-foreground"
                />
              }
            >
              <InfoIcon className="size-3" />
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        ) : null}
        {adornment}
      </dt>
      <dd
        className={cn(
          // `truncate` is BANNED here. It silently clipped extracted values in
          // the call drawer, so a long answer looked like a short one.
          // 15px, not 14: a sheet is a reading surface, not a dense table.
          "min-w-0 text-[15px] leading-relaxed wrap-break-word",
          full && "col-span-full",
          mono && "font-mono tabular-nums",
          multiline && "whitespace-pre-wrap",
          empty && "text-muted-foreground",
        )}
      >
        {empty ? "—" : value}
      </dd>
    </>
  );
}
