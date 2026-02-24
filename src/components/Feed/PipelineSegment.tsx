//! Single 4px-tall bar segment representing one pipeline stage state.

import type { SegmentState } from "../../utils/pipelineSegments";

interface PipelineSegmentProps {
  state: SegmentState;
}

const STATE_CLASSES: Record<SegmentState, string> = {
  done: "bg-status-success-bg",
  active: "bg-status-warning [animation:pipe-active-pulse_1.5s_ease-in-out_infinite]",
  review: "bg-status-warning",
  failed: "bg-status-error",
  pending: "bg-canvas",
  dim: "bg-canvas opacity-45",
  integration: "bg-accent",
};

export function PipelineSegment({ state }: PipelineSegmentProps) {
  return <div className={`h-1 rounded-sm flex-1 ${STATE_CLASSES[state]}`} />;
}
