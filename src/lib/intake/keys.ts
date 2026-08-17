/**
 * Key handling shared by every intake adapter.
 *
 * Pure — no DB, no `server-only`. Both the Google Ads and portal adapters read
 * keys authored by somebody else (an advertiser's custom question, a portal
 * account's own column names), so both need the same guarantees about what a
 * key may look like by the time it reaches the field catalog.
 */

/**
 * A JSONB key safe to store and to address from a lead-sheet binding.
 *
 * Binding key paths are validated against `[a-zA-Z0-9_\-.]+`, so a field named
 * "What is your budget?" or "Project Name " would register a catalog entry that
 * no binding could ever point at. Sanitising here keeps the catalog addressable
 * — and the catalog is the whole reason a new source needs no display code.
 */
export function sanitiseKey(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "field"
  );
}

/**
 * Flatten a decoded payload into `path -> string` pairs.
 *
 * Portals are inconsistent about nesting: some post a flat body, some wrap
 * everything in `{ lead: {...} }` or `{ data: { enquiry: {...} } }`. Flattening
 * to dotted paths means the alias table and the admin's field map address the
 * same string either way.
 *
 * Arrays are indexed (`items.0.name`) rather than dropped, and objects deeper
 * than `maxDepth` are stringified rather than silently lost — a payload we
 * cannot fully read must still be visible in the field catalog.
 */
export function flattenPayload(
  input: unknown,
  opts: { maxDepth?: number } = {},
): Record<string, string> {
  const maxDepth = opts.maxDepth ?? 6;
  const out: Record<string, string> = {};

  const walk = (value: unknown, path: string, depth: number): void => {
    if (value === null || value === undefined) return;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) out[path] = trimmed;
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[path] = String(value);
      return;
    }
    if (typeof value !== "object") return;

    if (depth >= maxDepth) {
      try {
        out[path] = JSON.stringify(value).slice(0, 500);
      } catch {
        /* unserialisable — nothing useful to record */
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, path ? `${path}.${i}` : String(i), depth + 1));
      return;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walk(child, path ? `${path}.${key}` : key, depth + 1);
    }
  };

  walk(input, "", 0);
  // A top-level scalar body has no path at all; give it one rather than
  // producing a record keyed by the empty string.
  if (out[""] !== undefined) {
    out.value = out[""];
    delete out[""];
  }
  return out;
}

/**
 * The last segment of a dotted path — what alias matching actually compares.
 *
 * Empty segments are skipped, and a path that yields none falls back to itself.
 * Field names in the wild contain literal dots (`MOBILE NO.`, `Ph.`), and a
 * naive `split(".").pop()` returns `""` for those — which silently defeated
 * every alias for exactly the fields most likely to carry a phone number.
 */
export function leafOf(path: string): string {
  const parts = path.split(".").filter((p) => p.trim().length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}
