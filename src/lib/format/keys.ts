/**
 * Turn a raw data key into something a person can read.
 *
 * `visit_scheduled_at` → "Visit Scheduled At"
 * `leadIntent`         → "Lead Intent"
 * `utm-source`         → "Utm Source"
 *
 * This existed **nine times** across the app under four names (`humanise`,
 * `humaniseKey`, `humaniseFieldKey`, `humaniseCapturedKey`) in two behaviours:
 * six split on `_` only, three also handled camelCase and `-`. For snake_case
 * input the two agree exactly, so the camel-aware version is a strict
 * improvement everywhere and is the one that survives — the split-only copies
 * rendered `leadIntent` as "LeadIntent" wherever a provider happened to send
 * camelCase, and which spelling you saw depended on which panel you opened.
 *
 * Not merged: `humaniseFieldKey` in `src/lib/bolna/extract.ts`. That one builds
 * *stored* summary text rather than a label on screen, so changing it changes
 * data going forward, not a rendering. It stays where it is on purpose.
 */
export function humaniseFieldKey(key: string): string {
  return (
    key
      .replace(/[_-]+/g, " ")
      // camelCase / PascalCase boundaries.
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ")
  );
}
