"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftIcon, LogOutIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";

import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { ADMIN_NAV_SECTIONS, isNavActive } from "@/lib/nav";
import { cn } from "@/lib/utils";

const NAV = ADMIN_NAV_SECTIONS[0].items;

export function AdminSidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function onLogout() {
    startTransition(async () => {
      const result = await logout();
      if (!result.success) toast.error(result.error);
    });
  }

  return (
    // See sidebar-nav.tsx — everything in here must use `sidebar-*` tokens,
    // because the sidebar is deep teal in both themes.
    <aside className="sticky top-0 hidden h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="px-5 py-5">
        <Logo tone="sidebar" />
      </div>

      {/* The admin badge used `primary` to stand out from a light sidebar. On
          the dark sidebar primary IS the sidebar hue, so the highlight (lime)
          pair does that job instead — and it is the one place in the app loud
          enough to warrant it. */}
      <div className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-highlight-border/40 bg-highlight/10 px-3 py-2.5 text-highlight-border">
        <ShieldCheckIcon className="size-4" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-widest">
            Admin console
          </div>
          <div className="truncate text-xs text-sidebar-muted-foreground">
            {email}
          </div>
        </div>
      </div>

      <nav className="no-scrollbar flex-1 overflow-y-auto px-2 pb-2">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            // Shared with the customer sidebar: longest match, and the match
            // must land on a `/` boundary. The old local test had neither, so
            // it needed an `/admin` special case and would still have lit
            // Users on a hypothetical `/admin/users-export`.
            const active = isNavActive(pathname, item.href, ADMIN_NAV_SECTIONS);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 border-t border-sidebar-border pt-3">
          <Link
            href="/dashboard"
            className="group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-muted-foreground transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            <span className="font-medium">Back to customer app</span>
          </Link>
        </div>
      </nav>

      <div className="border-t border-sidebar-border p-4 text-xs text-sidebar-muted-foreground">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sidebar-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground"
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
