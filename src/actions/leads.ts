"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  leadCreateSchema,
  leadIdSchema,
  leadListSchema,
  leadUpdateSchema,
} from "@/lib/validations/lead";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Lead } from "@/types/lead";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const LEAD_COLUMNS =
  "id, created_at, updated_at, org_slug, external_id, name, product, lead_intent, visit_date_time, customer_status, phone, wants_to_connect_on_watsapp, contacted_on_watsapp";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function userOwnsOrgBySlug(
  supabase: SupabaseServerClient,
  userId: string,
  orgSlug: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("organisations")
    .select("slug")
    .eq("slug", orgSlug)
    .eq("owner_id", userId)
    .maybeSingle<{ slug: string }>();
  return !!data;
}

export async function listLeads(
  input: unknown,
): Promise<ActionResult<{ items: Lead[]; total: number }>> {
  const parsed = leadListSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const {
    org_slug,
    limit,
    offset,
    q,
    lead_intent,
    customer_status,
    contacted_on_watsapp,
    wants_to_connect_on_watsapp,
    has_phone,
  } = parsed.data;

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrgBySlug(supabase, user.id, org_slug))) {
    return fail("Forbidden");
  }

  let query = supabase
    .from("leads")
    .select(LEAD_COLUMNS, { count: "exact" })
    .eq("org_slug", org_slug)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (lead_intent) query = query.eq("lead_intent", lead_intent);
  if (customer_status) query = query.eq("customer_status", customer_status);
  if (typeof contacted_on_watsapp === "boolean") {
    query = query.eq("contacted_on_watsapp", contacted_on_watsapp);
  }
  if (typeof wants_to_connect_on_watsapp === "boolean") {
    query = query.eq(
      "wants_to_connect_on_watsapp",
      wants_to_connect_on_watsapp,
    );
  }
  if (has_phone === true) query = query.not("phone", "is", null);
  if (has_phone === false) query = query.is("phone", null);
  if (q && q.trim().length > 0) {
    // Escape PostgREST wildcards so a user typing % doesn't broaden the search.
    const safe = q.replace(/[%,]/g, " ").trim();
    query = query.or(
      `name.ilike.%${safe}%,product.ilike.%${safe}%,phone.ilike.%${safe}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) return fail(error.message);

  return ok({ items: (data ?? []) as unknown as Lead[], total: count ?? 0 });
}

export async function getLead(id: unknown): Promise<ActionResult<Lead>> {
  const parsed = leadIdSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid lead id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const { data, error } = await supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", parsed.data)
    .maybeSingle<Lead>();

  if (error) return fail(error.message);
  if (!data) return fail("Lead not found");

  if (!data.org_slug || !(await userOwnsOrgBySlug(supabase, user.id, data.org_slug))) {
    return fail("Forbidden");
  }

  return ok(data);
}

export async function createLead(
  input: unknown,
): Promise<ActionResult<Lead>> {
  const parsed = leadCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrgBySlug(supabase, user.id, parsed.data.org_slug))) {
    return fail("Forbidden");
  }

  const { data, error } = await supabase
    .from("leads")
    .insert(parsed.data)
    .select(LEAD_COLUMNS)
    .single<Lead>();

  if (error) return fail(error.message);

  revalidatePath(`/organisations/${parsed.data.org_slug}/leads`);
  return ok(data);
}

export async function updateLead(
  id: unknown,
  input: unknown,
): Promise<ActionResult<Lead>> {
  const idParsed = leadIdSchema.safeParse(id);
  if (!idParsed.success) return fail("Invalid lead id");

  const parsed = leadUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (Object.keys(parsed.data).length === 0) return fail("No fields to update");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const { data: existing, error: fetchErr } = await supabase
    .from("leads")
    .select("org_slug")
    .eq("id", idParsed.data)
    .maybeSingle<{ org_slug: string | null }>();

  if (fetchErr) return fail(fetchErr.message);
  if (!existing) return fail("Lead not found");
  if (!existing.org_slug || !(await userOwnsOrgBySlug(supabase, user.id, existing.org_slug))) {
    return fail("Forbidden");
  }

  const { data, error } = await supabase
    .from("leads")
    .update(parsed.data)
    .eq("id", idParsed.data)
    .select(LEAD_COLUMNS)
    .single<Lead>();

  if (error) return fail(error.message);

  revalidatePath(`/organisations/${existing.org_slug}/leads`);
  revalidatePath(`/organisations/${existing.org_slug}/leads/${idParsed.data}`);
  return ok(data);
}

export async function deleteLead(
  id: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = leadIdSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid lead id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const { data: existing, error: fetchErr } = await supabase
    .from("leads")
    .select("org_slug")
    .eq("id", parsed.data)
    .maybeSingle<{ org_slug: string | null }>();

  if (fetchErr) return fail(fetchErr.message);
  if (!existing) return fail("Lead not found");
  if (!existing.org_slug || !(await userOwnsOrgBySlug(supabase, user.id, existing.org_slug))) {
    return fail("Forbidden");
  }

  const { error } = await supabase.from("leads").delete().eq("id", parsed.data);
  if (error) return fail(error.message);

  revalidatePath(`/organisations/${existing.org_slug}/leads`);
  return ok({ id: parsed.data });
}

export async function toggleLeadContactedOnWhatsApp(
  id: unknown,
): Promise<ActionResult<Lead>> {
  const parsed = leadIdSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid lead id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const { data: existing, error: fetchErr } = await supabase
    .from("leads")
    .select("org_slug, contacted_on_watsapp")
    .eq("id", parsed.data)
    .maybeSingle<{ org_slug: string | null; contacted_on_watsapp: boolean | null }>();

  if (fetchErr) return fail(fetchErr.message);
  if (!existing) return fail("Lead not found");
  if (!existing.org_slug || !(await userOwnsOrgBySlug(supabase, user.id, existing.org_slug))) {
    return fail("Forbidden");
  }

  const { data, error } = await supabase
    .from("leads")
    .update({ contacted_on_watsapp: !existing.contacted_on_watsapp })
    .eq("id", parsed.data)
    .select(LEAD_COLUMNS)
    .single<Lead>();

  if (error) return fail(error.message);

  revalidatePath(`/organisations/${existing.org_slug}/leads`);
  return ok(data);
}
