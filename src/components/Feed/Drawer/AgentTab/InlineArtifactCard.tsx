// Collapsible artifact card rendered inline in the agent timeline.

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { WorkflowArtifact } from "../../../../types/workflow";
import { formatTimestamp } from "../../../../utils";
import { Button } from "../../../ui/Button";
import { ArtifactView } from "../../ArtifactView";
import { ArtifactBadge } from "../../OutcomeBadge";

interface InlineArtifactCardProps {
  artifact: WorkflowArtifact;
  needsReview: boolean;
  verdict?: "approved" | "rejected";
  rejectionTarget?: string;
  onApprove: () => void;
  loading: boolean;
}

export function InlineArtifactCard({
  artifact,
  needsReview,
  verdict,
  rejectionTarget,
  onApprove,
  loading,
}: InlineArtifactCardProps) {
  const [expanded, setExpanded] = useState(needsReview);

  const preview = artifact.content?.slice(0, 150) ?? "";
  const hasPreview = preview.length > 0;

  return (
    <div className="border border-border rounded-lg mx-4 my-3 bg-surface-2">
      {/* Header row — click to toggle expand. Must be div+role because it contains inner <Button> elements;
          nesting <button> inside <button> is invalid HTML per CLAUDE.md. */}
      {/* biome-ignore lint/a11y/useSemanticElements: contains inner <Button> — nested <button> inside <button> is invalid HTML */}
      <div
        role="button"
        tabIndex={0}
        className="flex items-center justify-between p-3 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v);
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ArtifactBadge
            artifactName={artifact.name}
            verdict={verdict}
            rejectionTarget={rejectionTarget}
          />
          <span className="text-forge-mono-label text-text-tertiary truncate">
            Iteration {artifact.iteration} · {formatTimestamp(artifact.created_at)}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {needsReview && !verdict && (
            <Button
              variant="violet"
              onClick={(e) => {
                e.stopPropagation();
                onApprove();
              }}
              disabled={loading}
            >
              Approve
            </Button>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-text-tertiary" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-tertiary" />
          )}
        </div>
      </div>

      {/* Collapsed preview */}
      {!expanded && hasPreview && (
        <div className="px-3 pb-3">
          <p className="text-forge-body text-text-secondary line-clamp-2 font-sans">
            {preview}
            {artifact.content && artifact.content.length > 150 ? "…" : ""}
          </p>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border">
          <ArtifactView artifact={artifact} verdict={verdict} rejectionTarget={rejectionTarget} />
        </div>
      )}
    </div>
  );
}
