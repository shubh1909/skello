import "server-only";

import { logSkeloError, warnSkelo } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

export interface RouteByAgentResult {
  organisationId: string;
  enabled: boolean;
}

// Primary tenancy gate. The provider sends `agent_id` on every webhook —
// it's metadata, NOT extracted by the LLM. This means it's safe to route
// on, unlike `extracted_data.business_slug` which the model can drop or
// hallucinate. The voice_agents table enforces a single org per agent_id
// via PRIMARY KEY.
export async function resolveOrgByAgentId(
  agentId: string,
): Promise<RouteByAgentResult | null> {
  if (!agentId) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("resolve_org_by_agent", {
    p_agent_id: agentId,
  });
  if (error) {
    logSkeloError("ROUTING-RESOLVE", "agent_id resolver RPC failed", {
      agentId,
      cause: error,
    });
    return null;
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    warnSkelo("ROUTING-RESOLVE", "No workspace claims this agent_id", {
      agentId,
    });
    return null;
  }
  return {
    organisationId: row.organisation_id as string,
    enabled: row.enabled as boolean,
  };
}

// Defensive fallback for the rare case the provider drops `agent_id`. The
// dialled number (telephony_data.to_number) is also provider-sent metadata.
// Returns null on no match OR on ambiguous match (two orgs claiming the
// same DID — that's a misconfiguration we refuse to silently route through).
export async function resolveOrgByDialedNumber(
  toNumber: string,
): Promise<{ organisationId: string } | null> {
  if (!toNumber) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("resolve_org_by_dialed_number", {
    p_to_number: toNumber,
  });
  if (error) {
    logSkeloError("ROUTING-RESOLVE", "DID resolver RPC failed", {
      toNumber,
      cause: error,
    });
    return null;
  }
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    warnSkelo("ROUTING-RESOLVE", "Ambiguous DID — multiple workspaces claim it", {
      toNumber,
      orgs: rows.map((r) => r.organisation_id),
    });
    return null;
  }
  return { organisationId: rows[0].organisation_id as string };
}
