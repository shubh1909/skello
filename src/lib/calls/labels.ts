/**
 * Shared, presentation-agnostic call labelling.
 *
 * Extracted from `lead-detail-sheet.tsx` so the recovery sheets can render calls
 * the same way the lead sheet does. The three "show me a call" surfaces in this
 * app (the lead sheet's pane, the recovery call sheet, the transcript dialog)
 * were each carrying their own copy of this vocabulary.
 */

// `humaniseFieldKey` moved to `@/lib/format/keys` — nine copies of it existed
// across the app, most of them outside the calls domain. Re-exported here so
// every existing import of this module keeps working.
export { humaniseFieldKey } from "@/lib/format/keys";

/**
 * Why there's no transcript — the specific reason, not a shrug.
 *
 * "Still processing" and "none was produced" mean very different things to
 * someone waiting on a call result, and a surface without `transcript_status`
 * can only say the generic thing. That's why the recovery query now selects it.
 */
export function transcriptEmptyCopy(status: string | null | undefined): string {
  switch (status) {
    case "pending":
      return "Transcript hasn't been fetched yet — check back in a moment.";
    case "processing":
      return "Transcript is being processed.";
    case "failed":
      return "We couldn't fetch this transcript.";
    case "skipped":
      return "No transcript was produced for this call.";
    case "ready":
      return "This call has no utterances on file.";
    default:
      return "No transcript to show.";
  }
}
