import type { OutcomePolicy } from "@/types/outcome-policy";

// How many of the highest-priority dispositions count toward a campaign's /
// contact's "best" disposition. Outcomes ranked below this (and the reserved
// fallback) are treated as "no notable disposition" and surface as a dash.
export const TOP_DISPOSITION_PRIORITIES = 5;

// outcome_key → priority rank (0 = highest priority). Built from the org's
// outcome policies ordered by `position` ascending, keeping only the first
// TOP_DISPOSITION_PRIORITIES non-fallback outcomes. Lower `position` = higher
// priority — this mirrors how admins order them (positive outcomes on top).
export type OutcomeRanking = Map<string, number>;

type RankablePolicy = Pick<
  OutcomePolicy,
  "outcome_key" | "position" | "is_fallback"
>;

export function buildOutcomeRanking(
  policies: RankablePolicy[],
): OutcomeRanking {
  const ranked = policies
    .filter((p) => !p.is_fallback)
    .slice()
    .sort((a, b) => a.position - b.position)
    .slice(0, TOP_DISPOSITION_PRIORITIES);

  const ranking: OutcomeRanking = new Map();
  ranked.forEach((p, index) => {
    // First occurrence wins, so a duplicate key never demotes its own rank.
    if (!ranking.has(p.outcome_key)) ranking.set(p.outcome_key, index);
  });
  return ranking;
}

// Pick the highest-priority disposition that actually occurred. Returns the
// winning outcome_key, or null when none of the occurred outcomes rank within
// the top priorities (the caller renders a fallback dash).
export function pickBestOutcome(
  occurredKeys: Iterable<string>,
  ranking: OutcomeRanking,
): string | null {
  let best: string | null = null;
  let bestRank = Infinity;
  for (const key of occurredKeys) {
    const rank = ranking.get(key);
    if (rank === undefined) continue;
    if (rank < bestRank) {
      bestRank = rank;
      best = key;
    }
  }
  return best;
}
