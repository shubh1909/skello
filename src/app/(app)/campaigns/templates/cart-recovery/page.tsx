import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CartRecoveryControls } from "@/components/app/cart-recovery-controls";
import { CartRecoveryDashboard } from "@/components/app/cart-recovery-dashboard";
import { CartRecoverySettingsForm } from "@/components/app/cart-recovery-settings-form";
import { CartRecoveryWorkspace } from "@/components/app/cart-recovery-workspace";
import { RecoveryAgentCard } from "@/components/app/recovery-agent-card";
import { RecoveryWhatsAppCard } from "@/components/app/recovery-whatsapp-card";
import {
  getAbandonedCarts,
  getConvertedCarts,
  getRecoveryCalls,
  getRecoveryOverview,
} from "@/actions/shopify-recovery";
import { requireSession } from "@/lib/auth/session";
import type {
  RecoveryAttemptRow,
  RecoveryCallRow,
  RecoveryPage,
} from "@/types/shopify";

export const metadata = { title: "Cart Recovery · Skelo" };

const EMPTY_PAGE: RecoveryPage<never> = { rows: [], total: 0 };

export default async function CartRecoveryTemplatePage() {
  const [session, overview, abandonedRes, convertedRes, callsRes] =
    await Promise.all([
      requireSession(),
      getRecoveryOverview(),
      getAbandonedCarts({ page: 0 }),
      getConvertedCarts({ page: 0 }),
      getRecoveryCalls({ page: 0 }),
    ]);

  if (!overview.success) {
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {overview.error}
      </Card>
    );
  }

  const { connected, settings, metrics, voiceAgent, whatsApp } = overview.data;
  const abandoned: RecoveryPage<RecoveryAttemptRow> = abandonedRes.success
    ? abandonedRes.data
    : EMPTY_PAGE;
  const converted: RecoveryPage<RecoveryAttemptRow> = convertedRes.success
    ? convertedRes.data
    : EMPTY_PAGE;
  const calls: RecoveryPage<RecoveryCallRow> = callsRes.success
    ? callsRes.data
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
            Cart Recovery
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            When a shopper abandons checkout on your store, the voice agent
            calls them after a short wait and offers an incentive to complete
            the purchase — and stops the moment they buy.
          </p>
        </div>
        <CartRecoveryControls
          running={settings?.enabled ?? false}
          hasHistory={metrics.abandoned > 0}
          connected={connected}
          whatsAppReady={Boolean(whatsApp?.configured && whatsApp?.enabled)}
        />
      </header>

      {!connected ? (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground">
          Your Shopify store isn&apos;t connected yet. Ask your Skelo contact to
          connect it, then turn cart recovery on below.
        </Card>
      ) : null}

      <CartRecoveryDashboard metrics={metrics} />

      <section className="grid gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <RecoveryAgentCard voiceAgent={voiceAgent} />
          <RecoveryWhatsAppCard whatsApp={whatsApp} />
        </div>
        <CartRecoverySettingsForm settings={settings} connected={connected} />
      </section>

      <CartRecoveryWorkspace
        organisationId={session.organisation.id}
        initialAbandoned={abandoned}
        initialConverted={converted}
        initialCalls={calls}
      />
    </div>
  );
}
