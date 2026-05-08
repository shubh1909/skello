import { LockedCard } from "@/components/app/locked-card";

export const metadata = { title: "Developer · Skelo" };

export default function DeveloperPage() {
  return (
    <LockedCard
      title="Developer"
      heading="Access denied"
      description="API keys, webhooks, and event logs are restricted to admin roles. Ask an admin to grant you developer access."
    />
  );
}
