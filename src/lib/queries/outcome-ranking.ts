import type { createClient } from "@/lib/supabase/server";
import {
  buildOutcomeRanking,
  type OutcomeRanking,
} from "@/lib/campaigns/best-disposition";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// Load an org's outcome priority order (from org_outcome_policies) and reduce it
// to the top-priority ranking used to pick a "best" disposition. Read with the
// caller's own RLS-scoped client — owners may select their org's policies, and
// it never leaks another tenant's vocabulary.
export async function loadOutcomeRanking(
  client: ServerClient,
  organisationId: string,
): Promise<OutcomeRanking> {
  const { data } = await client
    .from("org_outcome_policies")
    .select("outcome_key, position, is_fallback")
    .eq("organisation_id", organisationId)
    .returns<
      { outcome_key: string; position: number; is_fallback: boolean }[]
    >();
  return buildOutcomeRanking(data ?? []);
}
