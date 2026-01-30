/**
 * Shared animation state tracking for content containers (PanelSlot, TabbedPanel).
 *
 * Each animation container reads the parent context, merges its own per-key
 * phases, and provides the combined state to descendants. This lets deeply
 * nested components (e.g. ArtifactView) check whether ANY ancestor animation
 * is still running and defer heavy rendering accordingly.
 *
 * Example state after opening a panel and switching to the "plan" artifact tab:
 *   { "task-xxx": "settled", "plan": "entering" }
 */

import { createContext, useContext } from "react";

export type AnimationPhase = "hidden" | "entering" | "settled" | "exiting";

export interface ContentAnimationState {
  /** Per-key animation phases from all ancestor animation containers. */
  phases: Record<string, AnimationPhase>;
}

export const ContentAnimationContext = createContext<ContentAnimationState>({
  phases: {},
});

/** Read the full animation state map from all ancestor animation containers. */
export function useContentAnimation(): ContentAnimationState {
  return useContext(ContentAnimationContext);
}

/** Check whether all ancestor animations have settled. */
export function useContentSettled(): boolean {
  const { phases } = useContentAnimation();
  return Object.values(phases).every((p) => p === "settled");
}
