//! Forge-themed diff content — all files stacked for continuous scrolling.

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useMemo } from "react";
import { Kbd } from "../../ui/Kbd";
import type { HighlightedFileDiff, HighlightedLine } from "../../../hooks/useDiff";
import type { PrComment } from "../../../types/workflow";
import { ForgeCollapsedSection } from "./ForgeCollapsedSection";
import { ForgeDiffLine } from "./ForgeDiffLine";

interface ForgeDiffContentProps {
  files: HighlightedFileDiff[];
  comments: PrComment[];
  activePath: string | null;
  collapsedPaths: Set<string>;
  onToggleCollapsed: (path: string) => void;
  /** Called with each file section's DOM node so the parent can build a jump map. */
  onFileSectionRef: (path: string, el: HTMLDivElement | null) => void;
}

const COLLAPSE_THRESHOLD = 8;

export function ForgeDiffContent({ files, comments, activePath, collapsedPaths, onToggleCollapsed, onFileSectionRef }: ForgeDiffContentProps) {
  const commentsByFile = useMemo(() => {
    const map = new Map<string, Map<number, PrComment[]>>();
    for (const comment of comments) {
      if (!comment.path || comment.line === null) continue;
      if (!map.has(comment.path)) map.set(comment.path, new Map());
      const byLine = map.get(comment.path)!;
      const existing = byLine.get(comment.line) ?? [];
      existing.push(comment);
      byLine.set(comment.line, existing);
    }
    return map;
  }, [comments]);

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center font-forge-sans text-forge-body text-[var(--text-3)]">
        No changes.
      </div>
    );
  }

  return (
    <div>
      {files.map((file) => (
        <div
          key={file.path}
          ref={(el) => onFileSectionRef(file.path, el)}
          className="border-b border-[var(--border)]"
        >
          <FileSection
            file={file}
            commentsByLine={commentsByFile.get(file.path) ?? new Map()}
            isActive={file.path === activePath}
            isCollapsed={collapsedPaths.has(file.path)}
            onToggleCollapsed={() => onToggleCollapsed(file.path)}
          />
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// FileSection — one file's header + hunks
// ============================================================================

function FileSection({
  file,
  commentsByLine,
  isActive,
  isCollapsed,
  onToggleCollapsed,
}: {
  file: HighlightedFileDiff;
  commentsByLine: Map<number, PrComment[]>;
  isActive: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  if (file.is_binary) {
    return (
      <div className="p-4">
        <div className="font-forge-sans text-forge-body font-medium text-[var(--text-1)] mb-1">{file.path}</div>
        <div className="font-forge-sans text-forge-body text-[var(--text-2)]">Binary file</div>
      </div>
    );
  }

  return (
    <>
      {/* File path header — clickable to collapse/expand. sticky top-0 keeps it pinned. */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="sticky top-0 z-10 w-full text-left bg-[var(--surface-2)] border-b border-[var(--border)] px-4 py-2 font-forge-sans text-forge-body font-medium text-[var(--text-1)] flex items-center gap-2 hover:bg-[var(--surface-3)] transition-colors"
      >
        <span className="flex-1 truncate">
          {file.path}
          {file.old_path && (
            <span className="text-[var(--text-3)] ml-2">(renamed from {file.old_path})</span>
          )}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {isActive && <Kbd>C</Kbd>}
          {isCollapsed
            ? <ChevronRight size={13} className="text-[var(--text-3)]" />
            : <ChevronDown size={13} className="text-[var(--text-3)]" />
          }
        </span>
      </button>

      {!isCollapsed && file.hunks.map((hunk) => (
        <div
          key={`${hunk.old_start}-${hunk.new_start}`}
          className="border-b border-[var(--border)] last:border-b-0"
        >
          <div className="bg-[var(--canvas)] px-4 py-1 font-forge-mono text-forge-mono-label text-[var(--text-3)]">
            @@ -{hunk.old_start},{hunk.old_count} +{hunk.new_start},{hunk.new_count} @@
          </div>
          {renderHunkLines(hunk.lines, commentsByLine)}
        </div>
      ))}
    </>
  );
}

function renderHunkLines(lines: HighlightedLine[], commentsByLine: Map<number, PrComment[]>) {
  const sections: { type: "render" | "collapse"; lines: HighlightedLine[] }[] = [];
  let currentContext: HighlightedLine[] = [];

  for (const line of lines) {
    if (line.line_type === "context") {
      currentContext.push(line);
    } else {
      if (currentContext.length > 0) {
        if (currentContext.length > COLLAPSE_THRESHOLD) {
          sections.push({ type: "render", lines: currentContext.slice(0, 3) });
          sections.push({ type: "collapse", lines: currentContext.slice(3, -3) });
          sections.push({ type: "render", lines: currentContext.slice(-3) });
        } else {
          sections.push({ type: "render", lines: currentContext });
        }
        currentContext = [];
      }
      sections.push({ type: "render", lines: [line] });
    }
  }

  if (currentContext.length > 0) {
    if (currentContext.length > COLLAPSE_THRESHOLD) {
      sections.push({ type: "render", lines: currentContext.slice(0, 3) });
      sections.push({ type: "collapse", lines: currentContext.slice(3, -3) });
      sections.push({ type: "render", lines: currentContext.slice(-3) });
    } else {
      sections.push({ type: "render", lines: currentContext });
    }
  }

  return sections.map((section, i) =>
    section.type === "collapse" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: section order is stable within hunk
      <ForgeCollapsedSection key={i} lines={section.lines} />
    ) : (
      section.lines.map((line, j) => {
        const lineComments =
          line.new_line_number !== null ? commentsByLine.get(line.new_line_number) : undefined;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: line order is stable within section
          <Fragment key={`${i}-${j}`}>
            <ForgeDiffLine line={line} />
            {lineComments && lineComments.length > 0 && (
              <div className="px-4 py-2 font-forge-sans text-forge-body bg-[var(--surface-2)] border-b border-[var(--border)]">
                {lineComments.map((c) => (
                  <div key={c.id} className="text-[var(--text-2)]">{c.author}: {c.body}</div>
                ))}
              </div>
            )}
          </Fragment>
        );
      })
    ),
  );
}
