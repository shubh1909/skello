import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WidgetListClient } from "@/components/admin/dashboard/widget-list-client";
import { getDashboardSourceCatalog } from "@/actions/admin/dashboard-catalog";
import {
  executeOrgDashboardWidgetsAdmin,
  listOrgDashboardWidgets,
} from "@/actions/admin/dashboard-widgets";
import { getOrganisationAdmin } from "@/actions/admin/organisations";
import type { WidgetExecuteRow } from "@/lib/validations/dashboard-widget";

export const metadata = { title: "Dashboard · Organisation · Admin · Skelo" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminOrgDashboardConfigPage({
  params,
}: PageProps) {
  const { id } = await params;

  const [orgResult, widgetsResult, catalogResult, executedResult] =
    await Promise.all([
      getOrganisationAdmin(id),
      listOrgDashboardWidgets({ organisation_id: id }),
      getDashboardSourceCatalog({ organisation_id: id }),
      // Pre-execute every widget so the list can render its actual
      // chart inline. Admin sees the live preview of what the org
      // owner sees on /dashboard, no impersonation needed.
      executeOrgDashboardWidgetsAdmin({ organisation_id: id }),
    ]);

  if (!orgResult.success) {
    if (orgResult.error === "Organisation not found") notFound();
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {orgResult.error}
      </Card>
    );
  }
  if (!widgetsResult.success) {
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {widgetsResult.error}
      </Card>
    );
  }
  if (!catalogResult.success) {
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {catalogResult.error}
      </Card>
    );
  }

  // executedResult failures shouldn't take down the page — the list
  // still works for create/reorder even if preview rows are missing.
  // We pass an empty map; each widget renders the empty-state card.
  const rowsById: Record<string, WidgetExecuteRow[]> = {};
  if (executedResult.success) {
    for (const { widget, rows } of executedResult.data) {
      rowsById[widget.id] = rows;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href={`/admin/organisations/${orgResult.data.id}`} />}
        >
          <ArrowLeftIcon /> Back to organisation
        </Button>
      </div>

      <header className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Dashboard
        </p>
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          {orgResult.data.name}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Compose what {orgResult.data.name} sees on{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            /dashboard
          </code>
          . Order, hide, and pick chart types per widget. While no widgets
          are configured the workspace sees the default dashboard.
        </p>
      </header>

      <WidgetListClient
        organisationId={orgResult.data.id}
        initialWidgets={widgetsResult.data}
        catalog={catalogResult.data}
        rowsById={rowsById}
      />
    </div>
  );
}
