"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftIcon,
  Building2Icon,
  LayoutGridIcon,
  LogOutIcon,
  ShieldCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const NAV: readonly NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutGridIcon },
  {
    href: "/admin/organisations",
    label: "Organisations",
    icon: Building2Icon,
  },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
];

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
    <aside className="sticky top-0 hidden h-screen flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground md:flex">
      <div className="px-5 py-5">
        <Logo />
      </div>

      <div className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-primary">
        <ShieldCheckIcon className="size-4" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-widest">
            Admin console
          </div>
          <div className="truncate text-xs text-muted-foreground">{email}</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(item.href));
            const Icon = item.icon;
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
                  <span className="font-medium">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 border-t border-border/60 pt-3">
          <Link
            href="/dashboard"
            className="group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            <span className="font-medium">Back to customer app</span>
          </Link>
        </div>
      </nav>

      <div className="border-t border-border/60 p-4 text-xs text-muted-foreground">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
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
