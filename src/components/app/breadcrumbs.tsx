"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";

import { breadcrumbsFor } from "@/lib/nav";

/**
 * The topbar trail.
 *
 * Renders **only when there is more than one crumb**. Every top-level page
 * already states its own name in an `<h1>` directly below, so a lone
 * "Leads" crumb is the same word twice for no wayfinding gain. The trail earns
 * its space exactly where the nav is two levels deep — the cart-recovery and
 * COD workspaces under Campaigns.
 *
 * The trail comes from the nav model, not from URL segments: splitting
 * `/campaigns/templates/cart-recovery` on `/` yields a "Templates" crumb that
 * links to a route which does not exist.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname);
  if (crumbs.length < 2) return null;

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex items-center gap-1 text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1">
              {i > 0 ? (
                <ChevronRightIcon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground/60"
                />
              ) : null}
              {last ? (
                <span aria-current="page" className="truncate font-medium">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
