"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CodeIcon,
  CreditCardIcon,
  LayoutGridIcon,
  LogOutIcon,
  MessageCircleIcon,
  RadioIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { useAppShell } from "@/components/app/app-shell";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: "unique_leads";
};

type NavSection = {
  label: string;
  items: readonly NavItem[];
};

const SECTIONS: readonly NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutGridIcon },
      // /pulse is intentionally hidden from the sidebar (route still exists
      // and is reachable by deep-link). See docs/sitemap.md → Hidden routes.
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
      },
      {
        href: "/conversations",
        label: "Conversations",
        icon: MessageCircleIcon,
      },
    ],
  },
  {
    label: "Outreach",
    items: [{ href: "/campaigns", label: "Campaigns", icon: RadioIcon }],
  },
  {
    label: "System",
    items: [
      { href: "/settings", label: "Settings", icon: SettingsIcon },
      { href: "/developer", label: "Developer", icon: CodeIcon },
      { href: "/billing", label: "Billing", icon: CreditCardIcon },
    ],
  },
];

export function SidebarNav({
  organisationName,
  organisationSlug,
  uniqueLeadCount,
}: {
  organisationName: string;
  organisationSlug: string;
  uniqueLeadCount: number;
}) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const { collapsed } = useAppShell();

  function onLogout() {
    startTransition(async () => {
      const result = await logout();
      if (!result.success) toast.error(result.error);
    });
  }

  function getBadge(item: NavItem): string | null {
    if (!item.badgeKey) return null;
    if (uniqueLeadCount <= 0) return null;
    return uniqueLeadCount > 999 ? "999+" : String(uniqueLeadCount);
  }

  return (
    <aside
      className={cn(
        "sticky top-0 h-screen flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground",
        collapsed ? "hidden" : "hidden md:flex",
      )}
    >
      <div className="px-5 py-5">
        <Logo />
      </div>

      <div className="mx-3 mb-3 rounded-lg border border-border/70 bg-background/40 px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Workspace
        </div>
        <div className="mt-0.5 truncate font-heading text-sm font-medium">
          {organisationName}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {organisationSlug}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {SECTIONS.map((section) => (
          <div key={section.label} className="mb-4">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href));
                const Icon = item.icon;
                const badge = getBadge(item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      <span className="flex-1 font-medium">{item.label}</span>
                      {badge ? (
                        <span
                          className={cn(
                            "inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                            active
                              ? "bg-background/60 text-sidebar-accent-foreground"
                              : "bg-muted text-muted-foreground group-hover:bg-background group-hover:text-foreground",
                          )}
                          aria-label={`${uniqueLeadCount} unique leads`}
                        >
                          {badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border/60 p-4 text-xs text-muted-foreground">
        <p className="leading-snug">
          Tip: hit{" "}
          <kbd className="rounded border border-border bg-background px-1 py-0.5 text-[10px] font-medium">
            N
          </kbd>{" "}
          to add a lead from anywhere.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 w-full justify-start"
          disabled={pending}
          onClick={onLogout}
        >
          <LogOutIcon />
          {pending ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </aside>
  );
}
