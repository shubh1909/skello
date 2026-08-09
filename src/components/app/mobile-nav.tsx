"use client";

import * as React from "react";
import { MenuIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  SidebarNavBody,
  type SidebarNavProps,
} from "@/components/app/sidebar-nav";

/**
 * Navigation below `md`.
 *
 * The desktop `<aside>` is `hidden md:flex` with nothing behind it, so until
 * now the app had **no navigation at all** on a phone — every route was
 * reachable only by typing the URL. This is the drawer that was missing, not a
 * nicety.
 *
 * It reuses `SidebarNavBody` rather than restating the nav, and always renders
 * expanded: an icon rail inside a drawer would be a 64px sliver of a 100vw
 * panel.
 */
export function MobileNav(props: SidebarNavProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open navigation"
            className="md:hidden"
          />
        }
      >
        <MenuIcon />
      </SheetTrigger>

      <SheetContent
        side="left"
        showCloseButton={false}
        // Both width classes MUST carry the `data-[side=left]:` prefix. The
        // primitive's own `data-[side=left]:w-3/4` compiles to a
        // class-plus-attribute selector, which outranks a bare `w-…` no matter
        // what tailwind-merge does — and the two prefixes differ, so it can't
        // collapse them either. Same trap as detail-sheet-shell.tsx.
        className="gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground data-[side=left]:w-[min(88vw,17rem)] data-[side=left]:sm:max-w-none"
      >
        {/* The nav's own links are the accessible content; the title exists so
            the dialog has a name. */}
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Move between the sections of your workspace.
        </SheetDescription>

        {/* Closing on navigation is the whole contract of a nav drawer: Next's
            client router keeps the drawer mounted across a route change, so
            without this the new page renders behind an open panel. */}
        <SidebarNavBody {...props} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
