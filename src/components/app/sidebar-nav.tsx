"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOutIcon } from "lucide-react";
import { toast } from "sonner";

import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Logo } from "@/components/brand/logo";
import { useAppShell } from "@/components/app/app-shell";
import { initialsOf } from "@/lib/format";
import {
  NAV_SECTIONS,
  isNavActive,
  isNavBranchActive,
  type NavItem,
} from "@/lib/nav";
import { cn } from "@/lib/utils";

export interface SidebarNavProps {
  organisationName: string;
  organisationSlug: string;
  uniqueLeadCount: number;
}

/**
 * The sidebar's contents, independent of the frame around them.
 *
 * Rendered three ways: expanded in the desktop `<aside>`, as a 64px icon rail
 * when collapsed, and expanded again inside the mobile drawer. One body, so a
 * nav item added in one place cannot go missing in another.
 *
 * ⚠️ Everything in here must use `sidebar-*` tokens. The sidebar is deep teal
 * in BOTH themes, so a global token like `text-muted-foreground` renders
 * teal-on-teal and vanishes in light mode — where nobody thinks to check.
 * See globals.css.
 */
export function SidebarNavBody({
  organisationName,
  organisationSlug,
  uniqueLeadCount,
  collapsed = false,
  onNavigate,
}: SidebarNavProps & {
  collapsed?: boolean;
  /** Called after any nav click. The drawer uses it to close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function onLogout() {
    startTransition(async () => {
      const result = await logout();
      if (!result.success) toast.error(result.error);
    });
  }

  function badgeFor(item: NavItem): string | null {
    if (!item.badgeKey) return null;
    if (uniqueLeadCount <= 0) return null;
    return uniqueLeadCount > 999 ? "999+" : String(uniqueLeadCount);
  }

  return (
    <>
      <div className={cn("py-5", collapsed ? "px-0 text-center" : "px-5")}>
        <Logo tone="sidebar" showWordmark={!collapsed} />
      </div>

      {/* Identity tile, not a bordered card. Collapsed, the monogram alone is
          the tile — the name and slug are unreadable at 64px, so they move
          into the tooltip. */}
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger
            delay={150}
            render={
              <span className="mx-auto mb-4 grid size-9 shrink-0 place-items-center rounded-md bg-sidebar-accent text-[11px] font-semibold tracking-wide text-sidebar-accent-foreground" />
            }
          >
            <span aria-hidden>{initialsOf(organisationName)}</span>
            <span className="sr-only">{organisationName}</span>
          </TooltipTrigger>
          <TooltipContent side="right">
            {organisationName}
            <span className="ml-1.5 text-muted-foreground">
              {organisationSlug}
            </span>
          </TooltipContent>
        </Tooltip>
      ) : (
        <div className="mx-3 mb-4 flex items-center gap-2.5 rounded-lg bg-sidebar-hover px-2.5 py-2">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-md bg-sidebar-accent text-[11px] font-semibold tracking-wide text-sidebar-accent-foreground"
          >
            {initialsOf(organisationName)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-heading text-sm font-medium">
              {organisationName}
            </div>
            <div className="truncate text-[11px] text-sidebar-muted-foreground">
              {organisationSlug}
            </div>
          </div>
        </div>
      )}

      {/* no-scrollbar: the nav scrolls, but a permanent scrollbar gutter on a
          chrome surface reads as unfinished. Inner scrollers (tables,
          transcripts) keep theirs — there, position feedback is worth the pixels. */}
      <nav className="no-scrollbar flex-1 overflow-y-auto px-2 pb-2">
        {NAV_SECTIONS.map((section) => (
          <div
            key={section.label}
            className={cn(
              "mb-4",
              // A 10px uppercase label does not fit in 64px, and dropping the
              // grouping outright would run four sections into one list. A rule
              // keeps the grouping legible without pretending to be a label.
              // `first:` works because these divs are direct children of <nav>.
              collapsed &&
                "border-t border-sidebar-border pt-3 first:border-t-0 first:pt-0",
            )}
          >
            {collapsed ? null : (
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted-foreground">
                {section.label}
              </div>
            )}

            <ul className="space-y-0.5">
              {section.items.map((item) => {
                // Collapsed hides children, so the rail highlights the whole
                // branch — otherwise a cart-recovery page lights nothing at all.
                const active = collapsed
                  ? isNavBranchActive(pathname, item)
                  : isNavActive(pathname, item.href);
                const badge = badgeFor(item);
                const Icon = item.icon;

                const linkClass = cn(
                  "group relative flex items-center rounded-md text-sm transition-colors",
                  collapsed
                    ? "justify-center px-0 py-2.5"
                    : "gap-2.5 px-3 py-2",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground",
                );

                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger
                          delay={150}
                          render={
                            <Link
                              href={item.href}
                              aria-label={item.label}
                              onClick={onNavigate}
                              className={linkClass}
                            />
                          }
                        >
                          <Icon className="size-4" />
                          {/* The count can't fit beside the icon, so it becomes
                              a dot — it still says "there is something here". */}
                          {badge ? (
                            <span
                              aria-hidden
                              className="absolute top-1.5 right-2.5 size-1.5 rounded-full bg-sidebar-accent-foreground"
                            />
                          ) : null}
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {item.label}
                          {badge ? (
                            <span className="ml-1.5 tabular-nums text-muted-foreground">
                              {badge}
                            </span>
                          ) : null}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        className={linkClass}
                      >
                        <Icon className="size-4" />
                        <span className="flex-1 font-medium">{item.label}</span>
                        {badge ? (
                          <span
                            className={cn(
                              "inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                              active
                                ? "bg-sidebar-accent-foreground/20 text-sidebar-accent-foreground"
                                : "bg-sidebar-hover text-sidebar-muted-foreground group-hover:text-sidebar-foreground",
                            )}
                            aria-label={`${uniqueLeadCount} unique leads`}
                          >
                            {badge}
                          </span>
                        ) : null}
                      </Link>
                    )}

                    {/* Sub-items are dropped from the rail rather than squeezed
                        into it — at 64px they would be a second column of
                        near-identical icons with no visible parent to attach
                        to. The branch highlight above preserves the context. */}
                    {!collapsed && item.children?.length ? (
                      <ul className="mt-2 ml-4 space-y-0.5 border-l border-sidebar-border pl-2">
                        {item.children.map((child) => {
                          const ChildIcon = child.icon;
                          return (
                            <li key={child.href}>
                              <Link
                                href={child.href}
                                onClick={onNavigate}
                                className={cn(
                                  "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                                  isNavActive(pathname, child.href)
                                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                    : "text-sidebar-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground",
                                )}
                              >
                                <ChildIcon className="size-3.5" />
                                <span className="flex-1 font-medium">
                                  {child.label}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div
        className={cn(
          "border-t border-sidebar-border text-xs text-sidebar-muted-foreground",
          collapsed ? "p-2" : "p-4",
        )}
      >
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              delay={150}
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Sign out"
                  disabled={pending}
                  onClick={onLogout}
                  className="w-full text-sidebar-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground"
                />
              }
            >
              <LogOutIcon />
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        ) : (
          <>
            <p className="leading-snug">
              Tip: hit{" "}
              <kbd className="rounded border border-sidebar-border bg-sidebar-hover px-1 py-0.5 text-[10px] font-medium text-sidebar-foreground">
                ⌘K
              </kbd>{" "}
              to jump anywhere.
            </p>
            <Button
              variant="ghost"
              size="sm"
              // Button's ghost variant resolves to global accent/foreground
              // tokens, which are near-invisible on the dark sidebar — override
              // explicitly.
              className="mt-3 w-full justify-start text-sidebar-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground"
              disabled={pending}
              onClick={onLogout}
            >
              <LogOutIcon />
              {pending ? "Signing out…" : "Sign out"}
            </Button>
          </>
        )}
      </div>
    </>
  );
}

/**
 * The desktop sidebar.
 *
 * Collapsing narrows it to an icon rail rather than removing it. The previous
 * behaviour animated the grid down to a single column, so "collapse" deleted
 * every piece of wayfinding in the app and the only route back was the toggle
 * you had just pressed.
 */
export function SidebarNav(props: SidebarNavProps) {
  const { collapsed } = useAppShell();

  return (
    <aside className="sticky top-0 hidden h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <SidebarNavBody {...props} collapsed={collapsed} />
    </aside>
  );
}
