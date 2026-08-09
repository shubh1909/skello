"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2Icon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Name / file search for the campaigns list.
 *
 * URL-driven like every other filter in the app, so a filtered view is
 * shareable and the back button undoes a search. Status is a sibling `NavTabs`
 * rather than a select — four mutually exclusive values with counts read better
 * as tabs, and it keeps this control down to one input.
 */
export function CampaignsFilterBar({ search }: { search: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [value, setValue] = React.useState(search);

  const commit = React.useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("q", next);
      else params.delete("q");
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  // Debounced: every keystroke is a server round trip otherwise. The timeout
  // callback is what calls `commit`, so nothing sets state synchronously in the
  // effect body.
  React.useEffect(() => {
    if (value.trim() === search) return;
    const timer = window.setTimeout(() => commit(value.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [value, search, commit]);

  return (
    <div className="relative w-full md:w-64">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search campaigns…"
        aria-label="Search campaigns by name or file"
        className="h-9 pl-8"
      />
      {pending ? (
        <Loader2Icon className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : value ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear search"
          onClick={() => {
            setValue("");
            commit("");
          }}
          className="absolute top-1/2 right-1 size-6 -translate-y-1/2"
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}
