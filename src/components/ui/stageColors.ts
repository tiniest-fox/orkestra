/**
 * Canonical color definitions for workflow stages.
 *
 * Each palette entry has:
 * - `dot`: solid fill for kanban column dot indicators
 * - `badge`: light background + text for stage badges on subtask cards
 *
 * Stages are assigned colors by their position in the workflow config,
 * cycling through the palette if there are more stages than entries.
 */

import type { WorkflowConfig } from "../../types/workflow";

export interface StageColorSet {
  /** Solid fill for column dot indicator. */
  dot: string;
  /** Light background + dark text for badges. */
  badge: string;
}

/** Orange → purple gradient palette for workflow stages. */
export const STAGE_PALETTE: StageColorSet[] = [
  {
    dot: "bg-orange-500",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  },
  {
    dot: "bg-orange-400",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  },
  {
    dot: "bg-purple-400",
    badge: "bg-violet-100 text-violet-600 dark:bg-violet-900 dark:text-violet-300",
  },
  {
    dot: "bg-purple-500",
    badge: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  },
  {
    dot: "bg-purple-600",
    badge: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  },
  {
    dot: "bg-purple-700",
    badge: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  },
  {
    dot: "bg-purple-800",
    badge: "bg-purple-100 text-purple-900 dark:bg-purple-900 dark:text-purple-200",
  },
  {
    dot: "bg-stone-500",
    badge: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
  },
];

/** Map stage names to their color sets based on position in the workflow config. */
export function buildStageColorMap(config: WorkflowConfig): Record<string, StageColorSet> {
  const map: Record<string, StageColorSet> = {};
  for (let i = 0; i < config.stages.length; i++) {
    map[config.stages[i].name] = STAGE_PALETTE[i % STAGE_PALETTE.length];
  }
  return map;
}
