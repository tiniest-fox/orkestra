// Collapsible log card for artifact_produced log entries.

import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useRichCodeBlocks } from "../../hooks/useRichCodeBlocks";
import type { WorkflowArtifact } from "../../types/workflow";
import { PROSE_CLASSES } from "../../utils/prose";
import { richContentComponents, richContentPlugins } from "../ui/RichContent";

export function ArtifactLogCard({ artifact }: { artifact: WorkflowArtifact }) {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const htmlRef = useRef<HTMLDivElement>(null);
  useRichCodeBlocks(htmlRef, expanded ? (artifact.html ?? "") : "");

  useEffect(() => {
    if (expanded && contentRef.current) {
      setIsOverflowing(contentRef.current.scrollHeight > contentRef.current.clientHeight);
    }
  }, [expanded]);

  const toggle = () => setExpanded((v) => !v);

  return (
    <div className="bg-surface rounded-lg border border-border my-1">
      <button
        type="button"
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-2 rounded-lg w-full text-left"
        onClick={toggle}
      >
        <ChevronRight
          size={14}
          className={`text-text-tertiary transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <span className="font-mono text-forge-mono-sm text-text-secondary">
          Generated {artifact.name}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <div ref={contentRef} className={showFull ? "" : "max-h-96 overflow-hidden"}>
            {artifact.html ? (
              <div
                ref={htmlRef}
                className={`text-forge-body ${PROSE_CLASSES}`}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is pre-rendered by the backend from trusted markdown
                dangerouslySetInnerHTML={{ __html: artifact.html }}
              />
            ) : artifact.content ? (
              <div className={`text-forge-body ${PROSE_CLASSES}`}>
                <ReactMarkdown
                  remarkPlugins={richContentPlugins}
                  components={richContentComponents}
                >
                  {artifact.content}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-forge-body text-text-quaternary italic">No content</p>
            )}
          </div>
          {isOverflowing && !showFull && (
            <button
              type="button"
              className="text-forge-mono-sm text-accent mt-2 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setShowFull(true);
              }}
            >
              Show more
            </button>
          )}
          {showFull && isOverflowing && (
            <button
              type="button"
              className="text-forge-mono-sm text-accent mt-2 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setShowFull(false);
              }}
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}
