import Link from "next/link";
import { Building2Icon, SearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listAllOrganisations } from "@/actions/admin/organisations";
import { formatRelative } from "@/lib/format";

export const metadata = { title: "Organisations · Admin · Skello" };

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminOrganisationsPage({
  searchParams,
}: PageProps) {
  const sp = (await searchParams) ?? {};
  const qParam = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = qParam?.trim() || undefined;

  const result = await listAllOrganisations({ q, limit: 200, offset: 0 });
  if (!result.success) {
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {result.error}
      </Card>
    );
  }

  const { items, total } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Organisations
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {total} total
          </p>
        </div>
      </header>

      <form
        action="/admin/organisations"
        className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 md:p-4"
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search name or slug…"
            className="h-9 pl-8"
          />
        </div>
      </form>

      <Card className="overflow-hidden p-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Building2Icon className="size-5 text-muted-foreground" />
            <p className="font-medium">No organisations match</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Try a different search, or wait for someone to sign up.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border/60 bg-muted/30">
                <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-3 py-3 font-medium">
                    Organisation
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Owner
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Voice agent
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Leads
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {items.map((org) => (
                  <tr
                    key={org.id}
                    className="align-middle transition-colors hover:bg-muted/40"
                  >
                    <td className="px-3 py-3">
                      <Link
                        href={`/admin/organisations/${org.id}`}
                        className="flex flex-col hover:underline"
                      >
                        <span className="truncate font-medium">
                          {org.name}
                        </span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground">
                          {org.slug}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      <span className="block max-w-48 truncate">
                        {org.owner_email ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge
                        connected={org.voice_agent_connected}
                        enabled={org.voice_agent_enabled}
                      />
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {org.lead_count.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {formatRelative(org.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
