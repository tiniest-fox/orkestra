// Collapsible card for displaying an artifact produced during agent execution.

import { ChevronDown, ChevronUp } from "lucide-react";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useRichCodeBlocks } from "../../hooks/useRichCodeBlocks";
import type { LogEntry, WorkflowArtifact } from "../../types/workflow";
import { formatTimestamp } from "../../utils";
import { AnsiText } from "../../utils/ansi";
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
  /** When true, renders without white card background so the card blends into the chat canvas. */
  superseded?: boolean;
  /** Gate log entries to render inline below the artifact body when expanded. */
  gateEntries?: LogEntry[];
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
  gateEntries,
  bodyOnly,
}: ArtifactLogCardProps) {
  // Default expanded when latest artifact needs review; collapsed for feed/superseded.
  const [expanded, setExpanded] = useState(() => bodyOnly || !!(onApprove && needsReview));
  const htmlRef = useRef<HTMLDivElement>(null);
  useRichCodeBlocks(htmlRef, expanded ? (artifact.html ?? "") : "");

  const toggle = () => setExpanded((v) => !v);

  const isActionable = onApprove !== undefined;
  // Superseded cards blend into the chat canvas — no white card background.
  const cardBg = superseded ? "" : "bg-surface";

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
    <div className="my-1">
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
          className={`flex items-center justify-between px-3 py-2 cursor-pointer select-none hover:bg-surface-2 ${cardBg} border border-border w-full text-left ${expanded ? "rounded-t-lg" : "rounded-lg"}`}
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
        <div
          className={`relative z-0 border-l border-r border-b border-border rounded-b-lg ${cardBg} px-3 pt-2 pb-3`}
        >
          {bodyContent}
          {gateEntries && gateEntries.length > 0 && (
            <div className="border-t border-border mt-2 pt-2">
              {gateEntries.map((ge, idx) => {
                if (ge.type === "gate_started") {
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
                    <div key={idx} className="font-mono text-forge-mono-sm text-text-tertiary py-1">
                      Running: {ge.command}
                    </div>
                  );
                }
                if (ge.type === "gate_output") {
                  const outputCls =
                    "font-mono text-forge-mono-sm whitespace-pre-wrap text-text-secondary py-0.5";
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
                    <pre key={idx} className={outputCls}>
                      <AnsiText text={ge.content} />
                    </pre>
                  );
                }
                if (ge.type === "gate_completed") {
                  const cls = `font-mono text-forge-mono-sm py-1 ${ge.passed ? "text-status-success" : "text-status-error"}`;
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
                    <div key={idx} className={cls}>
                      {ge.passed ? "Gate passed" : `Gate failed (exit ${ge.exit_code})`}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
