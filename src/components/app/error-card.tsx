import { AlertTriangleIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * The page-level "this failed to load" block.
 *
 * Replaces `<Card className="border-destructive/40 p-6 text-sm text-destructive">`,
 * which appeared **23 times verbatim** across 20 files — a primitive that
 * existed in everyone's head but nowhere in the codebase.
 *
 * Built on `Alert` rather than `Card` for the `role="alert"` a screen reader
 * needs: these render *instead of* the content the user asked for, so silently
 * swapping in a styled box tells assistive tech nothing happened.
 */
export function ErrorCard({
  children,
  title = "Something went wrong",
  className,
}: {
  /** The error message. Server actions already return user-safe strings. */
  children: React.ReactNode;
  /** Override when the failure needs naming ("Couldn't load campaigns"). */
  title?: string;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={cn("px-4 py-3.5", className)}>
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
