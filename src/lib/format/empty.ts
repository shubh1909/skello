/**
 * Is this value "nothing to show"?
 *
 * The rule is explicit because the old inline checks were `value === ""` or a
 * bare falsy test, and a falsy test drops a legitimate **0 cart value** and a
 * **false** WhatsApp opt-in — both of which are real answers, not absences.
 */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  // 0 and false are values. Only a plain empty object counts as empty.
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }
  return false;
}
