import {
  Building2Icon,
  CodeIcon,
  CreditCardIcon,
  LayoutGridIcon,
  MessageCircleIcon,
  PackageCheckIcon,
  RadioIcon,
  SettingsIcon,
  ShoppingCartIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * The single description of the app's navigation.
 *
 * Four surfaces need this now — the sidebar, the mobile drawer, the topbar
 * breadcrumb and the ⌘K palette — and a nav duplicated four ways drifts within
 * a release. Everything below is data; the components only decide how to draw
 * it.
 */

export type NavBadgeKey = "unique_leads";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: NavBadgeKey;
  /** Extra terms the ⌘K palette should match on. Never rendered. */
  keywords?: readonly string[];
  children?: readonly NavItem[];
}

export interface NavSection {
  label: string;
  items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "Overview",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: LayoutGridIcon,
        keywords: ["home", "overview", "stats"],
      },
      // /pulse is intentionally absent (route still exists and is reachable by
      // deep-link). See docs/sitemap.md → Hidden routes.
    ],
  },
  {
    label: "Leads",
    items: [
      {
        href: "/leads",
        label: "Leads",
        icon: UsersIcon,
        badgeKey: "unique_leads",
        keywords: ["contacts", "people", "customers", "crm"],
      },
      {
        href: "/conversations",
        label: "Conversations",
        icon: MessageCircleIcon,
        keywords: ["calls", "transcripts", "history"],
      },
    ],
  },
  {
    label: "Outreach",
    // Three siblings, not a parent with two children. Cart Recovery and COD
    // Confirmation are **independent engines** — their own settings, queues,
    // tables and metrics — that merely happen to live under `/campaigns/…` in
    // the URL. Nesting them implied they were views of a campaign, and cost
    // them a level of prominence they hadn't earned less of.
    items: [
      {
        href: "/campaigns",
        label: "Campaigns",
        icon: RadioIcon,
        keywords: ["outreach", "dial", "broadcast"],
      },
      {
        href: "/campaigns/templates/cart-recovery",
        label: "Cart Recovery",
        icon: ShoppingCartIcon,
        keywords: ["abandoned", "checkout", "shopify", "whatsapp"],
      },
      {
        href: "/campaigns/templates/cod-confirmation",
        label: "COD Confirmation",
        icon: PackageCheckIcon,
        keywords: ["cash on delivery", "orders", "confirm"],
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: SettingsIcon,
        keywords: ["preferences", "integrations", "workspace"],
      },
      {
        href: "/developer",
        label: "Developer",
        icon: CodeIcon,
        keywords: ["api", "webhooks", "keys"],
      },
      {
        href: "/billing",
        label: "Billing",
        icon: CreditCardIcon,
        keywords: ["invoice", "plan", "subscription"],
      },
    ],
  },
];

/**
 * The admin console's nav.
 *
 * Kept here so it shares `activeNavHref`'s longest-match-with-a-boundary rule
 * rather than carrying its own copy of the prefix test. It is deliberately
 * **not** part of `NAV_SECTIONS`: the ⌘K palette and the customer breadcrumb
 * default to that constant, and admin routes must not surface for a
 * non-admin.
 */
export const ADMIN_NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "Admin",
    items: [
      { href: "/admin", label: "Overview", icon: LayoutGridIcon },
      {
        href: "/admin/organisations",
        label: "Organisations",
        icon: Building2Icon,
      },
      { href: "/admin/users", label: "Users", icon: UsersIcon },
    ],
  },
];

/** Depth-first, parents before their children. */
export function flattenNav(
  sections: readonly NavSection[] = NAV_SECTIONS,
): NavItem[] {
  const out: NavItem[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      out.push(item);
      if (item.children) out.push(...item.children);
    }
  }
  return out;
}

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The one nav entry a path belongs to — **longest match wins**.
 *
 * This is the fix for the old `pathname === href || pathname.startsWith(href)`
 * test, which lit up `/campaigns` *and* `/campaigns/templates/cart-recovery`
 * simultaneously, so the sidebar claimed you were in two places at once. It
 * also had no `/` boundary, so a future `/leads-archive` would have highlighted
 * `/leads`.
 *
 * The `/dashboard` special-case the old code needed is gone with it: that
 * existed only because a prefix test with no boundary made `/dashboard` greedy.
 */
export function activeNavHref(
  pathname: string,
  sections: readonly NavSection[] = NAV_SECTIONS,
): string | null {
  let best: string | null = null;
  for (const item of flattenNav(sections)) {
    if (!matches(pathname, item.href)) continue;
    if (best === null || item.href.length > best.length) best = item.href;
  }
  return best;
}

/** True only for the single deepest match — what a nav link highlights on. */
export function isNavActive(
  pathname: string,
  href: string,
  sections: readonly NavSection[] = NAV_SECTIONS,
): boolean {
  return activeNavHref(pathname, sections) === href;
}

/**
 * True for the item *or any of its children*.
 *
 * The collapsed icon rail doesn't render children, so a rail using
 * `isNavActive` would highlight nothing at all on a cart-recovery page. This is
 * the rail's rule; expanded nav links use `isNavActive`.
 */
export function isNavBranchActive(
  pathname: string,
  item: NavItem,
  sections: readonly NavSection[] = NAV_SECTIONS,
): boolean {
  const active = activeNavHref(pathname, sections);
  if (active === null) return false;
  if (active === item.href) return true;
  return (item.children ?? []).some((child) => child.href === active);
}

export interface Crumb {
  label: string;
  href: string;
}

/**
 * The nav ancestry of a path, root-first.
 *
 * Derived from `NAV_SECTIONS` rather than from URL segments, because the
 * segments lie: `/campaigns/templates/cart-recovery` would render a
 * "Templates" crumb pointing at a route that does not exist.
 *
 * Returns a single crumb for a top-level page. Callers are expected to skip
 * rendering at length < 2 — one crumb only repeats the page's own `<h1>`.
 */
export function breadcrumbsFor(
  pathname: string,
  sections: readonly NavSection[] = NAV_SECTIONS,
): Crumb[] {
  const active = activeNavHref(pathname, sections);
  if (!active) return [];

  for (const section of sections) {
    for (const item of section.items) {
      if (item.href === active) return [{ label: item.label, href: item.href }];
      const child = (item.children ?? []).find((c) => c.href === active);
      if (child) {
        return [
          { label: item.label, href: item.href },
          { label: child.label, href: child.href },
        ];
      }
    }
  }
  return [];
}
