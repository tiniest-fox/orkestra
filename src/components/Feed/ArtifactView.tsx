/**
 * Artifact view - displays a rendered artifact with metadata.
 *
 * Uses pre-rendered HTML from the backend when available,
 * falling back to client-side ReactMarkdown for older artifacts.
 * Large HTML is rendered progressively via useChunkedHtml to avoid
 * blocking the panel animation.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChunkedHtml } from "../../hooks/useChunkedHtml";
import type { WorkflowArtifact } from "../../types/workflow";
import { formatTimestamp, PROSE_CLASSES } from "../../utils";
import { useContentSettled } from "../ui";

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

  return (
    <div className="p-4">
      <div className="text-xs text-text-secondary mb-2">
        Stage: {artifact.stage} | Iteration: {artifact.iteration} |{" "}
        {formatTimestamp(artifact.created_at)}
      </div>
      {hasPreRendered ? (
        <div
          className={PROSE_CLASSES}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is pre-rendered by the backend from trusted markdown
          dangerouslySetInnerHTML={{ __html: chunked.html }}
        />
      ) : (
        <div className={PROSE_CLASSES}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
