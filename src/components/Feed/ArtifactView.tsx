/**
 * Artifact view - displays a rendered artifact with metadata.
 *
 * Uses pre-rendered HTML from the backend when available,
 * falling back to client-side ReactMarkdown for older artifacts.
 * Large HTML is rendered progressively via useChunkedHtml to avoid
 * blocking the panel animation.
 */

import { useRef } from "react";
import ReactMarkdown from "react-markdown";
import { useChunkedHtml } from "../../hooks/useChunkedHtml";
import { useRichCodeBlocks } from "../../hooks/useRichCodeBlocks";
import type { WorkflowArtifact } from "../../types/workflow";
import { formatTimestamp, PROSE_CLASSES } from "../../utils";
import { useContentSettled } from "../ui";
import { richContentComponents, richContentPlugins } from "../ui/RichContent";

interface ArtifactViewProps {
  artifact: WorkflowArtifact;
}

export function ArtifactView({ artifact }: ArtifactViewProps) {
  // Defer heavy content rendering until all ancestor animations settle
  const isSettled = useContentSettled();
  const deferChunks = !isSettled;
  // Always call the hook (Rules of Hooks) — passes empty string when no HTML
  const chunked = useChunkedHtml(artifact.html ?? "", deferChunks);
  const hasPreRendered = !!artifact.html;

  const htmlContainerRef = useRef<HTMLDivElement>(null);
  useRichCodeBlocks(htmlContainerRef, chunked.html);

  return (
    <div className="p-4">
      <div className="text-xs text-text-secondary mb-2">
        Stage: {artifact.stage} | Iteration: {artifact.iteration} |{" "}
        {formatTimestamp(artifact.created_at)}
      </div>
      {hasPreRendered ? (
        <div
          ref={htmlContainerRef}
          className={PROSE_CLASSES}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is pre-rendered by the backend from trusted markdown
          dangerouslySetInnerHTML={{ __html: chunked.html }}
        />
      ) : (
        <div className={PROSE_CLASSES}>
          <ReactMarkdown remarkPlugins={richContentPlugins} components={richContentComponents}>
            {artifact.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
