import Link from "next/link";

import { cn } from "@/lib/utils";

interface LogoProps {
  href?: string;
  className?: string;
  showWordmark?: boolean;
  // The sidebar is deep teal in BOTH themes, so `bg-primary` (also teal) would
  // sit almost invisibly on it. The sidebar tone inverts the mark instead —
  // white tile, teal letter — which is also how the reference brand renders it.
  tone?: "default" | "sidebar";
}

export function Logo({
  href = "/",
  className,
  showWordmark = true,
  tone = "default",
}: LogoProps) {
  const sidebarTone = tone === "sidebar";
  const inner = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden
        className={cn(
          "relative grid size-7 place-items-center rounded-lg",
          sidebarTone
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "bg-primary text-primary-foreground",
        )}
      >
        {sidebarTone ? null : (
          <span className="absolute inset-0 rounded-lg bg-linear-to-br from-primary to-primary/70" />
        )}
        <span className="relative font-heading text-[13px] font-semibold leading-none">
          S
        </span>
      </span>
      {showWordmark ? (
        <span className="font-heading text-[15px] font-semibold tracking-tight">
          Skelo
        </span>
      ) : null}
    </span>
  );

  if (!href) return inner;
  return <Link href={href}>{inner}</Link>;
}
