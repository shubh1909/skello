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
  const organic = Math.max(0, metrics.conversions_total - metrics.recovered);
  return (
    <section className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Carts abandoned"
        value={metrics.abandoned.toLocaleString()}
        icon={<ShoppingCartIcon />}
        hint="Carts we acted on"
      />
      <StatCard
        label="Calls made"
        value={metrics.calls_made.toLocaleString()}
        icon={<PhoneIcon />}
        hint="Carts we dialled"
      />
      <StatCard
        label="Recovered via call"
        value={metrics.recovered.toLocaleString()}
        icon={<CheckCircle2Icon />}
        hint={
          organic > 0
            ? `+${organic.toLocaleString()} converted organically`
            : "Reached, then purchased"
        }
      />
      <StatCard
        label="Revenue recovered"
        value={formatMoney(metrics.revenue_recovered, metrics.currency)}
        icon={<TrendingUpIcon />}
        hint="From call-driven recoveries"
      />
    </section>
  );
}
