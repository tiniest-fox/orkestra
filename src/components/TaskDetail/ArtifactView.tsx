/**
 * Artifact view - displays a markdown artifact with metadata.
 */

import ReactMarkdown from "react-markdown";
import type { WorkflowArtifact } from "../../types/workflow";
import { formatTimestamp } from "../../utils/formatters";

interface ArtifactViewProps {
  artifact: WorkflowArtifact;
}

export function ArtifactView({ artifact }: ArtifactViewProps) {
  return (
    <div className="p-4">
      <div className="text-xs text-stone-500 mb-2">
        Stage: {artifact.stage} | Iteration: {artifact.iteration} |{" "}
        {formatTimestamp(artifact.created_at)}
      </div>
      <div className="prose prose-sm max-w-none prose-headings:text-stone-800 prose-p:text-stone-700 prose-li:text-stone-700 prose-code:bg-stone-100 prose-code:px-1 prose-code:rounded prose-pre:bg-stone-100 prose-pre:text-stone-800">
        <ReactMarkdown>{artifact.content}</ReactMarkdown>
      </div>
    </div>
  );
}
