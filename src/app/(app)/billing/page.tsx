import { LockedCard } from "@/components/app/locked-card";

export const metadata = { title: "Billing · Skello" };

export default function BillingPage() {
  return (
    <LockedCard
      title="Billing"
      heading="Access denied"
      description="Invoices and plan changes are visible only to the workspace owner. Reach out to them for any billing concerns."
    />
  );
}
