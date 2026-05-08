"use client";

import * as React from "react";
import { PanelLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "skelo.sidebar.collapsed.v1";

type AppShellContextValue = {
  collapsed: boolean;
  toggle: () => void;
};

const AppShellContext = React.createContext<AppShellContextValue | null>(null);

export function useAppShell(): AppShellContextValue {
  const ctx = React.useContext(AppShellContext);
  if (!ctx) throw new Error("useAppShell must be used inside <AppShellProvider>");
  return ctx;
}

export function AppShellProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);

  // Hydrate persisted preference on mount. Default (expanded) renders on the
  // server so we accept a one-frame flash for users who collapsed previously.
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
    } catch {
      // Ignore — quota or denied storage.
    }
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Non-fatal.
      }
      return next;
    });
  }, []);

  const value = React.useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);

  return (
    <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>
  );
}

export function AppShellGrid({ children }: { children: React.ReactNode }) {
  const { collapsed } = useAppShell();
  return (
    <div
      className={cn(
        "grid min-h-screen w-full bg-background transition-[grid-template-columns] duration-200",
        collapsed ? "grid-cols-[1fr]" : "grid-cols-[1fr] md:grid-cols-[260px_1fr]",
      )}
    >
      {children}
    </div>
  );
}

export function SidebarToggle() {
  const { collapsed, toggle } = useAppShell();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="hidden md:inline-flex"
    >
      <PanelLeftIcon />
    </Button>
  );
}
