"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/leads", label: "Leads", icon: UsersIcon },
  { href: "/reminders", label: "Reminders", icon: BellIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function SidebarNav({
  organisationName,
  organisationSlug,
}: {
  organisationName: string;
  organisationSlug: string;
}) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function onLogout() {
    startTransition(async () => {
      const result = await logout();
      if (!result.success) toast.error(result.error);
    });
  }

  return (
    <aside className="sticky top-0 hidden h-screen flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground md:flex">
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

      <nav className="flex-1 px-2">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
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
