"use client";

import { formatDurationCompact } from "@/lib/format/duration";
import { formatRelative } from "@/lib/format";
import type { LeadCallStats, ResolvedBinding } from "@/lib/leads/sheet-bindings";
import { LeadStatCards } from "@/components/app/lead-detail/stat-cards";
import { SectionLabel } from "@/components/app/section-label";

/**
 * The AI Summary tab: what the agent understood, at a glance.
 *
 * Everything here is read-only by design. Correcting an extraction happens on
 * the Details tab, which owns the edit form and the field locks — a panel that
 * both summarises and edits is how the old sheet ended up with two Save buttons
 * that meant different things.
 */
export function LeadSummaryPanel({
  cards,
  wants,
  summary,
  actionable,
  stats,
  now,
}: {
  cards: ResolvedBinding[];
  wants: ResolvedBinding[];
  /** Latest call's summary, as rolled up onto the lead. */
  summary: string | null;
  /** Latest call's suggested next step. */
  actionable: string | null;
  stats: LeadCallStats;
  now: number | null;
}) {
  const hasContact = stats.total_calls > 0;

  return (
    <>
      <LeadStatCards cards={cards} />

      {/* Always rendered, directly under the cards — this is the panel people
          come to the tab for, and a section that silently disappears on a lead
          with no summary yet reads as a broken layout rather than as missing
          data. The lime highlight marks it as the agent's own writing, not
          fields we transcribed. */}
      <section className="space-y-2">
        <SectionLabel as="h3">Overall summary</SectionLabel>
        {summary ? (
          <div className="rounded-lg border border-highlight-border/70 bg-highlight px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
            {summary}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            No summary yet — the voice agent writes one after it has spoken to
            this lead.
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        {/* Left: the org's configured "what they want" fields. Hidden entirely
            rather than shown empty — an org whose agent captures none of this
            should see one column, not a labelled void. */}
        {wants.length > 0 ? (
          <PanelCard title="What they want">
            <dl className="divide-y divide-border/60">
              {wants.map((w) => (
                <WantRow key={w.id} label={w.label} value={w.display ?? ""} />
              ))}
            </dl>
          </PanelCard>
        ) : null}

        {/* Right: derived from the calls themselves, so it is NOT configurable.
            "When did we last speak and how many times" is the same question in
            every vertical. */}
        <PanelCard title="Last contact">
          {hasContact ? (
            <dl className="divide-y divide-border/60">
              <Row
                label="Latest call"
                value={
                  stats.last_call_at && now !== null
                    ? formatRelative(stats.last_call_at, now)
                    : "—"
                }
              />
              <Row
                label="Call duration"
                value={
                  stats.last_call_duration_seconds !== null
                    ? formatDurationCompact(stats.last_call_duration_seconds)
                    : "—"
                }
              />
              <Row label="Attempts" value={String(stats.total_calls)} />
            </dl>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">
              Nobody has spoken to this lead yet.
            </p>
          )}
        </PanelCard>
      </section>

      {actionable ? (
        <section className="space-y-2">
          <SectionLabel as="h3">Suggested next step</SectionLabel>
          {/* A left rule in the primary teal: this is an instruction, and it
              should read differently from the summary above it without
              shouting louder than the cards. */}
          <div className="rounded-lg border border-border/70 border-l-2 border-l-primary/50 bg-muted/30 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
            {actionable}
          </div>
        </section>
      ) : null}
    </>
  );
}

/**
 * A titled panel whose header is a tinted band rather than a line of text
 * floating on the same white as its rows.
 *
 * The two panels sit side by side and each holds a list of label/value pairs;
 * without the band they read as one undifferentiated field of text.
 */
function PanelCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-xs">
      <div className="border-b border-border/60 bg-muted/50 px-4 py-2">
        <SectionLabel as="h3">{title}</SectionLabel>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/**
 * A label/value pair that stops pretending to be a table when the value is a
 * sentence.
 *
 * Extracted fields are free text: "3 BHK" is a two-column row, but "Send a
 * WhatsApp message to the customer to initiate engagement…" right-aligned into
 * half a panel wraps to four ragged lines and squeezes its own label onto two.
 * Past a short threshold the value gets the full width under its label.
 */
function WantRow({ label, value }: { label: string; value: string }) {
  const long = value.length > 28;

  if (long) {
    return (
      <div className="space-y-1 py-2.5 first:pt-0 last:pb-0">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="text-sm leading-relaxed wrap-break-word">{value}</dd>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium wrap-break-word">
        {value}
      </dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className="min-w-0 text-right text-sm font-medium wrap-break-word"
        suppressHydrationWarning
      >
        {value}
      </dd>
    </div>
  );
}
