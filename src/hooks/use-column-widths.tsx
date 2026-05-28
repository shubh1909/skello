"use client";

import * as React from "react";

// Per-user column width storage. Each table owns its own storage key —
// typically scoped to the org slug so a workspace's layout is independent
// from another's. The shape is a flat { columnKey: pxWidth } map; missing
// keys fall back to the caller's defaults.

export const MIN_COLUMN_WIDTH = 60;

export function useColumnWidths(storageKey: string) {
  const [widths, setWidths] = React.useState<Record<string, number>>({});

  // Hydrate from localStorage after mount (SSR-safe).
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setWidths(parsed as Record<string, number>);
      }
    } catch {
      // Corrupt JSON or storage disabled — fall through to defaults.
    }
  }, [storageKey]);

  const setWidth = React.useCallback(
    (key: string, width: number) => {
      setWidths((prev) => {
        const next = {
          ...prev,
          [key]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)),
        };
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Storage quota / disabled — width still applies for this session.
        }
        return next;
      });
    },
    [storageKey],
  );

  // Factory: returns a mousedown handler that drives a column-resize drag.
  // Listeners attach to the window so the drag survives the cursor leaving
  // the handle; teardown restores the body cursor and selection.
  const makeResizeStarter = React.useCallback(
    (key: string, startingWidth: number) => {
      return (e: React.MouseEvent) => {
        const startX = e.clientX;
        const startW = startingWidth;
        function onMove(ev: MouseEvent) {
          setWidth(key, startW + (ev.clientX - startX));
        }
        function onUp() {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      };
    },
    [setWidth],
  );

  return { widths, setWidth, makeResizeStarter };
}

export function ColumnResizeHandle({
  onStart,
}: {
  onStart: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onStart(e);
      }}
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize touch-none select-none bg-border/70 hover:bg-primary/60 active:bg-primary"
    />
  );
}
