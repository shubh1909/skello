"use client";

import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  XIcon,
} from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * The chassis every detail sheet sits on: a pinned header (chrome row, identity,
 * actions, tabs) over an independently-scrolling body.
 *
 * ## Why the scroll model looks like this
 *
 * `SheetContent` is already `flex flex-col h-full`. The old sheets defeated that
 * by putting `overflow-y-auto` on the popup ITSELF, which is exactly why nothing
 * could be pinned — the header scrolled away with the content.
 *
 * Here the popup is `overflow-hidden`, the header is `shrink-0`, and each panel
 * is `min-h-0 flex-1 overflow-y-auto`. `min-h-0` is load-bearing: without it a
 * flex child refuses to shrink below its content height and the scrollbar
 * migrates back to the popup. Putting the scroller INSIDE each panel is also what
 * gives every tab its own scroll position.
 *
 * ⚠️ **Never put a display utility (`flex`, `grid`, `block`) on a panel.**
 * Base UI hides an inactive `keepMounted` panel with the `hidden` attribute,
 * which works via `[hidden] { display: none }` in the UA stylesheet. Any author
 * `display` class beats that and the hidden panel renders on top of the active
 * one. Nest a flex child instead — `DetailSheetPanel` does exactly that.
 *
 * No `ScrollArea`: we need native `scrollIntoView` to reveal a deep-linked row,
 * there are already nested scrollers (transcripts, call rails), and this costs
 * zero JS.
 */

// The primitive's own `data-[side=right]:sm:max-w-sm` only loses to an override
// with the SAME attribute-and-breakpoint prefix — tailwind-merge can't collapse
// two differently-prefixed classes, so the selector shape here is not optional.
const detailSheetWidth = cva("w-full data-[side=right]:sm:max-w-none", {
  variants: {
    width: {
      sm: "data-[side=right]:w-[min(96vw,28rem)]",
      md: "data-[side=right]:w-[min(96vw,36rem)]",
      lg: "data-[side=right]:w-[min(96vw,56rem)]",
      xl: "data-[side=right]:w-[min(96vw,80rem)]",
    },
  },
  defaultVariants: { width: "md" },
});

export interface DetailSheetTab {
  value: string;
  label: string;
  /** Trailing count. `0` renders; pass `undefined` to omit. */
  count?: number;
}

export interface DetailSheetShellProps
  extends VariantProps<typeof detailSheetWidth> {
  open: boolean;
  onOpenChange: (next: boolean) => void;

  /** Chrome row: shown when this sheet was stacked on top of another. */
  onBack?: () => void;
  backLabel?: string;
  /**
   * What dismissing this sheet means.
   *
   * `close` (default) — an X. The sheet is the end of the road.
   * `back` — a left arrow. The sheet was opened from a list or from another
   *   sheet, so dismissing returns you somewhere specific. An X there implies
   *   "done with this whole flow", which is the wrong promise.
   */
  dismiss?: "close" | "back";
  /** Chrome row: overflow menu content (destructive actions live here). */
  menu?: React.ReactNode;

  /**
   * Chrome row: step to the adjacent record without closing the sheet.
   *
   * Up / down rather than left / right, because they walk the LIST BEHIND the
   * sheet — the same direction the rows run. Left-pointing chevrons here would
   * compete with `onBack`, which means something else entirely.
   *
   * Omit both to hide the control. Pass the handler with `*Disabled` at the
   * ends of the list rather than dropping the buttons: a control that vanishes
   * on the first row shifts every other button one place left.
   */
  onPrev?: () => void;
  onNext?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  /** Names the thing being stepped through, for screen readers. */
  navLabel?: string;

  /** Identity block. */
  avatar?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Required for a11y. Usually visually hidden — the title carries the meaning. */
  description: string;
  /** Badge row under the title. */
  pills?: React.ReactNode;
  /** Primary actions. Collapsed out of the header on small screens. */
  actions?: React.ReactNode;

  tabs?: DetailSheetTab[];
  /** Controlled. Omit both this and `onTabChange` to let the shell manage it. */
  activeTab?: string;
  onTabChange?: (value: string) => void;
  /** Uncontrolled starting tab. Defaults to the first. */
  defaultTab?: string;

  children: React.ReactNode;
}

export function DetailSheetShell({
  open,
  onOpenChange,
  width,
  onBack,
  backLabel = "Back",
  dismiss = "close",
  menu,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  navLabel = "record",
  avatar,
  title,
  subtitle,
  description,
  pills,
  actions,
  tabs,
  activeTab,
  onTabChange,
  defaultTab,
  children,
}: DetailSheetShellProps) {
  const header = (
    // A soft top-down wash rather than a flat tint: the header reads as a
    // raised surface the body scrolls under, and the fade means the border is
    // the only hard edge in the chrome.
    <SheetHeader className="shrink-0 gap-3 border-b border-border/60 bg-linear-to-b from-primary/6 to-primary/2 p-4 pb-0">
      {/* Chrome row. The sheet's own close button is disabled and rendered here
          instead — as a flow child it can't overlap the badge row, which is why
          callers used to need manual `pr-12` clearance. */}
      <div className="flex items-center gap-1">
        {onBack ? (
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
            ‹ {backLabel}
          </Button>
        ) : null}
        {onPrev || onNext ? (
          <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-card/70 p-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onPrev}
              disabled={prevDisabled || !onPrev}
            >
              <ChevronUpIcon />
              <span className="sr-only">Previous {navLabel}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onNext}
              disabled={nextDisabled || !onNext}
            >
              <ChevronDownIcon />
              <span className="sr-only">Next {navLabel}</span>
            </Button>
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {menu}
          <SheetClose
            render={<Button variant="ghost" size="icon-sm" className="-mr-1" />}
          >
            {dismiss === "back" ? <ArrowLeftIcon /> : <XIcon />}
            <span className="sr-only">
              {dismiss === "back" ? "Back" : "Close"}
            </span>
          </SheetClose>
        </div>
      </div>

      {/* Identity and actions share a row, so the primary actions sit at the
          eye line of the name rather than a band below it. `flex-wrap` with
          `ml-auto` on the actions means they drop to their own line when the
          sheet is too narrow to hold both, instead of crushing the title. */}
      <div className="flex flex-wrap items-start gap-3">
        {avatar}
        <div className="min-w-0 flex-1 space-y-1.5">
          <SheetTitle className="truncate text-lg">{title}</SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
          {subtitle ? (
            <div className="truncate text-sm text-muted-foreground">
              {subtitle}
            </div>
          ) : null}
          {pills ? (
            <div className="flex flex-wrap items-center gap-1.5">{pills}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        ) : null}
      </div>

      {tabs && tabs.length > 0 ? (
        <TabsList variant="line" className="w-full justify-start">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {t.count !== undefined ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t.count}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      ) : (
        <div className="pb-4" />
      )}
    </SheetHeader>
  );

  const body =
    tabs && tabs.length > 0 ? (
      <Tabs
        // Controlled only when a caller actually drives it. Base UI's
        // `defaultValue` is `0` — an INDEX — so leaving both unset with string
        // tab values selects nothing and the sheet opens blank.
        {...(activeTab !== undefined
          ? { value: activeTab, onValueChange: onTabChange }
          : { defaultValue: defaultTab ?? tabs[0].value })}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {header}
        {children}
      </Tabs>
    ) : (
      <>
        {header}
        {children}
      </>
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        showCloseButton={false}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          detailSheetWidth({ width }),
        )}
      >
        {body}
      </SheetContent>
    </Sheet>
  );
}

/**
 * A scrolling tab panel.
 *
 * The scroll and the flex layout are on DIFFERENT elements on purpose — see the
 * `hidden` note on the shell. The outer panel carries no `display` class so
 * Base UI can hide it; the inner div does the stacking.
 */
export function DetailSheetPanel({
  value,
  children,
  className,
  fill = false,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
  /**
   * The panel gives its full height to the child and does NOT scroll itself.
   *
   * For content that owns its own scrolling — a two-pane rail + detail view,
   * where each side scrolls independently. Without this the panel scrolls *and*
   * the panes scroll, which produces two nested scrollbars and a rail that
   * drifts out of view.
   */
  fill?: boolean;
}) {
  return (
    <TabsContent
      value={value}
      keepMounted
      // NOTE: overflow/flex-1 only — never a `display` utility. See the shell
      // docblock: Base UI hides an inactive panel with `[hidden]`, and an author
      // `display` class overrides it.
      className={cn(
        "min-h-0 flex-1",
        fill ? "overflow-hidden" : "overflow-y-auto overscroll-contain",
      )}
    >
      <div
        className={cn(
          fill ? "flex h-full flex-col" : "flex flex-col gap-4 p-4",
          className,
        )}
      >
        {children}
      </div>
    </TabsContent>
  );
}

/** The same scrolling body, for a sheet with no tabs. */
export function DetailSheetBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className={cn("flex flex-col gap-4 p-4", className)}>{children}</div>
    </div>
  );
}
