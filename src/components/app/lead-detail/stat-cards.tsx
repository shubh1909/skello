"use client";

import { Badge } from "@/components/ui/badge";
import { INTENT_VARIANT } from "@/lib/leads/intent";
import { LEAD_STATUS_VARIANT } from "@/lib/leads/status";
import type { ResolvedBinding } from "@/lib/leads/sheet-bindings";
import type { LeadIntent, LeadStatus } from "@/types/lead";

/**
 * The three cards under the tab bar. Which fields they show is per-org config
 * (`lead_sheet_bindings`), so this component knows nothing about intent scores
 * or budgets — only about how to draw a label, a value and a caption.
 *
 * The row keeps its three columns even when a card has no value. A grid that
 * silently collapsed from three to one as data went missing would read as a
 * layout bug; a card showing "—" reads as "we don't know that yet", which is
 * the truth.
 */
export function LeadStatCards({ cards }: { cards: ResolvedBinding[] }) {
  if (cards.length === 0) return null;

  return (
    <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <StatCard key={card.id} card={card} />
      ))}
    </section>
  );
}

function StatCard({ card }: { card: ResolvedBinding }) {
  const empty = card.display === null;
  return (
    // A top-down wash from card white into muted, so the row reads as three
    // raised tiles rather than three outlines on the same flat surface. A card
    // with no value drops the wash and the shadow — it should recede, not sit
    // at the same weight as a card carrying a real number.
    <div
      className={
        empty
          ? "rounded-xl border border-dashed border-border/60 bg-muted/20 p-4"
          : "rounded-xl border border-border/60 bg-linear-to-b from-card to-muted/40 p-4 shadow-xs"
      }
    >
      <p className="text-sm text-muted-foreground">{card.label}</p>
      <div className="mt-2">
        <CardValue card={card} />
      </div>
      {card.caption ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{card.caption}</p>
      ) : null}
    </div>
  );
}

function CardValue({ card }: { card: ResolvedBinding }) {
  if (card.display === null) {
    return (
      <p className="font-heading text-3xl font-semibold leading-none text-muted-foreground/50">
        —
      </p>
    );
  }

  if (card.format === "enum_badge") {
    return (
      <div className="flex h-8 items-center">
        <Badge variant={badgeVariantFor(card.raw)} className="h-6 px-2.5 text-sm">
          {card.display}
        </Badge>
      </div>
    );
  }

  // Long free-text values (an extracted "what they asked about") would blow the
  // card apart at display size, so anything past a couple of words steps down
  // to body copy and clamps. The number-shaped values the row is designed for
  // keep the display treatment.
  const long = card.display.length > 12;
  return (
    <p
      className={
        long
          ? "line-clamp-3 text-sm leading-relaxed"
          : "font-heading text-3xl font-semibold leading-none tabular-nums"
      }
    >
      {card.display}
    </p>
  );
}

/**
 * Colour a badge by what the value MEANS where we know it, falling back to a
 * neutral chip where we don't.
 *
 * A binding can point at any enum — intent, pipeline status, or an org's own
 * extracted field — so this is a lookup with a default, not a total map.
 */
function badgeVariantFor(raw: unknown) {
  if (typeof raw !== "string") return "neutral" as const;
  const key = raw.toLowerCase();
  if (key in INTENT_VARIANT) return INTENT_VARIANT[key as LeadIntent];
  if (key in LEAD_STATUS_VARIANT) return LEAD_STATUS_VARIANT[key as LeadStatus];
  return "neutral" as const;
}
