"use client";

import * as React from "react";

import {
  DEFAULT_THEME,
  SYSTEM_DARK_QUERY,
  THEME_STORAGE_KEY,
  THEMES,
  isTheme,
  type ResolvedTheme,
  type Theme,
} from "@/lib/theme";

interface ThemeContextValue {
  /** What the user chose — may be "system". */
  theme: Theme;
  /** What that actually resolves to right now. Never "system". */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  themes: readonly Theme[];
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

// `storage` only fires in OTHER tabs, so a same-tab setTheme needs its own
// signal for useSyncExternalStore to notice the write.
const THEME_CHANGE_EVENT = "skelo:themechange";

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    // Private mode / blocked storage. Falling back is correct; throwing here
    // would take down the whole app over a preference.
    return DEFAULT_THEME;
  }
}

// --- External stores -------------------------------------------------------
// localStorage and matchMedia are external systems, so they are read through
// useSyncExternalStore rather than mirrored into state from an effect. That
// keeps the render tear-free and avoids the cascading re-render a
// setState-in-effect would cause on every mount.

function subscribeToStoredTheme(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

// Snapshots return primitives, so repeat calls are Object.is-equal and React
// won't loop.
const getStoredThemeSnapshot = (): Theme => readStoredTheme();
const getServerThemeSnapshot = (): Theme => DEFAULT_THEME;

function subscribeToSystemDark(onChange: () => void) {
  const query = window.matchMedia(SYSTEM_DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const getSystemDarkSnapshot = (): boolean =>
  window.matchMedia(SYSTEM_DARK_QUERY).matches;
const getServerSystemDarkSnapshot = (): boolean => false;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = React.useSyncExternalStore(
    subscribeToStoredTheme,
    getStoredThemeSnapshot,
    getServerThemeSnapshot,
  );
  const systemDark = React.useSyncExternalStore(
    subscribeToSystemDark,
    getSystemDarkSnapshot,
    getServerSystemDarkSnapshot,
  );

  const resolvedTheme: ResolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  // Skip the very first commit. THEME_BOOTSTRAP_SCRIPT already put the correct
  // class on <html> from the same inputs, so there is nothing to do — and
  // during hydration this effect would otherwise run against the *server*
  // snapshot (DEFAULT_THEME) and strip `.dark` for a frame, which is a white
  // flash on every load for dark-mode users.
  const bootstrapped = React.useRef(false);

  React.useEffect(() => {
    if (!bootstrapped.current) {
      bootstrapped.current = true;
      return;
    }

    const root = document.documentElement;

    // Suppress transitions across the switch, or every colour-transitioning
    // element animates at once and the flip reads as a smear.
    const style = document.createElement("style");
    style.appendChild(
      document.createTextNode(
        "*,*::before,*::after{transition:none!important}",
      ),
    );
    document.head.appendChild(style);

    root.classList.toggle("dark", resolvedTheme === "dark");
    root.style.colorScheme = resolvedTheme;

    // Force a reflow so the class change commits while transitions are still
    // suppressed, then release on the next tick.
    void window.getComputedStyle(root).opacity;
    const timer = window.setTimeout(() => style.remove(), 1);
    return () => {
      window.clearTimeout(timer);
      style.remove();
    };
  }, [resolvedTheme]);

  const setTheme = React.useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference won't survive a reload, but the session still works.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, themes: THEMES }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within <ThemeProvider>");
  }
  return context;
}
