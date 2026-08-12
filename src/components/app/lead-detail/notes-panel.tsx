"use client";

import * as React from "react";
import { Loader2Icon, StickyNoteIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { createLeadNote, deleteLeadNote, listLeadNotes } from "@/actions/lead-notes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/format";
import type { LeadNote } from "@/types/lead-note";

const MAX_BODY = 5000;

/**
 * The Notes tab — dated, authored observations on a lead.
 *
 * Deliberately NOT `leads.notes`. That column is a single textarea where the
 * last write wins silently; on a lead that gets worked for three weeks by more
 * than one person it loses information every time two people type. It survives
 * on the Details tab as the lead's standing description.
 *
 * Notes load when the tab is first opened rather than with the sheet: most
 * lead views never reach this tab, and the sheet already fires two requests on
 * open.
 */
export function LeadNotesPanel({
  leadId,
  active,
  now,
}: {
  leadId: string;
  /** True while this tab is the visible one. Gates the initial fetch. */
  active: boolean;
  /**
   * Client-only clock, from the sheet. Passed in rather than read here:
   * rendering "2 hours ago" during SSR and again on hydration produces two
   * different strings for the same note, and the sheet already holds one.
   */
  now: number | null;
}) {
  // Per-lead state resets by REMOUNT — the sheet keys this component on the
  // lead id. An effect that nulled the list when `leadId` changed would be a
  // second source of truth for the same reset, and one render behind it.
  const [notes, setNotes] = React.useState<LeadNote[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [body, setBody] = React.useState("");
  const [saving, startSaving] = React.useTransition();

  React.useEffect(() => {
    if (!active || notes !== null) return;
    let cancelled = false;
    (async () => {
      const result = await listLeadNotes({ lead_id: leadId });
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        setNotes([]);
        return;
      }
      setNotes(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, leadId, notes]);

  function onAdd() {
    const trimmed = body.trim();
    if (!trimmed) return;
    startSaving(async () => {
      const result = await createLeadNote({ lead_id: leadId, body: trimmed });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      // Prepend rather than refetch: the list is newest-first and we hold the
      // created row, so a round trip would only re-fetch what we already have.
      setNotes((prev) => [result.data, ...(prev ?? [])]);
      setBody("");
    });
  }

  function onDelete(id: string) {
    startSaving(async () => {
      const result = await deleteLeadNote({ id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setNotes((prev) => (prev ?? []).filter((n) => n.id !== id));
    });
  }

  return (
    <>
      {/* The composer sits on a tinted plinth so it reads as a control, not as
          the first (empty) note in the list below it. */}
      <section className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3">
        <Textarea
          className="bg-card"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={saving}
          rows={3}
          maxLength={MAX_BODY}
          placeholder="What happened on this lead? Objections, preferences, what to try next…"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            Notes are kept with your name and the time. They can&apos;t be edited
            afterwards.
          </p>
          <Button size="sm" onClick={onAdd} disabled={saving || !body.trim()}>
            {saving ? <Loader2Icon className="animate-spin" /> : <StickyNoteIcon />}
            Add note
          </Button>
        </div>
      </section>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {notes === null ? (
        <div className="space-y-2">
          <div className="h-14 animate-pulse rounded-md bg-muted/60" />
          <div className="h-14 animate-pulse rounded-md bg-muted/40" />
        </div>
      ) : notes.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
          No notes yet. The first one is usually the most useful.
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="group rounded-lg border border-border/60 bg-card px-3 py-2.5 shadow-xs transition-colors hover:border-border"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed wrap-break-word">
                  {note.body}
                </p>
                {/* Delete is offered on every note; the RLS policy is what
                    actually decides, and it only permits your own. Hiding the
                    button would need the current user id here purely to
                    duplicate a rule the database already enforces. */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="Delete note"
                  disabled={saving}
                  onClick={() => onDelete(note.id)}
                >
                  <Trash2Icon />
                </Button>
              </div>
              <p
                className="mt-1 text-[11px] text-muted-foreground"
                suppressHydrationWarning
              >
                {note.author_email ?? "Someone"}
                {now !== null ? ` · ${formatRelative(note.created_at, now)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
