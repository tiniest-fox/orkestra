// Collapsible card for displaying an artifact produced during agent execution.

import { ChevronDown, ChevronUp } from "lucide-react";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useRichCodeBlocks } from "../../hooks/useRichCodeBlocks";
import type { WorkflowArtifact } from "../../types/workflow";
import { formatTimestamp } from "../../utils";
import { PROSE_CLASSES } from "../../utils/prose";
import { Button } from "../ui/Button";
import { richContentComponents, richContentPlugins } from "../ui/RichContent";
import { ArtifactBadge } from "./OutcomeBadge";

interface ArtifactLogCardProps {
  artifact: WorkflowArtifact;
  /** When provided, renders enhanced header with approve button (latest artifact in drawer). */
  needsReview?: boolean;
  verdict?: "approved" | "rejected";
  rejectionTarget?: string;
  onApprove?: () => void;
  loading?: boolean;
  /** When true, dims the card (superseded by a later artifact). */
  superseded?: boolean;
  /** When true, renders only the body — the header is a separate Virtua item above. */
  bodyOnly?: boolean;
}

export function ArtifactLogCard({
  artifact,
  needsReview,
  verdict,
  rejectionTarget,
  onApprove,
  loading,
  superseded,
  bodyOnly,
}: ArtifactLogCardProps) {
  // Default expanded when latest artifact needs review; collapsed for feed/superseded.
  const [expanded, setExpanded] = useState(() => bodyOnly || !!(onApprove && needsReview));
  const htmlRef = useRef<HTMLDivElement>(null);
  useRichCodeBlocks(htmlRef, expanded ? (artifact.html ?? "") : "");

  const toggle = () => setExpanded((v) => !v);

  const isActionable = onApprove !== undefined;

  const bodyContent = (
    <>
      {artifact.html ? (
        <div
          ref={htmlRef}
          className={`text-forge-body ${PROSE_CLASSES}`}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is pre-rendered by the backend from trusted markdown
          dangerouslySetInnerHTML={{ __html: artifact.html }}
        />
      ) : artifact.content ? (
        <div className={`text-forge-body ${PROSE_CLASSES}`}>
          <ReactMarkdown remarkPlugins={richContentPlugins} components={richContentComponents}>
            {artifact.content}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-forge-body text-text-quaternary italic">No content</p>
      )}
    </>
  );

  // Body-only: the sticky header is a separate Virtua item rendered above this one.
  if (bodyOnly) {
    return (
      <div className="border-l border-r border-b border-border rounded-b-lg bg-surface px-3 pt-2 pb-3">
        {bodyContent}
      </div>
    );
  }

  return (
    <div className={`my-1 ${superseded ? "opacity-60" : ""}`}>
      {isActionable ? (
        // Enhanced header for latest artifact — sticky wrapper with a canvas-colored cap to block
        // content scrolling through the gap above the header.
        <div className="sticky -top-4 z-10">
          {/* Opaque cap that covers the gap zone — matches scroll container bg. */}
          <div className="h-6 bg-canvas" aria-hidden="true" />
          {/* biome-ignore lint/a11y/useSemanticElements: contains inner <Button> — nested <button> inside <button> is invalid HTML */}
          <div
            role="button"
            tabIndex={0}
            className={`-mt-2 flex items-center justify-between px-3 py-2 cursor-pointer select-none hover:bg-surface-2 bg-surface border border-border ${expanded ? "rounded-t-lg" : "rounded-lg"}`}
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") toggle();
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
              {needsReview && (
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
        </div>
      ) : (
        // Card-style header for feed/superseded contexts — matches actionable path visually but without sticky wrapper or approve button.
        <button
          type="button"
          className={`flex items-center justify-between px-3 py-2 cursor-pointer select-none hover:bg-surface-2 bg-surface border border-border w-full text-left ${expanded ? "rounded-t-lg" : "rounded-lg"}`}
          onClick={toggle}
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
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-text-tertiary" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-tertiary" />
            )}
          </div>
        </button>
      )}
      {expanded && (
        <div className="relative z-0 border-l border-r border-b border-border rounded-b-lg bg-surface px-3 pt-2 pb-3">
          {bodyContent}
        </div>
      )}
    </div>
  );
}
