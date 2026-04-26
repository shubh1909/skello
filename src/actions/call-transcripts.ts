"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail, ok } from "@/types/action";
import type { CallTranscriptTurn } from "@/types/call-transcript";

const listSchema = z.object({
  call_id: z.string().uuid("Invalid call id"),
});

const TURN_COLUMNS =
  "id, call_id, organisation_id, seq, speaker, text, started_ms, ended_ms, confidence, created_at";

export async function listCallTranscript(
  input: unknown,
): Promise<ActionResult<CallTranscriptTurn[]>> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated");

  // RLS on call_transcripts scopes to the caller's org, so the filter below is
  // the only explicit scoping we need. Order is stable via (call_id, seq).
  const { data, error } = await supabase
    .from("call_transcripts")
    .select(TURN_COLUMNS)
    .eq("call_id", parsed.data.call_id)
    .order("seq", { ascending: true })
    .returns<CallTranscriptTurn[]>();

  if (error) return fail(error.message);
  return ok(data ?? []);
}
