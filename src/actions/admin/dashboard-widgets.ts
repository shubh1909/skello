"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type WidgetCreateInput,
  type WidgetDeleteInput,
  type WidgetExecuteRow,
  type WidgetReorderInput,
  type WidgetUpdateInput,
  widgetConfigSchema,
  widgetCreateSchema,
  widgetDeleteSchema,
  widgetReorderSchema,
  widgetUpdateSchema,
} from "@/lib/validations/dashboard-widget";
import { type ActionResult, fail, ok } from "@/types/action";
import type { OrgDashboardWidget } from "@/types/dashboard-widget";

const listSchema = z.object({
  organisation_id: z.string().uuid(),
});

function revalidateForOrg(orgId: string) {
  // Admin UI + the consumer dashboard both need to repaint.
  revalidatePath(`/admin/organisations/${orgId}/dashboard`);
  revalidatePath("/dashboard");
}

export async function listOrgDashboardWidgets(
  input: unknown,
): Promise<ActionResult<OrgDashboardWidget[]>> {
  await requireAdmin();
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_dashboard_widgets")
    .select("*")
    .eq("organisation_id", parsed.data.organisation_id)
    .order("position", { ascending: true })
    .returns<OrgDashboardWidget[]>();
  if (error) return fail(error.message);

  // Each row's `config` is JSONB; revalidate it against the latest
  // schema in case a stale config was written by an earlier code
  // revision. Failing config is surfaced but not fatal — the caller
  // can patch the bad widget.
  const items = (data ?? []).map((row) => {
    const result = widgetConfigSchema.safeParse(row.config);
    if (!result.success) {
      console.warn("[dashboard-widgets] config failed re-validation", {
        widgetId: row.id,
        issues: result.error.issues,
      });
    }
    return row;
  });

  return ok(items);
}

export async function createOrgDashboardWidget(
  input: WidgetCreateInput,
): Promise<ActionResult<OrgDashboardWidget>> {
  await requireAdmin();
  const parsed = widgetCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const admin = createAdminClient();

  // Position is "append" by default. Reading current max keeps the
  // ordering monotonic and survives reorders that left gaps.
  let position = parsed.data.position;
  if (position === undefined) {
    const { data: tail } = await admin
      .from("org_dashboard_widgets")
      .select("position")
      .eq("organisation_id", parsed.data.organisation_id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle<{ position: number }>();
    position = (tail?.position ?? -1) + 1;
  }

  const { data, error } = await admin
    .from("org_dashboard_widgets")
    .insert({
      organisation_id: parsed.data.organisation_id,
      title: parsed.data.title,
      config: parsed.data.config,
      enabled: parsed.data.enabled,
      position,
    })
    .select("*")
    .single<OrgDashboardWidget>();
  if (error) return fail(error.message);

  revalidateForOrg(parsed.data.organisation_id);
  return ok(data);
}

export async function updateOrgDashboardWidget(
  input: WidgetUpdateInput,
): Promise<ActionResult<OrgDashboardWidget>> {
  await requireAdmin();
  const parsed = widgetUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.config !== undefined) patch.config = parsed.data.config;
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (Object.keys(patch).length === 0) return fail("No fields to update");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_dashboard_widgets")
    .update(patch)
    .eq("id", parsed.data.id)
    // Scope by org as belt-and-braces against a mis-routed id from
    // the admin UI — the id is the PK and unique, but admin actions
    // should never trust a bare id when the org context is in hand.
    .eq("organisation_id", parsed.data.organisation_id)
    .select("*")
    .single<OrgDashboardWidget>();
  if (error) return fail(error.message);

  revalidateForOrg(parsed.data.organisation_id);
  return ok(data);
}

export async function reorderOrgDashboardWidgets(
  input: WidgetReorderInput,
): Promise<ActionResult<{ count: number }>> {
  await requireAdmin();
  const parsed = widgetReorderSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const admin = createAdminClient();

  // Verify all ids belong to the target org before issuing any update.
  // Stops a UI bug from re-positioning another org's widgets via a
  // crafted payload.
  const { data: existing, error: fetchErr } = await admin
    .from("org_dashboard_widgets")
    .select("id")
    .eq("organisation_id", parsed.data.organisation_id)
    .in("id", parsed.data.ordered_ids)
    .returns<{ id: string }[]>();
  if (fetchErr) return fail(fetchErr.message);
  if ((existing?.length ?? 0) !== parsed.data.ordered_ids.length) {
    return fail("Some widgets do not belong to this organisation.");
  }

  // Apply positions sequentially. There's no batched-update primitive
  // in the supabase JS client; the dataset is small (<=50) so the cost
  // is negligible. Each update is org-scoped for defence in depth.
  for (let i = 0; i < parsed.data.ordered_ids.length; i++) {
    const id = parsed.data.ordered_ids[i];
    const { error } = await admin
      .from("org_dashboard_widgets")
      .update({ position: i })
      .eq("id", id)
      .eq("organisation_id", parsed.data.organisation_id);
    if (error) return fail(error.message);
  }

  revalidateForOrg(parsed.data.organisation_id);
  return ok({ count: parsed.data.ordered_ids.length });
}

// Mirrors the consumer `executeOrgWidgets` action but takes a target
// `organisation_id` from input and runs through the service-role
// admin client. Drives the inline preview rendered next to each row
// in the admin widget list — without this, the platform admin can
// only see widget titles and would have to impersonate the org owner
// to actually look at their charts.
//
// Disabled widgets are included so the admin can preview "hidden"
// widgets too; the consumer path filters them out via .eq("enabled",
// true) instead.
export async function executeOrgDashboardWidgetsAdmin(
  input: unknown,
): Promise<
  ActionResult<
    Array<{ widget: OrgDashboardWidget; rows: WidgetExecuteRow[] }>
  >
> {
  await requireAdmin();
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: widgets, error: listErr } = await admin
    .from("org_dashboard_widgets")
    .select("*")
    .eq("organisation_id", parsed.data.organisation_id)
    .order("position", { ascending: true })
    .returns<OrgDashboardWidget[]>();
  if (listErr) return fail(listErr.message);
  if (!widgets || widgets.length === 0) return ok([]);

  const results = await Promise.all(
    widgets.map(async (widget) => {
      const configParsed = widgetConfigSchema.safeParse(widget.config);
      if (!configParsed.success) {
        console.warn("[dashboard-widgets/admin] invalid config", {
          widgetId: widget.id,
          issues: configParsed.error.issues,
        });
        return { widget, rows: [] as WidgetExecuteRow[] };
      }
      const config = configParsed.data;
      const { data, error } =
        config.kind === "sql"
          ? await admin.rpc("execute_dashboard_sql", {
              p_org_id: parsed.data.organisation_id,
              p_sql: config.sql,
            })
          : await admin.rpc("execute_dashboard_widget", {
              p_org_id: parsed.data.organisation_id,
              p_config: config,
            });
      if (error) {
        console.warn("[dashboard-widgets/admin] execute failed", {
          widgetId: widget.id,
          cause: error.message,
        });
        return { widget, rows: [] as WidgetExecuteRow[] };
      }
      return { widget, rows: (data ?? []) as WidgetExecuteRow[] };
    }),
  );

  return ok(results);
}

export async function deleteOrgDashboardWidget(
  input: WidgetDeleteInput,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = widgetDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("org_dashboard_widgets")
    .delete()
    .eq("id", parsed.data.id)
    .eq("organisation_id", parsed.data.organisation_id);
  if (error) return fail(error.message);

  revalidateForOrg(parsed.data.organisation_id);
  return ok({ id: parsed.data.id });
}
