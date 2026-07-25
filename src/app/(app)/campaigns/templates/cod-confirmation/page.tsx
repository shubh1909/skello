import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CodAgentCard } from "@/components/app/cod-agent-card";
import { CodConfirmationControls } from "@/components/app/cod-confirmation-controls";
import { CodTestAgentDialog } from "@/components/app/cod-test-agent-dialog";
import { CodConfirmationDashboard } from "@/components/app/cod-confirmation-dashboard";
import { CodConfirmationSettingsForm } from "@/components/app/cod-confirmation-settings-form";
import { CodConfirmationsTable } from "@/components/app/cod-confirmations-table";
import {
  getCodConfirmations,
  getCodOverview,
} from "@/actions/cod-confirmation";
import type { CodConfirmationRow, CodPage } from "@/types/cod";

export const metadata = { title: "COD Confirmation · Skelo" };

const EMPTY_PAGE: CodPage<never> = { rows: [], total: 0 };

export default async function CodConfirmationTemplatePage() {
  const [overview, confirmationsRes] = await Promise.all([
    getCodOverview(),
    getCodConfirmations({ page: 0 }),
  ]);

  if (!overview.success) {
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {overview.error}
      </Card>
    );
  }

  const { connected, settings, metrics, voiceAgent } = overview.data;
  const confirmations: CodPage<CodConfirmationRow> = confirmationsRes.success
    ? confirmationsRes.data
    : EMPTY_PAGE;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href="/campaigns/templates" />}
        >
          <ArrowLeftIcon /> Back to templates
        </Button>
      </div>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            COD Confirmation
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            When a shopper places a Cash-on-Delivery order, the voice agent calls
            them to reconfirm the order and payment method. If the call
            doesn&apos;t connect, it retries a few times; once you reach them, the
            answer is recorded and the order is left alone.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CodTestAgentDialog disabled={!connected} />
          <CodConfirmationControls
            running={settings?.enabled ?? false}
            connected={connected}
          />
        </div>
      </header>

      {!connected ? (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground">
          Your Shopify store isn&apos;t connected yet. Ask your Skelo contact to
          connect it, then turn COD confirmation on below.
        </Card>
      ) : null}

      <CodConfirmationDashboard metrics={metrics} />

      <section className="grid gap-3">
        <CodAgentCard voiceAgent={voiceAgent} />
        <CodConfirmationSettingsForm settings={settings} connected={connected} />
      </section>

      <CodConfirmationsTable
        rows={confirmations.rows}
        total={confirmations.total}
      />
    </div>
  );
}
