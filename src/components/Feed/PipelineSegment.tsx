//! Single 4px-tall bar segment representing one pipeline stage state.

import type { SegmentState } from "../../utils/pipelineSegments";

interface PipelineSegmentProps {
  state: SegmentState;
}

const STATE_CLASSES: Record<SegmentState, string> = {
  done: "bg-[var(--green-dim)]",
  active: "bg-[var(--amber)] [animation:pipe-active-pulse_1.5s_ease-in-out_infinite]",
  review: "bg-[var(--amber)]",
  failed: "bg-[var(--red)]",
  pending: "bg-[var(--surface-3)]",
  dim: "bg-[var(--surface-3)] opacity-45",
  integration: "bg-[var(--accent-2)]",
};

export function PipelineSegment({ state }: PipelineSegmentProps) {
  return <div className={`h-1 rounded-sm flex-1 ${STATE_CLASSES[state]}`} />;
}
