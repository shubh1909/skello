import Link from "next/link";

import { cn } from "@/lib/utils";

interface LogoProps {
  href?: string;
  className?: string;
  showWordmark?: boolean;
}

export function Logo({
  href = "/",
  className,
  showWordmark = true,
}: LogoProps) {
  const inner = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden
        className="relative grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground"
      >
        <span className="absolute inset-0 rounded-lg bg-gradient-to-br from-primary to-primary/70" />
        <span className="relative font-heading text-[13px] font-semibold leading-none">
          S
        </span>
      </span>
      {showWordmark ? (
        <span className="font-heading text-[15px] font-semibold tracking-tight">
          Skello
        </span>
      ) : null}
    </span>
  );

  if (!href) return inner;
  return <Link href={href}>{inner}</Link>;
}
