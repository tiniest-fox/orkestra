/**
 * DiffContent - Right side diff viewer showing hunks and collapsed sections.
 */

import { useEffect, useRef } from "react";
import type { HighlightedFileDiff } from "../../hooks/useDiff";
import { CollapsedSection } from "./CollapsedSection";
import { DiffLine } from "./DiffLine";

interface DiffContentProps {
  taskId: string;
  file: HighlightedFileDiff;
}

export function DiffContent({ taskId, file }: DiffContentProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevFilePathRef = useRef<string>(file.path);
  const prevHunksLengthRef = useRef<number>(file.hunks?.length ?? 0);

  // Preserve scroll position across refreshes
  useEffect(() => {
    const sameFile = prevFilePathRef.current === file.path;
    const sameHunkCount = prevHunksLengthRef.current === (file.hunks?.length ?? 0);

    // Only reset scroll if file changed or hunk structure changed
    if (!sameFile || !sameHunkCount) {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    }

    prevFilePathRef.current = file.path;
    prevHunksLengthRef.current = file.hunks?.length ?? 0;
  }, [file.path, file.hunks?.length]);

  // Binary file handling
  if (file.is_binary) {
    return (
      <div className="flex items-center justify-center h-full text-stone-500 dark:text-stone-400">
        Binary file changed
      </div>
    );
  }

  // No hunks
  if (!file.hunks || file.hunks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-stone-500 dark:text-stone-400">
        No diff content
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header bar with file path */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/50">
        <div className="font-mono text-sm text-stone-700 dark:text-stone-300">{file.path}</div>
      </div>

      {/* Scrollable diff content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-auto">
        {file.hunks.map((hunk, hunkIdx) => {
          const isLastHunk = hunkIdx === file.hunks!.length - 1;

          // Compute gap to next hunk
          let collapsedSection: JSX.Element | null = null;
          if (!isLastHunk) {
            const nextHunk = file.hunks![hunkIdx + 1];
            const currentEnd = hunk.new_start + hunk.new_count;
            const nextStart = nextHunk.new_start;
            const gap = nextStart - currentEnd;

            if (gap > 0) {
              collapsedSection = (
                <CollapsedSection
                  key={`collapsed-${hunkIdx}`}
                  taskId={taskId}
                  filePath={file.path}
                  startLine={currentEnd}
                  endLine={nextStart - 1}
                />
              );
            }
          }

          return (
            <div key={hunkIdx}>
              {hunk.lines.map((line) => (
                <DiffLine
                  key={`${line.old_line_number ?? "new"}-${line.new_line_number ?? "old"}`}
                  line={line}
                />
              ))}
              {collapsedSection}
            </div>
          );
        })}
      </div>
    </div>
  );
}
