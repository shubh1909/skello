import { ClockIcon, LockIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface LockedCardProps {
  title: string;
  heading: string;
  description: string;
  variant?: "denied" | "soon";
}

export function LockedCard({
  title,
  heading,
  description,
  variant = "denied",
}: LockedCardProps) {
  const Icon = variant === "denied" ? LockIcon : ClockIcon;
  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          {title}
        </h1>
      </header>

      <Card className="items-center gap-3 py-16 text-center">
        <span
          className={cn(
            "grid size-12 place-items-center rounded-full",
            variant === "denied"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-5" />
        </span>
        <p className="font-medium">{heading}</p>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </Card>
    </div>
  );
}
