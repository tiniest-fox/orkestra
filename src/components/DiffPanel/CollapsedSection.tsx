/**
 * CollapsedSection - Expandable separator showing hidden lines between hunks.
 */

import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { HighlightedLine } from "../../hooks/useDiff";
import { DiffLine } from "./DiffLine";

interface CollapsedSectionProps {
  taskId: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

export function CollapsedSection({ taskId, filePath, startLine, endLine }: CollapsedSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<HighlightedLine[]>([]);

  const hiddenCount = endLine - startLine + 1;

  const handleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const fullContent = await invoke<HighlightedLine[] | null>("workflow_get_file_content", {
        taskId,
        filePath,
      });

      if (!fullContent) {
        setError("Failed to load file content");
        return;
      }

      // Extract the hidden range (lines are 1-indexed, array is 0-indexed)
      const extractedLines = fullContent.slice(startLine - 1, endLine);

      // The lines from workflow_get_file_content already have line_type: "context"
      // and proper line numbers, so we can use them directly
      const contextLines: HighlightedLine[] = extractedLines;

      setLines(contextLines);
      setExpanded(true);
    } catch (err) {
      console.error("Failed to fetch file content:", err);
      setError("Failed to load hidden lines");
    } finally {
      setLoading(false);
    }
  };

  if (expanded) {
    return (
      <div>
        {lines.map((line, idx) => (
          <DiffLine key={`${startLine}-${idx}`} line={line} />
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleExpand}
      disabled={loading}
      className="w-full py-2 border-t border-b border-dashed border-stone-300 dark:border-stone-700 text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900/50 text-sm font-mono transition-colors"
    >
      {loading ? "Loading..." : error || `... ${hiddenCount} lines hidden ...`}
    </button>
  );
}
