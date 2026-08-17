"use client";

import { useState, useTransition } from "react";
import { SparklesIcon, WandSparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateIntakeSource } from "@/actions/lead-intake";
import { PORTAL_TARGET_LABEL, type PortalTarget } from "@/lib/intake/portal";
import { cn } from "@/lib/utils";
import type { ObservedPortalField } from "@/types/lead-intake";

/** The lead fields a portal value can be pointed at, in the picker's order. */
const TARGETS: PortalTarget[] = [
  "phone",
  "name",
  "first_name",
  "last_name",
  "email",
  "city",
  "pincode",
  "ignore",
];

/** Sentinel for "keep it as a custom field", which is not a PortalTarget. */
const CUSTOM = "__custom__";

interface Props {
  organisationId: string;
  sourceId: string;
  fields: ObservedPortalField[];
  fieldMap: Record<string, string>;
}

/**
 * Map what the portal sends onto what Skelo stores.
 *
 * Built from the deliveries themselves, because no property portal publishes a
 * schema and the field names differ per seller account — the payloads are the
 * only documentation that exists. Every row is a field we have actually
 * received, with the most recent value beside it, so the mapping can be checked
 * against real data rather than guessed twice.
 *
 * Rows marked "guessed" came from the built-in alias table. Those are the ones
 * worth an admin's eyes; everything else is either their own choice or is being
 * kept verbatim as a custom field, which is always safe.
 */
export function PortalFieldMapEditor({
  organisationId,
  sourceId,
  fields,
  fieldMap,
}: Props) {
  const [draft, setDraft] = useState<Record<string, string>>(fieldMap);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(draft) !== JSON.stringify(fieldMap);

  function save() {
    startTransition(async () => {
      const result = await updateIntakeSource({
        organisation_id: organisationId,
        id: sourceId,
        field_map: draft,
      });
      if (result.success) {
        toast.success(
          "Mapping saved. Re-run a delivery from the log to apply it to a lead already created.",
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  if (fields.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          Nothing has arrived yet. Once the first enquiry lands, every field it
          carried appears here with its value, ready to map.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Field the portal sends</th>
              <th className="pb-2 font-medium">Most recent value</th>
              <th className="pb-2 font-medium">Store it as</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {fields.map((field) => {
              const current = draft[field.path];
              const selected =
                current && TARGETS.includes(current as PortalTarget)
                  ? current
                  : current
                    ? CUSTOM
                    : field.target
                      ? field.target
                      : CUSTOM;
              const customValue =
                selected === CUSTOM
                  ? (current && !TARGETS.includes(current as PortalTarget)
                      ? current
                      : (field.customKey ?? ""))
                  : "";

              return (
                <tr key={field.path} className="align-top">
                  <td className="py-2.5 pr-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <code className="font-mono text-xs">{field.path}</code>
                      {field.source === "alias" ? (
                        <Badge variant="warning" className="gap-1">
                          <SparklesIcon className="size-3" /> guessed
                        </Badge>
                      ) : field.source === "map" ? (
                        <Badge variant="info">yours</Badge>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      seen in {field.seen} of the last deliveries
                    </p>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {field.sample}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Select
                        value={selected}
                        onValueChange={(v) => {
                          const next = v ?? CUSTOM;
                          setDraft((d) => ({
                            ...d,
                            [field.path]:
                              next === CUSTOM
                                ? (customValue || field.customKey || "field")
                                : next,
                          }));
                        }}
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue>
                            {selected === CUSTOM
                              ? "Custom field"
                              : PORTAL_TARGET_LABEL[selected as PortalTarget]}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {TARGETS.map((t) => (
                            <SelectItem key={t} value={t}>
                              {PORTAL_TARGET_LABEL[t]}
                            </SelectItem>
                          ))}
                          <SelectItem value={CUSTOM}>Custom field</SelectItem>
                        </SelectContent>
                      </Select>

                      {selected === CUSTOM ? (
                        <Input
                          aria-label={`Custom field name for ${field.path}`}
                          className="w-40"
                          placeholder="field name"
                          value={customValue}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              [field.path]: e.target.value,
                            }))
                          }
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending || !dirty} onClick={save}>
          <WandSparklesIcon />
          {pending ? "Saving…" : "Save mapping"}
        </Button>
        {dirty ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setDraft(fieldMap)}
          >
            Discard changes
          </Button>
        ) : null}
        <p
          className={cn(
            "text-xs text-muted-foreground",
            dirty && "text-foreground",
          )}
        >
          Applies to enquiries from now on. To fix leads already created, re-run
          those deliveries from the log.
        </p>
      </div>
    </div>
  );
}
