import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface PaginationProps {
  total: number;
  pageSize: number;
  currentPage: number; // 1-based
  baseHref: string;
  // Other URL search params to preserve when paging (filters, etc.).
  // Pass `searchParams` from the page directly; entries with undefined
  // values are dropped.
  preserveParams?: Record<string, string | string[] | undefined>;
}

function buildHref(
  baseHref: string,
  page: number,
  preserveParams: PaginationProps["preserveParams"],
): string {
  const params = new URLSearchParams();
  if (preserveParams) {
    for (const [k, v] of Object.entries(preserveParams)) {
      if (v === undefined || k === "page") continue;
      const value = Array.isArray(v) ? v[0] : v;
      if (value === undefined || value === "") continue;
      params.set(k, value);
    }
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${baseHref}?${qs}` : baseHref;
}

// Compact list: 1 … (cur-1) cur (cur+1) … last. At small totals, show all.
function pageList(currentPage: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const out: (number | "ellipsis")[] = [1];
  if (currentPage > 4) out.push("ellipsis");
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  for (let i = start; i <= end; i++) out.push(i);
  if (currentPage < totalPages - 3) out.push("ellipsis");
  out.push(totalPages);
  return out;
}

export function Pagination({
  total,
  pageSize,
  currentPage,
  baseHref,
  preserveParams,
}: PaginationProps) {
  if (total <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(1, Math.min(currentPage, totalPages));
  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(start + pageSize - 1, total);

  if (totalPages <= 1) {
    return (
      <div className="flex items-center justify-end px-1 text-xs text-muted-foreground">
        Showing {start}–{end} of {total.toLocaleString()}
      </div>
    );
  }

  const pages = pageList(safePage, totalPages);
  const prevHref = buildHref(baseHref, safePage - 1, preserveParams);
  const nextHref = buildHref(baseHref, safePage + 1, preserveParams);
  const hasPrev = safePage > 1;
  const hasNext = safePage < totalPages;

  return (
    <div className="flex flex-col items-center justify-between gap-3 px-1 sm:flex-row">
      <div className="text-xs text-muted-foreground">
        Showing <span className="tabular-nums">{start}</span>–
        <span className="tabular-nums">{end}</span> of{" "}
        <span className="tabular-nums">{total.toLocaleString()}</span>
      </div>
      <nav
        aria-label="Pagination"
        className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card p-1"
      >
        <PageLink
          href={prevHref}
          disabled={!hasPrev}
          aria-label="Previous page"
        >
          <ChevronLeftIcon className="size-3.5" />
        </PageLink>
        {pages.map((p, idx) =>
          p === "ellipsis" ? (
            <span
              key={`e-${idx}`}
              aria-hidden
              className="px-2 text-xs text-muted-foreground"
            >
              …
            </span>
          ) : (
            <PageLink
              key={p}
              href={buildHref(baseHref, p, preserveParams)}
              active={p === safePage}
              aria-label={`Page ${p}`}
              aria-current={p === safePage ? "page" : undefined}
            >
              {p}
            </PageLink>
          ),
        )}
        <PageLink
          href={nextHref}
          disabled={!hasNext}
          aria-label="Next page"
        >
          <ChevronRightIcon className="size-3.5" />
        </PageLink>
      </nav>
    </div>
  );
}

function PageLink({
  href,
  children,
  active,
  disabled,
  ...rest
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
} & Omit<React.ComponentProps<"a">, "href" | "children">) {
  const className = cn(
    "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs font-medium tabular-nums transition-colors",
    active
      ? "bg-foreground text-background"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
    disabled && "pointer-events-none opacity-40",
  );
  if (disabled) {
    return (
      <span className={className} aria-disabled {...rest}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}
