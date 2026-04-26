interface HorizontalBarListProps {
  items: Array<{ label: string; value: number }>;
  emptyLabel?: string;
  total?: number;
  totalLabel?: string;
}

export function HorizontalBarList({
  items,
  emptyLabel = "Nothing to show yet.",
  total,
  totalLabel = "Total",
}: HorizontalBarListProps) {
  const max = Math.max(...items.map((i) => i.value), 0);

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border/70 py-8 text-center text-xs text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => {
          const pct = max > 0 ? (item.value / max) * 100 : 0;
          return (
            <li
              key={item.label}
              className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3"
            >
              <span
                className="truncate text-sm text-foreground"
                title={item.label}
              >
                {item.label}
              </span>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="tabular-nums text-sm font-medium">
                {item.value}
              </span>
            </li>
          );
        })}
      </ul>
      {typeof total === "number" ? (
        <div className="flex justify-end text-xs text-muted-foreground">
          {totalLabel}:{" "}
          <span className="ml-1 font-medium tabular-nums text-foreground">
            {total}
          </span>
        </div>
      ) : null}
    </div>
  );
}
