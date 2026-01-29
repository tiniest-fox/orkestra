/**
 * Artifact view - displays a markdown artifact with metadata.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { WorkflowArtifact } from "../../types/workflow";
import { formatTimestamp } from "../../utils/formatters";

interface ArtifactViewProps {
  artifact: WorkflowArtifact;
}

const PROSE_CLASSES = [
  // Base prose
  "prose prose-sm max-w-none",
  // Colors
  "prose-headings:text-stone-800",
  "prose-p:text-stone-700",
  "prose-li:text-stone-700",
  "prose-code:bg-stone-100 prose-code:px-1 prose-code:rounded",
  "prose-pre:bg-stone-100 prose-pre:text-stone-800",
  // Compact heading sizes: h1 ~16px (1.143em of 14px base), h2 ~15px, h3 ~14.5px, h4-h6 at base
  "prose-h1:text-[1.143em] prose-h1:font-semibold",
  "prose-h2:text-[1.071em] prose-h2:font-semibold",
  "prose-h3:text-[1.035em] prose-h3:font-semibold",
  "prose-h4:text-sm prose-h4:font-semibold",
  "prose-h5:text-sm prose-h5:font-medium",
  "prose-h6:text-sm prose-h6:font-medium",
  // Compact vertical spacing
  "prose-headings:mt-3 prose-headings:mb-1",
  "prose-p:my-1",
  "prose-ul:my-1 prose-ol:my-1",
  "prose-ul:pl-[1.1em] prose-ol:pl-[1.1em]",
  "prose-li:my-0",
  "prose-pre:my-1.5",
  "prose-blockquote:my-1.5",
  "prose-hr:my-2",
  // Table overflow
  "artifact-prose",
].join(" ");

export function ArtifactView({ artifact }: ArtifactViewProps) {
  return (
    <div className="p-4">
      <div className="text-xs text-stone-500 mb-2">
        Stage: {artifact.stage} | Iteration: {artifact.iteration} |{" "}
        {formatTimestamp(artifact.created_at)}
      </div>
      <div className={PROSE_CLASSES}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown>
      </div>
    </div>
  );
}
