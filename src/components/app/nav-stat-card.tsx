import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface NavStatCardProps {
  label: string;
  href: string;
  icon: React.ReactNode;
  /** Facts about the destination, joined with the product's `·` separator. */
  facts: Array<{ text: string; urgent?: boolean }>;
}

/**
 * A destination card: what is waiting behind a nav link, and a way in.
 *
 * The reference design uses these for three counts an operator can already find
 * on three other screens. Ours carry the things that are otherwise *invisible*
 * — leads flagged `pending_action`, reminders past due — because a card that
 * repeats a number you've seen is decoration, and a card that surfaces work
 * nobody has looked at is a dashboard.
 *
 * `urgent` marks a fact that means "something is waiting on you". It is the
 * only colour on the row, so it can't be lost in a wall of muted text.
 */
export function NavStatCard({ label, href, icon, facts }: NavStatCardProps) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-[13px] rounded-lg border border-border/70 bg-card p-[18px] transition-colors hover:border-border hover:bg-accent/40"
    >
      <span className="grid size-[34px] flex-none place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        <span className="mt-0.5 block truncate text-[11.5px] tabular-nums text-muted-foreground">
          {facts.map((f, i) => (
            <span key={f.text}>
              {i > 0 ? <span aria-hidden> · </span> : null}
              <span className={cn(f.urgent && "font-medium text-destructive")}>
                {f.text}
              </span>
            </span>
          ))}
        </span>
      </span>

      <ChevronRightIcon className="size-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
