import Link from "next/link";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  ShoppingCartIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Templates · Campaigns · Skelo" };

export default async function CampaignTemplatesPage() {
  await requireSession();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href="/campaigns" />}
        >
          <ArrowLeftIcon /> Back to campaigns
        </Button>
      </div>

      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Templates
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Ready-made calling flows for specific use cases. Unlike a normal
          campaign, a template runs on its own once it&apos;s set up.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <TemplateCard
          href="/campaigns/templates/cart-recovery"
          title="Cart Recovery"
          description="Automatically call shoppers who abandon checkout on your Shopify store and win the sale back with an offer."
          icon={<ShoppingCartIcon className="size-5" />}
        />
      </div>
    </div>
  );
}

function TemplateCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} className="group">
      <Card className="h-full p-0 transition-colors hover:bg-muted/40">
        <CardContent className="flex items-start gap-4 p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-tight">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </CardContent>
      </Card>
    </Link>
  );
}
