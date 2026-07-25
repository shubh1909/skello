import {
  CheckCircle2Icon,
  PhoneIcon,
  PhoneOffIcon,
  XCircleIcon,
} from "lucide-react";

import { StatCard } from "@/components/app/stat-card";
import type { CodMetrics } from "@/types/cod";

export function CodConfirmationDashboard({
  metrics,
}: {
  metrics: CodMetrics;
}) {
  return (
    <section className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Confirmation calls"
        value={metrics.calls_made.toLocaleString()}
        icon={<PhoneIcon />}
        hint="COD orders we dialled"
      />
      <StatCard
        label="Confirmed"
        value={metrics.confirmed.toLocaleString()}
        icon={<CheckCircle2Icon />}
        hint="Reached and confirmed the order"
      />
      <StatCard
        label="Declined"
        value={metrics.declined.toLocaleString()}
        icon={<XCircleIcon />}
        hint="Reached but did not confirm"
      />
      <StatCard
        label="Not reached"
        value={metrics.not_reached.toLocaleString()}
        icon={<PhoneOffIcon />}
        hint="Never connected within the retry cap"
      />
    </section>
  );
}
