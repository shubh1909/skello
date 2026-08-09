"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  MonitorIcon,
  MoonIcon,
  PhoneIcon,
  SearchIcon,
  SunIcon,
  UserIcon,
} from "lucide-react";

import { listLeads } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useTheme } from "@/components/theme-provider";
import { NAV_SECTIONS, type NavItem } from "@/lib/nav";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;
const LEAD_LIMIT = 6;

const THEME_OPTIONS: ReadonlyArray<{
  value: Theme;
  label: string;
  icon: typeof SunIcon;
}> = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "Match system", icon: MonitorIcon },
];

interface LeadHit {
  id: string;
  name: string | null;
  phone: string | null;
}

/** Results are tagged with the query that produced them. */
interface Hits {
  query: string;
  items: LeadHit[];
}

function matchesQuery(item: NavItem, query: string): boolean {
  if (!query) return true;
  const haystack = [item.label, item.href, ...(item.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/**
 * ⌘K navigation and lead lookup.
 *
 * Replaces the topbar's search box, which was an `<Input>` with no handler, no
 * state and no results — it looked like the app's primary search and did
 * nothing. The sidebar already advertised a keyboard shortcut, so the
 * affordance existed before anything was behind it.
 *
 * cmdk's own filtering is **off**. Lead hits come from the server, which
 * matches on fields (notes, `lead_data`) that never appear in the rendered
 * row — re-filtering them client-side would silently drop real results. Nav
 * items are filtered here instead, which is a substring test over the label,
 * href and the `keywords` on the nav model.
 */
export function CommandPalette({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<Hits>({ query: "", items: [] });

  const trimmed = query.trim();
  const wantsLeads = trimmed.length >= MIN_QUERY;

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) return;
      // Ctrl+K is "delete to end of line" in a text field on macOS, and the
      // browser's own focus-address-bar on some platforms. Only claim it when
      // the user isn't typing.
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      ) {
        return;
      }
      event.preventDefault();
      setOpen((prev) => !prev);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  React.useEffect(() => {
    if (!open || !wantsLeads) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await listLeads({
        org_slug: orgSlug,
        q: trimmed,
        limit: LEAD_LIMIT,
        offset: 0,
      });
      if (cancelled) return;
      // Tagged with its query rather than cleared on every keystroke: an
      // out-of-date response is discarded by the `hits.query === trimmed`
      // test at render, so this effect never has to set state synchronously.
      setHits({
        query: trimmed,
        items: result.success
          ? result.data.items.map((lead) => ({
              id: lead.id,
              name: lead.name,
              phone: lead.phone,
            }))
          : [],
      });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, orgSlug, trimmed, wantsLeads]);

  const fresh = wantsLeads && hits.query === trimmed;
  const leads = fresh ? hits.items : [];
  const searching = wantsLeads && !fresh;

  const needle = trimmed.toLowerCase();
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.flatMap((item) => [
      ...(matchesQuery(item, needle) ? [item] : []),
      ...(item.children ?? []).filter((child) => matchesQuery(child, needle)),
    ]),
  })).filter((section) => section.items.length > 0);

  const themes = THEME_OPTIONS.filter(
    (option) =>
      !needle ||
      `theme ${option.label} appearance dark light`
        .toLowerCase()
        .includes(needle),
  );

  const nothing =
    sections.length === 0 && themes.length === 0 && leads.length === 0;

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Reset in the handler, not an effect: reopening to the last query would
    // show stale results for a workspace that may have changed underneath.
    if (!next) setQuery("");
  }

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <>
      {/* Looks like the search field it replaces, but says what it is. The
          shortcut is on the control rather than hidden in the sidebar tip. */}
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="hidden h-9 w-full max-w-sm justify-start gap-2 px-2.5 text-muted-foreground font-normal md:flex"
      >
        <SearchIcon className="size-4" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
          ⌘K
        </kbd>
      </Button>

      {/* Below md the label would crowd out the breadcrumb, so it collapses to
          the icon — the shortcut is unreachable on a phone anyway. */}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className="md:hidden"
      >
        <SearchIcon />
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Command palette"
        description="Jump to a page, find a lead, or change the appearance."
        className="sm:max-w-lg"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search leads, or jump to a page…"
          />
          <CommandList className="max-h-[min(60vh,24rem)]">
            {nothing ? (
              <CommandEmpty>
                {searching ? "Searching…" : `No matches for “${trimmed}”.`}
              </CommandEmpty>
            ) : null}

            {sections.map((section) => (
              <CommandGroup key={section.label} heading={section.label}>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.href}
                      value={item.href}
                      onSelect={() => go(item.href)}
                    >
                      <Icon className="text-muted-foreground" />
                      <span>{item.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}

            {wantsLeads ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Leads">
                  {searching ? (
                    <CommandItem disabled value="__searching">
                      <span className="text-muted-foreground">Searching…</span>
                    </CommandItem>
                  ) : null}
                  {leads.map((lead) => (
                    <CommandItem
                      key={lead.id}
                      value={`lead:${lead.id}`}
                      // The leads table opens its sheet from client state, not
                      // from the URL, so there is no `?lead=<id>` to link to.
                      // `?q=` is the honest deep link: it filters the table
                      // server-side down to this person.
                      onSelect={() =>
                        go(
                          `/leads?include=all&q=${encodeURIComponent(
                            lead.phone ?? lead.name ?? "",
                          )}`,
                        )
                      }
                    >
                      <UserIcon className="text-muted-foreground" />
                      <span className={cn(!lead.name && "text-muted-foreground")}>
                        {lead.name ?? "Unnamed lead"}
                      </span>
                      {lead.phone ? (
                        <CommandShortcut className="font-mono">
                          {lead.phone}
                        </CommandShortcut>
                      ) : null}
                    </CommandItem>
                  ))}
                  {!searching && leads.length === 0 ? (
                    <CommandItem disabled value="__noleads">
                      <PhoneIcon className="text-muted-foreground" />
                      <span className="text-muted-foreground">
                        No lead matches “{trimmed}”
                      </span>
                    </CommandItem>
                  ) : null}
                </CommandGroup>
              </>
            ) : null}

            {themes.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Appearance">
                  {themes.map((option) => {
                    const Icon = option.icon;
                    return (
                      <CommandItem
                        key={option.value}
                        value={`theme:${option.value}`}
                        data-checked={theme === option.value}
                        onSelect={() => {
                          setTheme(option.value);
                          setOpen(false);
                        }}
                      >
                        <Icon className="text-muted-foreground" />
                        <span>{option.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
