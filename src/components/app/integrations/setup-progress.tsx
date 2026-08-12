import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SetupStep {
  label: string;
  done: boolean;
}

/**
 * Where an integration has got to, as a row of dots.
 *
 * Connecting something is a sequence, not a boolean: the endpoint exists, then
 * credentials arrive, then something actually lands. Showing which step stalled
 * is the difference between "WhatsApp isn't working" and "we're still waiting on
 * their app secret" — a distinction that was otherwise only discoverable by
 * reading a form.
 *
 * Shared by the admin console and the customer's own page so both describe
 * progress the same way, in the same order.
 */
export function SetupProgress({
  steps,
  className,
}: {
  steps: SetupStep[];
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-2">
          {i > 0 ? <span aria-hidden className="h-px w-4 bg-border" /> : null}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs",
              step.done ? "text-success" : "text-muted-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-4 place-items-center rounded-full border",
                step.done
                  ? "border-success bg-success-muted"
                  : "border-border bg-muted",
              )}
            >
              {step.done ? <CheckIcon className="size-2.5" /> : null}
            </span>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A labelled section inside an integration card, so concerns read apart. */
export function IntegrationSection({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>
        <h3 className="text-xs font-semibold tracking-wide uppercase">{title}</h3>
      </div>
      {hint ? (
        <p className="-mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {children}
    </section>
  );
}
