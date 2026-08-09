import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Underline tabs backed by real navigation.
 *
 * Deliberately NOT shadcn's `Tabs`. That primitive owns client state and expects
 * `TabsContent` panels; these switch a *route* (`?status=done`, `?include=all`),
 * so the content is server-rendered per URL and there are no panels to own. A
 * `<nav>` of links is the honest markup — it keeps middle-click, cmd-click and
 * "open in new tab" working, which a button-based tab list silently breaks.
 *
 * Use `Tabs` when the switch is client state and nothing about the URL changes.
 *
 * Replaces three separate idioms: pill tabs on /leads and /reminders (byte-identical
 * copies of each other, except the reminders one rendered a raw `<a>` and therefore
 * full-page-reloaded on every filter click), and underline tabs on the campaign
 * detail page.
 */
export interface NavTabItem {
  href: string;
  label: string;
  active: boolean;
  /** Rendered before the label. Sized by the parent, so pass a bare icon. */
  icon?: React.ReactNode;
  /** Optional trailing count. `0` renders — pass `undefined` to omit. */
  count?: number;
}

export function NavTabs({
  items,
  className,
  "aria-label": ariaLabel = "Filter",
}: {
  items: NavTabItem[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        // no-scrollbar: the strip scrolls when the tabs outrun their row, but a
        // scrollbar under a tab row reads as a rendering glitch rather than an
        // affordance — the cut-off tab is the affordance.
        "no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-border/60",
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            // -mb-px pulls the active underline onto the nav's own border so the
            // two read as one line rather than a double rule.
            "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
            "focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            item.active
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
            "[&_svg]:size-4 [&_svg]:shrink-0",
          )}
        >
          {item.icon}
          {item.label}
          {item.count !== undefined ? (
            <span
              className={cn(
                "text-xs tabular-nums",
                item.active ? "text-muted-foreground" : "text-muted-foreground/70",
              )}
            >
              {item.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
