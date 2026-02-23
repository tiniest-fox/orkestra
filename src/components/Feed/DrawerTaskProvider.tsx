//! Drawer-scoped task cache — owns diff fetching for the drawer's lifetime.
//!
//! Wrap each drawer body with this provider so diff data persists while the
//! drawer is open, regardless of which tab is currently visible. The cache is
//! dropped automatically when the drawer closes and the provider unmounts.

import { createContext, useContext } from "react";
import { useDiff } from "../../hooks/useDiff";
import type { HighlightedTaskDiff } from "../../hooks/useDiff";

interface DrawerTaskContextValue {
  diff: HighlightedTaskDiff | null;
  diffLoading: boolean;
  diffError: unknown;
}

const DrawerTaskContext = createContext<DrawerTaskContextValue | null>(null);

interface DrawerTaskProviderProps {
  taskId: string;
  children: React.ReactNode;
}

export function DrawerTaskProvider({ taskId, children }: DrawerTaskProviderProps) {
  const { diff, loading: diffLoading, error: diffError } = useDiff(taskId);
  return (
    <DrawerTaskContext.Provider value={{ diff, diffLoading, diffError }}>
      {children}
    </DrawerTaskContext.Provider>
  );
}

export function useDrawerDiff(): Pick<DrawerTaskContextValue, "diff" | "diffLoading" | "diffError"> {
  const ctx = useContext(DrawerTaskContext);
  if (!ctx) throw new Error("useDrawerDiff must be used inside DrawerTaskProvider");
  return { diff: ctx.diff, diffLoading: ctx.diffLoading, diffError: ctx.diffError };
}
