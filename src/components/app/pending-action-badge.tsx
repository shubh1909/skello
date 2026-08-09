"use client";

import { CheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * The pending/done toggle that sits beside a lead's intent badge.
 *
 * Extracted because it was nine lines of hand-written `className` re-implementing
 * the entire `Badge` class string — including its own hardcoded red/emerald
 * light+dark pairs — in two places (the lead sheet header and the leads table).
 * It is a Badge that happens to be clickable, so it renders as one.
 */
export function PendingActionBadge({
  pending,
  disabled,
  onToggle,
}: {
  /** True when the lead still has an open action. */
  pending: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Badge
      variant={pending ? "destructive" : "success"}
      render={
        <button
          type="button"
          aria-pressed={!pending}
          disabled={disabled}
          title={pending ? "Click to mark as done" : "Click to reopen action"}
          onClick={(e) => {
            // The badge often sits inside a clickable row; without this, marking
            // done also opens the row.
            e.stopPropagation();
            onToggle();
          }}
          className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        />
      }
    >
      <CheckIcon />
      {pending ? "Pending" : "Done"}
    </Badge>
  );
}
