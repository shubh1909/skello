"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { setCodAgentAdmin } from "@/actions/admin/cod-confirmation";
import type { CodAgentAdminData } from "@/actions/admin/cod-confirmation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Radix Select can't hold "" — sentinel for "fall back to the org's default".
const DEFAULT_AGENT = "__default__";

interface Props {
  organisationId: string;
  data: CodAgentAdminData;
}

// Admin-only picker for the dedicated COD-confirmation voice agent. The agent
// itself is provisioned provider-side; here we point the COD flow at it.
export function CodAgentForm({ organisationId, data }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [agentId, setAgentId] = React.useState(
    data.agentId ?? DEFAULT_AGENT,
  );

  const defaultLabel = data.agents.find(
    (a) => a.agent_id === data.defaultAgentId,
  )?.label;

  function onSave() {
    startTransition(async () => {
      const res = await setCodAgentAdmin({
        organisation_id: organisationId,
        agent_id: agentId === DEFAULT_AGENT ? null : agentId,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("COD confirmation agent saved");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <Label>Confirmation voice agent</Label>
        <Select
          value={agentId}
          onValueChange={(v) => v && setAgentId(v)}
          disabled={pending}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_AGENT}>
              {data.defaultAgentId
                ? `Default agent (${defaultLabel ?? data.defaultAgentId})`
                : "Default agent"}
            </SelectItem>
            {data.agents.map((a) => (
              <SelectItem key={a.agent_id} value={a.agent_id}>
                {a.label ?? a.agent_id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Use a dedicated agent whose script reconfirms the order and extracts the{" "}
          <code className="text-foreground">confirmed</code> field. Register
          agents under Voice agents; leave on &ldquo;Default agent&rdquo; only if
          the org&apos;s default already handles COD confirmation.
        </p>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={onSave} disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : null}
          Save agent
        </Button>
      </div>
    </div>
  );
}
