import { LockedCard } from "@/components/app/locked-card";

export const metadata = { title: "Campaigns · Skello" };

export default function CampaignsPage() {
  return (
    <LockedCard
      title="Campaigns"
      heading="Access denied"
      description="Campaigns are part of a higher-tier plan. Contact your workspace owner to unlock outbound sequences."
    />
  );
}
