"use server";

import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  type WidgetConfig,
  type WidgetExecuteRow,
  widgetConfigSchema,
} from "@/lib/validations/dashboard-widget";
import { type ActionResult, fail, ok } from "@/types/action";
import type { OrgDashboardWidget } from "@/types/dashboard-widget";

// Consumer (non-admin) actions for the dashboard render path.
//
// listOrgWidgetsForCurrentOrg — read-only fetch of the caller's
//   enabled widgets, ordered. Uses the cookie-bound user client; RLS
//   on org_dashboard_widgets restricts the read to the caller's own
//   org (Law #1 belt-and-braces).
//
// executeWidget — runs a single widget's config via the
//   execute_dashboard_widget RPC. Re-validates the config Zod-side
//   before executing so a tampered widget row can't smuggle an
//   unsupported source past the server.

export async function listOrgWidgetsForCurrentOrg(): Promise<
  ActionResult<OrgDashboardWidget[]>
> {
  const session = await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_dashboard_widgets")
    .select("*")
    .eq("organisation_id", session.organisation.id)
    .eq("enabled", true)
    .order("position", { ascending: true })
    .returns<OrgDashboardWidget[]>();
  if (error) return fail(error.message);
  return ok(data ?? []);
}

const executeSchema = z.object({
  widget_id: z.string().uuid(),
});

export async function executeWidget(
  input: unknown,
): Promise<ActionResult<{ rows: WidgetExecuteRow[]; config: WidgetConfig }>> {
  const session = await requireSession();
  const parsed = executeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();

  // Read the widget row scoped to the caller's org so a foreign
  // widget id collapses to "not found" rather than leaking that the
  // id exists in another tenant.
  const { data: widget, error: widgetErr } = await supabase
    .from("org_dashboard_widgets")
    .select("id, organisation_id, config, enabled")
    .eq("id", parsed.data.widget_id)
    .eq("organisation_id", session.organisation.id)
    .maybeSingle<{
      id: string;
      organisation_id: string;
      config: unknown;
      enabled: boolean;
    }>();
  if (widgetErr) return fail(widgetErr.message);
  if (!widget) return fail("Widget not found");
  if (!widget.enabled) return fail("Widget is disabled");

  const configParsed = widgetConfigSchema.safeParse(widget.config);
  if (!configParsed.success) {
    return fail(
      "Widget config is invalid. Ask your admin to repair it. " +
        (configParsed.error.issues[0]?.message ?? ""),
    );
  }

  const config = configParsed.data;
  const { data, error } =
    config.kind === "sql"
      ? await supabase.rpc("execute_dashboard_sql", {
          p_org_id: session.organisation.id,
          p_sql: config.sql,
        })
      : await supabase.rpc("execute_dashboard_widget", {
          p_org_id: session.organisation.id,
          p_config: config,
        });
  if (error) return fail(error.message);

  // supabase-js types RPC returns as the row union rather than the
  // set type, so widen-then-narrow rather than chaining .returns<T[]>().
  const rows = (data ?? []) as WidgetExecuteRow[];
  return ok({ rows, config: configParsed.data });
}

// Server-side bulk-execute used by the dashboard page's SSR render.
// Executes every enabled widget for the caller's org in parallel
// (Promise.all bounded by the existing widget cap of 50) so the SSR
// pass is a single round trip per widget instead of cascading awaits
// in the React tree.
export async function executeOrgWidgets(): Promise<
  ActionResult<
    Array<{ widget: OrgDashboardWidget; rows: WidgetExecuteRow[] }>
  >
> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: widgets, error: listErr } = await supabase
    .from("org_dashboard_widgets")
    .select("*")
    .eq("organisation_id", session.organisation.id)
    .eq("enabled", true)
    .order("position", { ascending: true })
    .returns<OrgDashboardWidget[]>();
  if (listErr) return fail(listErr.message);
  if (!widgets || widgets.length === 0) return ok([]);

  const results = await Promise.all(
    widgets.map(async (widget) => {
      const configParsed = widgetConfigSchema.safeParse(widget.config);
      if (!configParsed.success) {
        console.warn("[dashboard-widgets] skipping invalid widget", {
          widgetId: widget.id,
          issues: configParsed.error.issues,
        });
        return { widget, rows: [] as WidgetExecuteRow[] };
      }
      const config = configParsed.data;
      const { data, error } =
        config.kind === "sql"
          ? await supabase.rpc("execute_dashboard_sql", {
              p_org_id: session.organisation.id,
              p_sql: config.sql,
            })
          : await supabase.rpc("execute_dashboard_widget", {
              p_org_id: session.organisation.id,
              p_config: config,
            });
      if (error) {
        console.warn("[dashboard-widgets] widget execute failed", {
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
