import {
  CheckCircle2Icon,
  PhoneIcon,
  ShoppingCartIcon,
  TrendingUpIcon,
} from "lucide-react";

import { StatCard } from "@/components/app/stat-card";
import { formatMoney } from "@/lib/format/recovery";
import type { RecoveryMetrics } from "@/types/shopify";

export function CartRecoveryDashboard({
  metrics,
}: {
  metrics: RecoveryMetrics;
}) {
  return (
    <section className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Carts abandoned"
        value={metrics.abandoned.toLocaleString()}
        icon={<ShoppingCartIcon />}
        hint="Open carts past the 10-min mark, not yet recovered"
      />
      <StatCard
        label="Calls made"
        value={metrics.calls_made.toLocaleString()}
        icon={<PhoneIcon />}
        hint="Carts we dialled"
      />
      {/* Every abandoned cart that came back, across all channels. Deliberately
          NOT split by who drove it — metrics.recovered_by_us carries that and is
          kept out of the merchant view. The wording stays factual ("came back")
          rather than claiming we caused each one. */}
      <StatCard
        label="Carts recovered"
        value={metrics.recovered.toLocaleString()}
        icon={<CheckCircle2Icon />}
        hint="Abandoned carts that came back and converted"
      />
      <StatCard
        label="Revenue recovered"
        value={formatMoney(metrics.revenue_recovered, metrics.currency)}
        icon={<TrendingUpIcon />}
        hint="Order value across recovered carts"
      />
    </section>
  );
}
