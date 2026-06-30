import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CartRecoveryControls } from "@/components/app/cart-recovery-controls";
import { CartRecoveryDashboard } from "@/components/app/cart-recovery-dashboard";
import { CartRecoverySettingsForm } from "@/components/app/cart-recovery-settings-form";
import { getRecoveryOverview } from "@/actions/shopify-recovery";

export const metadata = { title: "Cart Recovery · Skelo" };

export default async function CartRecoveryTemplatePage() {
  const result = await getRecoveryOverview();

  if (!result.success) {
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {result.error}
      </Card>
    );
  }

  const { connected, settings, metrics, attempts } = result.data;

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
            When a shopper abandons checkout on your store, the voice agent calls
            them after a short wait and offers an incentive to complete the
            purchase — and stops the moment they buy.
          </p>
        </div>
        <CartRecoveryControls
          running={settings?.enabled ?? false}
          hasHistory={metrics.abandoned > 0}
          connected={connected}
        />
      </header>

      {!connected ? (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground">
          Your Shopify store isn&apos;t connected yet. Ask your Skelo contact to
          connect it, then turn cart recovery on below.
        </Card>
      ) : null}

      <CartRecoveryDashboard metrics={metrics} attempts={attempts} />

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Settings
        </h2>
        <CartRecoverySettingsForm settings={settings} connected={connected} />
      </section>
    </div>
  );
}
