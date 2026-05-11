import { Card } from "@/components/ui/card";
import {
  ConversationsFilterBar,
  type ConversationsFilters,
} from "@/components/app/conversations-filter-bar";
import { ConversationsTable } from "@/components/app/conversations-table";
import { listConversationAgents, listConversations } from "@/actions/calls";
import { requireSession } from "@/lib/auth/session";
import type { CallDirection, CallStatus } from "@/types/call";

export const metadata = { title: "Conversations · Skelo" };

const INITIAL_PAGE_SIZE = 50;

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const RANGES: readonly ConversationsFilters["range"][] = [
  "24h",
  "7d",
  "30d",
  "all",
];
const DIRECTIONS: readonly CallDirection[] = ["inbound", "outbound"];
const STATUSES: readonly CallStatus[] = [
  "initiated",
  "ringing",
  "in_progress",
  "completed",
  "failed",
  "no_answer",
  "busy",
  "canceled",
];

function readFilters(
  sp: Record<string, string | string[] | undefined>,
): ConversationsFilters {
  const one = (key: string): string | undefined => {
    const v = sp[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const range = one("range")?.toLowerCase();
  const direction = one("direction")?.toLowerCase();
  const status = one("status")?.toLowerCase();
  return {
    range:
      range && (RANGES as readonly string[]).includes(range)
        ? (range as ConversationsFilters["range"])
        : "7d",
    direction:
      direction && (DIRECTIONS as readonly string[]).includes(direction)
        ? (direction as CallDirection)
        : undefined,
    status:
      status && (STATUSES as readonly string[]).includes(status)
        ? (status as CallStatus)
        : undefined,
    agent: one("agent")?.trim() || undefined,
    q: one("q")?.trim() || undefined,
  };
}

function rangeToFrom(range: ConversationsFilters["range"]): string | undefined {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  switch (range) {
    case "24h":
      return new Date(now - day).toISOString();
    case "7d":
      return new Date(now - 7 * day).toISOString();
    case "30d":
      return new Date(now - 30 * day).toISOString();
    case "all":
    default:
      return undefined;
  }
}

function shortAgentLabel(agentId: string): string {
  if (agentId.length <= 10) return `Agent ${agentId}`;
  return `Agent ${agentId.slice(0, 6).toUpperCase()}`;
}

export default async function ConversationsPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const orgId = session.organisation.id;
  const sp = (await searchParams) ?? {};
  const filters = readFilters(sp);
  const from = rangeToFrom(filters.range);

  const [callsResult, agentsResult] = await Promise.all([
    listConversations({
      organisation_id: orgId,
      limit: INITIAL_PAGE_SIZE,
      offset: 0,
      direction: filters.direction,
      status: filters.status,
      agent_id: filters.agent,
      from,
      q: filters.q,
    }),
    listConversationAgents(orgId),
  ]);

  const calls = callsResult.success ? callsResult.data.items : [];
  const total = callsResult.success ? callsResult.data.total : 0;
  const agents = agentsResult.success
    ? agentsResult.data.map((id) => ({ id, label: shortAgentLabel(id) }))
    : [];

  // Remount the table when filters change so the infinite-scroll buffer
  // resets to the fresh first page rather than appending across filter sets.
  const tableKey = `${filters.range}|${filters.direction ?? ""}|${filters.status ?? ""}|${filters.agent ?? ""}|${filters.q ?? ""}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Conversations
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {total} call{total === 1 ? "" : "s"} · scoped to{" "}
            {session.organisation.name}
          </p>
        </div>
      </header>

      <ConversationsFilterBar filters={filters} agents={agents} />

      {!callsResult.success ? (
        <Card className="border-destructive/40 p-6 text-sm text-destructive">
          {callsResult.error}
        </Card>
      ) : (
        <ConversationsTable
          key={tableKey}
          calls={calls}
          total={total}
          pageSize={INITIAL_PAGE_SIZE}
          organisationId={orgId}
          filters={{
            direction: filters.direction,
            status: filters.status,
            agent: filters.agent,
            from,
            q: filters.q,
          }}
        />
      )}
    </div>
  );
}
