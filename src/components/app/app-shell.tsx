"use client";

import * as React from "react";
import { PanelLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "skelo.sidebar.collapsed.v1";
// `storage` only fires in OTHER tabs, so a same-tab toggle needs its own signal
// for useSyncExternalStore to notice the write. Same shape as the theme store.
const CHANGE_EVENT = "skelo:sidebarchange";

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

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

// Returns a primitive, so repeat calls are Object.is-equal and React won't loop.
function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private mode / blocked storage. A preference is not worth an exception.
    return false;
  }
}

const getServerSnapshot = (): boolean => false;

export function AppShellProvider({ children }: { children: React.ReactNode }) {
  // localStorage is an external store, so it is read through
  // useSyncExternalStore rather than mirrored into state from an effect —
  // which is a cascading render on every mount, and what eslint's
  // `set-state-in-effect` was flagging here.
  const collapsed = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const toggle = React.useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, getSnapshot() ? "0" : "1");
    } catch {
      // Non-fatal: the preference won't survive a reload.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = React.useMemo(
    () => ({ collapsed, toggle }),
    [collapsed, toggle],
  );

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
        // Collapsed is a 4rem icon rail, not `1fr`. Animating to a single
        // column removed every piece of wayfinding in the app.
        collapsed
          ? "grid-cols-[1fr] md:grid-cols-[4rem_1fr]"
          : "grid-cols-[1fr] md:grid-cols-[260px_1fr]",
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
