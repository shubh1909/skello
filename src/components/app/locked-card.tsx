import { ClockIcon, LockIcon } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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

      <Empty className="border py-16">
        <EmptyHeader>
          <EmptyMedia
            variant="icon"
            className={cn(
              "size-12 rounded-full",
              // Denied is the one empty state that is a refusal rather than an
              // absence, so it keeps the destructive tint.
              variant === "denied" && "bg-destructive-muted text-destructive",
            )}
          >
            <Icon className="size-5" />
          </EmptyMedia>
          <EmptyTitle>{heading}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
