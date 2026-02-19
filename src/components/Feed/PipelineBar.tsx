//! Horizontal container of pipeline stage segments.

import type { PipelineSegmentData } from "../../utils/pipelineSegments";
import { PipelineSegment } from "./PipelineSegment";

interface PipelineBarProps {
  segments: PipelineSegmentData[];
}

export function PipelineBar({ segments }: PipelineBarProps) {
  return (
    <div className="flex gap-0.5 items-center w-[148px]">
      {segments.map((seg) => (
        <PipelineSegment key={seg.stageName} state={seg.state} />
      ))}
    </div>
  );
}
