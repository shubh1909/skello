"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, SaveIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  deleteLeadSheetBinding,
  upsertLeadSheetBinding,
} from "@/actions/lead-sheet-bindings";
import { SectionLabel } from "@/components/app/section-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { humaniseFieldKey } from "@/lib/format/keys";
import { LEAD_SHEET_SLOT_INFO } from "@/lib/leads/sheet-slots";
import {
  BINDABLE_COLUMN_KEYS,
  BINDABLE_COLUMN_META,
} from "@/lib/leads/sheet-bindings";
import type { LeadFieldDefinition } from "@/types/lead-field-definition";
import type {
  LeadSheetBinding,
  LeadSheetFormat,
  LeadSheetSlot,
} from "@/types/lead-sheet-binding";

/**
 * Per-org layout editor for the lead detail sheet.
 *
 * Every slot is edited as a FIXED SET OF CELLS rather than as a list you add to
 * and remove from. "Card 2" is a place on screen; binding it to a different
 * field is a change to that place, not the creation of a new thing. That also
 * makes the position column self-evident — it is the row you are on — instead
 * of a number the admin has to keep consistent by hand.
 */

const SLOTS: Array<{
  slot: LeadSheetSlot;
  /** What one cell is called here — "Card 1" reads better than "Field 1". */
  cellNoun: string;
  cells: number;
}> = [
  { slot: "stat_card", cellNoun: "Card", cells: 3 },
  { slot: "wants", cellNoun: "Row", cells: 4 },
  { slot: "header_meta", cellNoun: "Item", cells: 5 },
];

const FORMATS: Array<{ value: LeadSheetFormat; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency_inr", label: "Rupees" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & time" },
  { value: "boolean", label: "Yes / No" },
  { value: "enum_badge", label: "Badge" },
];

/** A field address, encoded for a `<Select>` value. */
type FieldOption = {
  value: string;
  label: string;
  /** Heading this option sits under in the picker. */
  group: string;
  source_column: LeadFieldDefinition["source_column"];
  category: string;
  key_path: string;
};

/**
 * Group headings, in the order they appear.
 *
 * Ordered by how much an admin is likely to reach for them: the lead's own
 * fields first, then what the agent extracted, then call counts, then the
 * long tail of custom categories.
 */
const GROUP_LEAD = "Lead fields";
const GROUP_CAPTURED = "Captured by the voice agent";
const GROUP_ACTIVITY = "Call activity";
const GROUP_ORDER = [GROUP_LEAD, GROUP_CAPTURED, GROUP_ACTIVITY];

const NONE = "__none__";

function encode(
  source: LeadFieldDefinition["source_column"],
  category: string,
  key: string,
): string {
  return `${source}::${category}::${key}`;
}

export function LeadSheetLayoutManager({
  organisationId,
  bindings,
  definitions,
  slot,
}: {
  organisationId: string;
  bindings: LeadSheetBinding[];
  definitions: LeadFieldDefinition[];
  /**
   * Render one slot instead of all three. The admin page puts each slot behind
   * its own tab; passing the slot rather than splitting this into three
   * components keeps the option list, the picker and the save path in one
   * place, which is where the actual complexity lives.
   */
  slot?: LeadSheetSlot;
}) {
  /**
   * Bindable fields = the whole per-org catalog, plus the first-class columns
   * the resolver knows how to read.
   *
   * The catalog's own `column` rows are the ones an admin has curated for the
   * leads TABLE, which is a smaller set than the sheet can address — so the
   * resolver's allowlist is merged in rather than filtered by it.
   */
  const options = React.useMemo<FieldOption[]>(() => {
    const seen = new Set<string>();
    const out: FieldOption[] = [];

    for (const key of BINDABLE_COLUMN_KEYS) {
      const value = encode("column", "", key);
      seen.add(value);
      const meta = BINDABLE_COLUMN_META[key];
      out.push({
        value,
        // Deliberately NOT the catalog's label for these. Those are written for
        // a narrow table header ("In", "Out"); this list needs full names.
        label: meta?.label ?? humaniseFieldKey(key),
        group: meta?.group === "activity" ? GROUP_ACTIVITY : GROUP_LEAD,
        source_column: "column",
        category: "",
        key_path: key,
      });
    }

    for (const d of definitions) {
      if (d.source_column === "column") continue;
      const value = encode(d.source_column, d.category, d.key_path);
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({
        value,
        label: d.label ?? humaniseFieldKey(d.key_path),
        // Custom categories get a heading of their own rather than a
        // parenthesised prefix repeated on every option.
        group:
          d.source_column === "lead_data"
            ? GROUP_CAPTURED
            : d.category
              ? `Custom · ${humaniseFieldKey(d.category)}`
              : "Custom fields",
        source_column: d.source_column,
        category: d.category,
        key_path: d.key_path,
      });
    }

    return out;
  }, [definitions]);

  /** Options bucketed by heading, in GROUP_ORDER then alphabetically. */
  const grouped = React.useMemo(() => {
    const byGroup = new Map<string, FieldOption[]>();
    for (const o of options) {
      const bag = byGroup.get(o.group) ?? [];
      bag.push(o);
      byGroup.set(o.group, bag);
    }
    return [...byGroup.entries()].sort(([a], [b]) => {
      const ia = GROUP_ORDER.indexOf(a);
      const ib = GROUP_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) {
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      }
      return a.localeCompare(b);
    });
  }, [options]);

  const shown = slot ? SLOTS.filter((s) => s.slot === slot) : SLOTS;

  return (
    <div className="space-y-6">
      {shown.map((cfg) => (
        <section key={cfg.slot} className="space-y-2.5">
          {/* The heading is redundant when the page has already put this slot
              behind a tab of the same name. */}
          {slot ? null : (
            <div className="space-y-1">
              <SectionLabel as="h3">
                {LEAD_SHEET_SLOT_INFO[cfg.slot].title}
              </SectionLabel>
              <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {LEAD_SHEET_SLOT_INFO[cfg.slot].blurb}
              </p>
            </div>
          )}
          <div className="space-y-2">
            {Array.from({ length: cfg.cells }, (_, position) => {
              const binding =
                bindings.find(
                  (b) => b.slot === cfg.slot && b.slot_position === position,
                ) ?? null;
              return (
                <BindingRow
                  // `updated_at` is in the key so a saved row REMOUNTS with the
                  // server's values as its initial state. The alternative — an
                  // effect re-seeding the inputs when the prop changes — is a
                  // second source of truth for the same fields, always one
                  // render behind.
                  key={`${cfg.slot}-${position}-${binding?.updated_at ?? "empty"}`}
                  organisationId={organisationId}
                  slot={cfg.slot}
                  slotPosition={position}
                  binding={binding}
                  options={options}
                  grouped={grouped}
                  cellNoun={cfg.cellNoun}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function BindingRow({
  organisationId,
  slot,
  slotPosition,
  binding,
  options,
  grouped,
  cellNoun,
}: {
  organisationId: string;
  slot: LeadSheetSlot;
  slotPosition: number;
  binding: LeadSheetBinding | null;
  options: FieldOption[];
  grouped: Array<[string, FieldOption[]]>;
  cellNoun: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [field, setField] = React.useState(
    binding
      ? encode(binding.source_column, binding.category, binding.key_path)
      : NONE,
  );
  const [label, setLabel] = React.useState(binding?.label ?? "");
  const [format, setFormat] = React.useState<LeadSheetFormat>(
    binding?.format ?? "text",
  );
  const [caption, setCaption] = React.useState(binding?.caption_static ?? "");

  function onSave() {
    const picked = options.find((o) => o.value === field);
    if (!picked) {
      toast.error("Pick a field first");
      return;
    }
    startTransition(async () => {
      const result = await upsertLeadSheetBinding({
        organisation_id: organisationId,
        slot,
        slot_position: slotPosition,
        // Falling back to the field's own name means an admin can bind a slot
        // without also having to name it.
        label: label.trim() || picked.label,
        source_column: picked.source_column,
        category: picked.category,
        key_path: picked.key_path,
        caption_static: caption.trim() || null,
        format,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      router.refresh();
    });
  }

  function onClear() {
    if (!binding) return;
    startTransition(async () => {
      const result = await deleteLeadSheetBinding({
        organisation_id: organisationId,
        id: binding.id,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Cleared");
      router.refresh();
    });
  }

  const rowId = `${slot}-${slotPosition}`;

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-card p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor={`field-${rowId}`} className="text-xs">
          {cellNoun} {slotPosition + 1}
        </Label>
        {/* Base UI hands back `null` when a selection is cleared; the cell's
            "unset" state is the NONE sentinel, not null. */}
        <Select
          value={field}
          onValueChange={(v) => setField(v ?? NONE)}
          disabled={pending}
        >
          <SelectTrigger id={`field-${rowId}`} className="w-full">
            {/* Base UI renders the raw VALUE when SelectValue has no children —
                which here is the encoded address, e.g. "column::::phone". */}
            <SelectValue>
              {options.find((o) => o.value === field)?.label ?? "Not set"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={NONE}>Not set</SelectItem>
            {grouped.map(([group, opts]) => (
              <SelectGroup key={group}>
                <SelectLabel className="pt-2 font-semibold uppercase tracking-wider">
                  {group}
                </SelectLabel>
                {opts.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`label-${rowId}`} className="text-xs">
          Label
        </Label>
        <Input
          id={`label-${rowId}`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={pending}
          maxLength={60}
          placeholder="Budget fit"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`format-${rowId}`} className="text-xs">
          Format
        </Label>
        <Select
          value={format}
          onValueChange={(v) => setFormat(v as LeadSheetFormat)}
          disabled={pending}
        >
          <SelectTrigger id={`format-${rowId}`} className="w-full">
            <SelectValue>
              {FORMATS.find((f) => f.value === format)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FORMATS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`caption-${rowId}`} className="text-xs">
          {/* Only the card row draws a caption; saying so beats an admin
              filling it in for the header line and wondering where it went. */}
          {slot === "stat_card" ? "Caption" : "Caption (unused here)"}
        </Label>
        <Input
          id={`caption-${rowId}`}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          disabled={pending || slot !== "stat_card"}
          maxLength={120}
          placeholder="Fits 3 BHK band"
        />
      </div>

      <div className="flex items-center gap-1">
        <Button size="sm" onClick={onSave} disabled={pending || field === NONE}>
          {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          Save
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          disabled={pending || !binding}
          aria-label="Clear this slot"
        >
          <Trash2Icon />
        </Button>
      </div>
    </div>
  );
}
