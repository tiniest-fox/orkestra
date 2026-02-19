/**
 * DiffContent - Right-side unified diff view.
 *
 * Displays:
 * - File path header
 * - Binary file message if applicable
 * - Hunks with automatic collapsing of large context sections
 */

import { Fragment, useMemo } from "react";
import type { HighlightedFileDiff, HighlightedLine } from "../../hooks/useDiff";
import type { PrComment } from "../../types/workflow";
import { CollapsedSection } from "./CollapsedSection";
import { DiffLine } from "./DiffLine";
import { InlineCommentBlock } from "./InlineCommentBlock";

interface DiffContentProps {
  file: HighlightedFileDiff | null;
  comments: PrComment[];
}

const COLLAPSE_THRESHOLD = 8;

export function DiffContent({ file, comments }: DiffContentProps) {
  // Filter comments for this file and group by line number
  const commentsByLine = useMemo(() => {
    const map = new Map<number, PrComment[]>();
    if (!file) return map;

    for (const comment of comments) {
      // Only include line-level comments (exclude file-level where line is null)
      if (comment.path === file.path && comment.line !== null) {
        const existing = map.get(comment.line) ?? [];
        existing.push(comment);
        map.set(comment.line, existing);
      }
    }
    return map;
  }, [comments, file]);

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center text-stone-400 dark:text-stone-500">
        Select a file to view changes
      </div>
    );
  }

  if (file.is_binary) {
    return (
      <div className="flex-1 p-4">
        <div className="text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
          {file.path}
        </div>
        <div className="text-stone-500 dark:text-stone-400">Binary file</div>
      </div>
    );
  }

  return (
    <div className="grow shrink basis-0 overflow-auto bg-white dark:bg-stone-900">
      {/* File path header */}
      <div className="sticky top-0 bg-stone-50 dark:bg-stone-800 border-b border-stone-200 dark:border-stone-700 px-4 py-2 text-sm font-medium text-stone-600 dark:text-stone-300">
        {file.path}
        {file.old_path && (
          <span className="text-stone-400 dark:text-stone-500 ml-2">
            (renamed from {file.old_path})
          </span>
        )}
      </div>

      {/* Hunks */}
      <div>
        {file.hunks.map((hunk) => (
          <div
            key={`${hunk.old_start}-${hunk.new_start}`}
            className="border-b border-stone-100 dark:border-stone-800"
          >
            {/* Hunk header */}
            <div className="bg-stone-100 dark:bg-stone-800 px-4 py-1 text-xs font-mono text-stone-500 dark:text-stone-400">
              @@ -{hunk.old_start},{hunk.old_count} +{hunk.new_start},{hunk.new_count} @@
            </div>

            {/* Hunk lines with smart collapsing */}
            {renderHunkLines(hunk.lines, commentsByLine)}
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
 * Renders inline comments after their corresponding lines.
 */
function renderHunkLines(lines: HighlightedLine[], commentsByLine: Map<number, PrComment[]>) {
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
      // biome-ignore lint/suspicious/noArrayIndexKey: section order is stable within hunk
      <CollapsedSection key={i} lines={section.lines} />
    ) : (
      section.lines.map((line, j) => {
        const lineComments =
          line.new_line_number !== null ? commentsByLine.get(line.new_line_number) : undefined;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: line order is stable within section
          <Fragment key={`${i}-${j}`}>
            <DiffLine line={line} />
            {lineComments && lineComments.length > 0 && (
              <InlineCommentBlock comments={lineComments} />
            )}
          </Fragment>
        );
      })
    ),
  );
}
