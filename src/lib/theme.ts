// Theme constants shared between the Server Component that inlines the
// bootstrap script and the client provider that owns the runtime state.
//
// Deliberately NOT in the "use client" provider module: layout.tsx is a Server
// Component, and importing a value across that boundary from a client module is
// murkier than it looks. A plain module both sides can import is the honest way.

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEMES: readonly Theme[] = ["light", "dark", "system"];

// Namespaced like the sidebar's `skelo.sidebar.collapsed.v1`. Not next-themes'
// bare "theme" key — nothing is stored under it yet (there has never been a
// toggle in the UI), so there is no migration to do.
export const THEME_STORAGE_KEY = "skelo.theme";

// Preserves the previous next-themes config (`defaultTheme="light"`): a visitor
// with no stored preference gets light, NOT their OS setting. Changing this to
// "system" would silently flip every dark-OS user to dark on next deploy.
export const DEFAULT_THEME: Theme = "light";

export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * The pre-paint bootstrap. Inlined into the document by the root layout so the
 * correct class is on <html> before first paint — without it, a dark-mode user
 * sees a white flash on every hard load.
 *
 * This is why we no longer use next-themes. It renders the equivalent script
 * from inside a *client* component, and React 19 warns (correctly) that a
 * script rendered on the client never executes. There is no prop to turn it
 * off. Rendered from a Server Component, as here, the browser gets it in the
 * HTML stream and runs it — which is the only place it was ever useful.
 *
 * Keep in lockstep with ThemeProvider's apply effect: if the two disagree about
 * how a stored value maps to a class, you get a flash on every load.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{
var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
var t=(s==="light"||s==="dark"||s==="system")?s:${JSON.stringify(DEFAULT_THEME)};
var d=t==="dark"||(t==="system"&&window.matchMedia(${JSON.stringify(SYSTEM_DARK_QUERY)}).matches);
var r=document.documentElement;
r.classList.toggle("dark",d);
r.style.colorScheme=d?"dark":"light";
}catch(e){}})();`;
