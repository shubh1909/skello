"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { EyeIcon, EyeOffIcon, Loader2Icon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateLeadFieldDefinition } from "@/actions/lead-field-definitions";
import { formatDateTime } from "@/lib/format";
import type {
  LeadFieldDataType,
  LeadFieldDefinition,
} from "@/types/lead-field-definition";

interface Props {
  organisationId: string;
  definitions: LeadFieldDefinition[];
}

const DATA_TYPES: LeadFieldDataType[] = [
  "string",
  "number",
  "boolean",
  "date",
  "enum",
  "unknown",
];

const DATA_TYPE_LABEL: Record<LeadFieldDataType, string> = {
  string: "Text",
  number: "Number",
  boolean: "Yes / No",
  date: "Date",
  enum: "Picklist",
  unknown: "Unknown",
};

export function LeadFieldsCatalogManager({
  organisationId,
  definitions,
}: Props) {
  if (definitions.length === 0) {
    return (
      <Card className="items-center gap-2 py-16 text-center">
        <p className="text-sm font-medium">No fields discovered yet</p>
        <p className="max-w-md text-xs text-muted-foreground">
          Receive a call from a linked voice agent. Every field the agent
          extracts will appear here automatically, ready for you to expose
          or hide on the leads table.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border/60 bg-muted/30">
            <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-5 py-3 font-medium">Field</th>
              <th className="px-3 py-3 font-medium">Type</th>
              <th className="px-3 py-3 font-medium">Sample value</th>
              <th className="px-3 py-3 text-center font-medium">Visible</th>
              <th className="px-3 py-3 text-center font-medium">Filterable</th>
              <th className="px-3 py-3 text-center font-medium">Sortable</th>
              <th className="px-3 py-3 text-center font-medium">Searchable</th>
              <th className="px-3 py-3 font-medium">Last seen</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {definitions.map((def) => (
              <FieldRow
                key={def.id}
                organisationId={organisationId}
                def={def}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

interface RowState {
  label: string;
  dataType: LeadFieldDataType;
  visible: boolean;
  filterable: boolean;
  sortable: boolean;
  searchable: boolean;
}

function toRowState(def: LeadFieldDefinition): RowState {
  return {
    label: def.label ?? "",
    dataType: def.data_type,
    visible: def.visible_in_table,
    filterable: def.filterable,
    sortable: def.sortable,
    searchable: def.searchable,
  };
}

function diffState(
  state: RowState,
  def: LeadFieldDefinition,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const nextLabel = state.label.trim() || null;
  if (nextLabel !== (def.label ?? null)) patch.label = nextLabel;
  if (state.dataType !== def.data_type) patch.data_type = state.dataType;
  if (state.visible !== def.visible_in_table) patch.visible_in_table = state.visible;
  if (state.filterable !== def.filterable) patch.filterable = state.filterable;
  if (state.sortable !== def.sortable) patch.sortable = state.sortable;
  if (state.searchable !== def.searchable) patch.searchable = state.searchable;
  return patch;
}

function FieldRow({
  organisationId,
  def,
}: {
  organisationId: string;
  def: LeadFieldDefinition;
}) {
  const router = useRouter();
  const [state, setState] = React.useState<RowState>(() => toRowState(def));
  const [pending, startTransition] = React.useTransition();

  const dirty = React.useMemo(
    () => Object.keys(diffState(state, def)).length > 0,
    [state, def],
  );

  function set<K extends keyof RowState>(key: K, value: RowState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function onSave() {
    const patch = diffState(state, def);
    if (Object.keys(patch).length === 0) return;
    startTransition(async () => {
      const res = await updateLeadFieldDefinition({
        id: def.id,
        organisation_id: organisationId,
        ...patch,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Field updated");
      router.refresh();
    });
  }

  function onRevert() {
    setState(toRowState(def));
  }

  const sourceLabel =
    def.source_column === "lead_data"
      ? "Standard"
      : def.category
        ? `Custom · ${def.category}`
        : "Custom";

  return (
    <tr className="align-middle">
      <td className="px-5 py-3">
        <div className="flex flex-col gap-1">
          <Input
            value={state.label}
            onChange={(e) => set("label", e.target.value)}
            placeholder={humaniseKey(def.key_path)}
            maxLength={200}
            className="h-8 max-w-[260px]"
          />
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {def.key_path}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {sourceLabel}
            </Badge>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <Select
          value={state.dataType}
          onValueChange={(v) => set("dataType", v as LeadFieldDataType)}
        >
          <SelectTrigger className="h-8 w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATA_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {DATA_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-3">
        <span
          className="line-clamp-1 max-w-[180px] font-mono text-[11px] text-muted-foreground"
          title={formatSample(def.sample_value)}
        >
          {formatSample(def.sample_value)}
        </span>
      </td>
      <CenterCell>
        <ToggleIcon
          on={state.visible}
          onClick={() => set("visible", !state.visible)}
          onIcon={<EyeIcon className="size-3.5" />}
          offIcon={<EyeOffIcon className="size-3.5" />}
          label={state.visible ? "Visible on leads table" : "Hidden"}
        />
      </CenterCell>
      <CenterCell>
        <Checkbox
          checked={state.filterable}
          onChange={(v) => set("filterable", v)}
          label="filterable"
        />
      </CenterCell>
      <CenterCell>
        <Checkbox
          checked={state.sortable}
          onChange={(v) => set("sortable", v)}
          label="sortable"
        />
      </CenterCell>
      <CenterCell>
        <Checkbox
          checked={state.searchable}
          onChange={(v) => set("searchable", v)}
          label="searchable"
        />
      </CenterCell>
      <td className="px-3 py-3 text-xs text-muted-foreground">
        <span suppressHydrationWarning>
          {formatDateTime(def.last_seen_at)}
        </span>
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-1.5">
          {dirty ? (
            <>
              <Button size="xs" variant="ghost" onClick={onRevert}>
                Revert
              </Button>
              <Button size="xs" onClick={onSave} disabled={pending}>
                {pending ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <SaveIcon />
                )}
                Save
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      </td>
    </tr>
  );
}

function CenterCell({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-3 text-center">{children}</td>;
}

function ToggleIcon({
  on,
  onClick,
  onIcon,
  offIcon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={
        on
          ? "inline-flex size-7 items-center justify-center rounded-md bg-foreground text-background transition-colors hover:opacity-90"
          : "inline-flex size-7 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground transition-colors hover:bg-muted"
      }
    >
      {on ? onIcon : offIcon}
    </button>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      className="size-4 cursor-pointer accent-foreground"
    />
  );
}

function formatSample(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function humaniseKey(key: string): string {
  return key
    .split("_")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
