"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyFieldProps {
  label: string;
  value: string;
  /** Masked until revealed. For shared secrets shown on a shareable screen. */
  secret?: boolean;
  /** Small muted line under the field. */
  hint?: string;
  className?: string;
}

/**
 * A read-only value with a copy button.
 *
 * Exists because a webhook URL is 90 characters of base64 that has to arrive
 * in someone else's console byte-perfect. Selecting it by hand is the step
 * where integrations break, so the field is never editable and the copy button
 * is the primary affordance.
 */
export function CopyField({
  label,
  value,
  secret = false,
  hint,
  className,
}: CopyFieldProps) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!secret);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      // Reverts on its own — a permanently ticked button stops meaning
      // "copied just now", which is the only thing it is telling you.
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy. Select the value and copy it manually.");
    }
  }

  return (
    <div className={cn("grid gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-stretch gap-1.5">
        <code
          className={cn(
            "min-w-0 flex-1 truncate rounded-md border border-border/70 bg-muted/40 px-2.5 py-2 font-mono text-xs leading-relaxed",
            !revealed && "select-none tracking-widest",
          )}
          title={revealed ? value : undefined}
        >
          {revealed ? value : "•".repeat(Math.min(value.length, 32))}
        </code>
        {secret ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
            onClick={() => setRevealed((r) => !r)}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={copy}
        >
          {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
        </Button>
      </div>
      {hint ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
