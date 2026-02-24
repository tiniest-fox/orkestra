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

/** Accent → purple gradient palette for workflow stages. */
export const STAGE_PALETTE: StageColorSet[] = [
  {
    dot: "bg-accent",
    badge: "bg-accent-soft text-accent",
  },
  {
    dot: "bg-accent",
    badge: "bg-amber-100 text-amber-700",
  },
  {
    dot: "bg-purple-400",
    badge: "bg-violet-100 text-violet-600",
  },
  {
    dot: "bg-purple-500",
    badge: "bg-purple-100 text-purple-700",
  },
  {
    dot: "bg-purple-600",
    badge: "bg-purple-100 text-purple-700",
  },
  {
    dot: "bg-purple-700",
    badge: "bg-purple-100 text-purple-800",
  },
  {
    dot: "bg-purple-800",
    badge: "bg-purple-100 text-purple-900",
  },
  {
    dot: "bg-stone-500",
    badge: "bg-stone-100 text-stone-600",
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
