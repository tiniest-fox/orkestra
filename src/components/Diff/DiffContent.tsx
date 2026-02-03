/**
 * DiffContent - Right-side unified diff view.
 *
 * Displays:
 * - File path header
 * - Binary file message if applicable
 * - Hunks with automatic collapsing of large context sections
 */

import type { HighlightedFileDiff, HighlightedLine } from "../../hooks/useDiff";
import { CollapsedSection } from "./CollapsedSection";
import { DiffLine } from "./DiffLine";

interface DiffContentProps {
  file: HighlightedFileDiff | null;
}

const COLLAPSE_THRESHOLD = 8;

export function DiffContent({ file }: DiffContentProps) {
  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Select a file to view diff
      </div>
    );
  }

  if (file.is_binary) {
    return (
      <div className="flex-1 p-4">
        <div className="text-sm font-medium mb-2">{file.path}</div>
        <div className="text-gray-500">Binary file</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      {/* File path header */}
      <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-4 py-2 text-sm font-medium">
        {file.path}
        {file.old_path && (
          <span className="text-gray-500 ml-2">
            (renamed from {file.old_path})
          </span>
        )}
      </div>

      {/* Hunks */}
      <div>
        {file.hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex} className="border-b border-gray-800">
            {/* Hunk header */}
            <div className="bg-gray-800 px-4 py-1 text-xs font-mono text-gray-400">
              @@ -{hunk.old_start},{hunk.old_count} +{hunk.new_start},{hunk.new_count} @@
            </div>

            {/* Hunk lines with smart collapsing */}
            {renderHunkLines(hunk.lines)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Render hunk lines with smart collapsing of large context sections.
 *
 * Shows first 3 and last 3 context lines, collapses the middle if > 8 lines.
 */
function renderHunkLines(lines: HighlightedLine[]) {
  const sections: { type: "render" | "collapse"; lines: HighlightedLine[] }[] = [];
  let currentContextSection: HighlightedLine[] = [];

  for (const line of lines) {
    if (line.line_type === "context") {
      currentContextSection.push(line);
    } else {
      // Flush any accumulated context
      if (currentContextSection.length > 0) {
        sections.push(
          currentContextSection.length > COLLAPSE_THRESHOLD
            ? {
                type: "collapse",
                lines: currentContextSection.slice(3, -3),
              }
            : { type: "render", lines: currentContextSection },
        );
        // Keep first 3 and last 3 if collapsing
        if (currentContextSection.length > COLLAPSE_THRESHOLD) {
          sections.push({ type: "render", lines: currentContextSection.slice(0, 3) });
          sections.push({ type: "render", lines: currentContextSection.slice(-3) });
        }
        currentContextSection = [];
      }

      // Render add/delete line
      sections.push({ type: "render", lines: [line] });
    }
  }

  // Flush remaining context
  if (currentContextSection.length > 0) {
    sections.push(
      currentContextSection.length > COLLAPSE_THRESHOLD
        ? {
            type: "collapse",
            lines: currentContextSection.slice(3, -3),
          }
        : { type: "render", lines: currentContextSection },
    );
    if (currentContextSection.length > COLLAPSE_THRESHOLD) {
      sections.push({ type: "render", lines: currentContextSection.slice(0, 3) });
      sections.push({ type: "render", lines: currentContextSection.slice(-3) });
    }
  }

  return sections.map((section, i) =>
    section.type === "collapse" ? (
      <CollapsedSection key={i} lines={section.lines} />
    ) : (
      section.lines.map((line, j) => <DiffLine key={`${i}-${j}`} line={line} />)
    ),
  );
}
