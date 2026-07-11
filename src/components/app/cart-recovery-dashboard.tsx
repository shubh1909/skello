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
        hint="Carts we acted on"
      />
      <StatCard
        label="Calls made"
        value={metrics.calls_made.toLocaleString()}
        icon={<PhoneIcon />}
        hint="Carts we dialled"
      />
      <StatCard
        label="Carts Recovered "
        value={metrics.conversions_total.toLocaleString()}
        icon={<CheckCircle2Icon />}
        hint="Abandoned carts that converted"
      />
      <StatCard
        label="Revenue recovered"
        value={formatMoney(metrics.revenue_recovered, metrics.currency)}
        icon={<TrendingUpIcon />}
        hint="Across all recovered carts"
      />
    </section>
  );
}
