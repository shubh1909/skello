import Link from "next/link";
import {
  ArrowRightIcon,
  Building2Icon,
  CheckCircle2Icon,
  PauseCircleIcon,
  XCircleIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/app/stat-card";
import { listAllOrganisations } from "@/actions/admin/organisations";
import { formatRelative } from "@/lib/format";

export const metadata = { title: "Admin Overview · Skelo" };

export default async function AdminOverviewPage() {
  const result = await listAllOrganisations({ limit: 10, offset: 0 });
  if (!result.success) {
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {result.error}
      </Card>
    );
  }

  const { items, total } = result.data;
  const connected = items.filter((o) => o.voice_agent_connected).length;
  const disabled = items.filter(
    (o) => o.voice_agent_connected && !o.voice_agent_enabled,
  ).length;
  const pending = items.filter((o) => !o.voice_agent_connected).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Admin console
        </p>
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Overview
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Every workspace on Skelo and the state of its voice agent.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Organisations"
          value={total}
          icon={<Building2Icon />}
          hint="All-time"
        />
        <StatCard
          label="Voice agent connected"
          value={connected}
          icon={<CheckCircle2Icon />}
          hint={`${items.length ? Math.round((connected / items.length) * 100) : 0}% of recent`}
        />
        <StatCard
          label="Agent paused"
          value={disabled}
          icon={<PauseCircleIcon />}
          hint="Connected but disabled"
        />
        <StatCard
          label="Awaiting provisioning"
          value={pending}
          icon={<XCircleIcon />}
          hint="No agent yet"
        />
      </section>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <Building2Icon className="size-4 text-muted-foreground" />
            <h2 className="font-heading text-sm font-semibold">
              Most recent organisations
            </h2>
          </div>
          <Button
            size="sm"
            variant="ghost"
            render={<Link href="/admin/organisations" />}
          >
            View all <ArrowRightIcon />
          </Button>
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
            <p className="font-medium">No organisations yet</p>
            <p className="text-sm text-muted-foreground">
              Workspaces will appear here as owners sign up.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((org) => (
              <li
                key={org.id}
                className="flex items-center gap-3 px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/organisations/${org.id}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {org.name}
                    </Link>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {org.slug}
                    </span>
                    <StatusBadge
                      connected={org.voice_agent_connected}
                      enabled={org.voice_agent_enabled}
                    />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    Owner: {org.owner_email ?? "—"} · Leads:{" "}
                    {org.lead_count.toLocaleString()}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatRelative(org.created_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatusBadge({
  connected,
  enabled,
}: {
  connected: boolean;
  enabled: boolean;
}) {
  if (!connected) return <Badge variant="outline">Not configured</Badge>;
  if (!enabled) return <Badge variant="secondary">Paused</Badge>;
  return <Badge>Connected</Badge>;
}
