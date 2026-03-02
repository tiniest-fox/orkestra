//! Diff content — all files stacked for continuous scrolling with file-level virtualization.

import { useVirtualizer } from "@tanstack/react-virtual";
import { GitCompare } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { HighlightedFileDiff } from "../../hooks/useDiff";
import type { PrComment } from "../../types/workflow";
import { EmptyState } from "../ui/EmptyState";
import { FileHeaderContent } from "./FileHeaderContent";
import { FileSection } from "./FileSection";
import type { DraftComment } from "./types";
import { FILE_HEADER_BUTTON_BASE } from "./types";

const HEADER_HEIGHT = 36;

export interface DiffContentHandle {
  scrollToFile(path: string): void;
}

interface DiffContentProps {
  files: HighlightedFileDiff[];
  comments: PrComment[];
  activePath: string | null;
  collapsedPaths: Set<string>;
  /** The parent's overflow-scroll container. DiffContent does NOT render its own overflow wrapper. */
  scrollElement: HTMLElement | null;
  onToggleCollapsed: (path: string) => void;
  /** Called when the topmost visible file changes. */
  onActivePathChange: (path: string | null) => void;
  // -- Draft comment props (all optional) --
  onLineClick?: (
    filePath: string,
    lineNumber: number,
    lineType: "add" | "delete" | "context",
  ) => void;
  draftComments?: DraftComment[];
  activeCommentLine?: { filePath: string; lineNumber: number } | null;
  onSaveDraft?: (
    filePath: string,
    lineNumber: number,
    lineType: "add" | "delete" | "context",
    body: string,
  ) => void;
  onCancelDraft?: () => void;
  onDeleteDraft?: (id: string) => void;
  draftBody?: string;
  onDraftBodyChange?: (body: string) => void;
}

function estimateFileHeight(file: HighlightedFileDiff, collapsed: Set<string>): number {
  const HUNK_HEADER_HEIGHT = 28;
  const LINE_HEIGHT = 20;

  if (collapsed.has(file.path)) return HEADER_HEIGHT;
  if (file.is_binary) return 72;

  const totalLines = file.hunks.reduce((sum, h) => sum + h.lines.length, 0);
  return HEADER_HEIGHT + totalLines * LINE_HEIGHT + file.hunks.length * HUNK_HEADER_HEIGHT;
}

export const DiffContent = forwardRef<DiffContentHandle, DiffContentProps>(function DiffContent(
  {
    files,
    comments,
    activePath,
    collapsedPaths,
    scrollElement,
    onToggleCollapsed,
    onActivePathChange,
    onLineClick,
    draftComments,
    activeCommentLine,
    onSaveDraft,
    onCancelDraft,
    onDeleteDraft,
    draftBody,
    onDraftBodyChange,
  },
  ref,
) {
  const isScrollingRef = useRef(false);

  const commentsByFile = useMemo(() => {
    const map = new Map<string, Map<number, PrComment[]>>();
    for (const comment of comments) {
      if (!comment.path || comment.line === null) continue;
      if (!map.has(comment.path)) map.set(comment.path, new Map());
      const byLine = map.get(comment.path);
      if (!byLine) continue;
      const existing = byLine.get(comment.line) ?? [];
      existing.push(comment);
      byLine.set(comment.line, existing);
    }
    return map;
  }, [comments]);

  const draftsByFile = useMemo(() => {
    if (!draftComments) return new Map<string, Map<number, DraftComment[]>>();
    const map = new Map<string, Map<number, DraftComment[]>>();
    for (const draft of draftComments) {
      if (!map.has(draft.filePath)) map.set(draft.filePath, new Map());
      const byLine = map.get(draft.filePath);
      if (!byLine) continue;
      const existing = byLine.get(draft.lineNumber) ?? [];
      existing.push(draft);
      byLine.set(draft.lineNumber, existing);
    }
    return map;
  }, [draftComments]);

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => estimateFileHeight(files[index], collapsedPaths),
    overscan: 3,
  });

  // Re-measure when collapsed state changes (sizes changed).
  // biome-ignore lint/correctness/useExhaustiveDependencies: adding virtualizer to the dep array causes an infinite measure loop
  useEffect(() => {
    virtualizer.measure();
  }, [collapsedPaths]);

  const virtualItems = virtualizer.getVirtualItems();

  // Track the topmost visible file as the active path.
  // Suppressed during programmatic scrolls to prevent sidebar flickering.
  // virtualItems[0] may be an overscan item above the viewport, so filter
  // to items whose start position is at or below the current scroll offset.
  useEffect(() => {
    if (isScrollingRef.current) return;
    if (virtualItems.length === 0) return;
    const scrollTop = scrollElement?.scrollTop ?? 0;
    const firstVisible =
      [...virtualItems].reverse().find((item) => item.start <= scrollTop) ?? virtualItems[0];
    const activePth = files[firstVisible.index]?.path ?? null;
    onActivePathChange(activePth);
  }, [virtualItems, files, scrollElement, onActivePathChange]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToFile(path: string) {
        const index = files.findIndex((f) => f.path === path);
        if (index >= 0) {
          isScrollingRef.current = true;
          virtualizer.scrollToIndex(index, { align: "start", behavior: "smooth" });
          setTimeout(() => {
            isScrollingRef.current = false;
          }, 150);
        }
      },
    }),
    [files, virtualizer],
  );

  const activeFile = files.find((f) => f.path === activePath) ?? null;

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState icon={GitCompare} message="No changes." />
      </div>
    );
  }

  return (
    <>
      {activeFile && (
        <button
          type="button"
          onClick={() => onToggleCollapsed(activeFile.path)}
          className={`sticky top-0 z-20 ${FILE_HEADER_BUTTON_BASE}`}
        >
          <FileHeaderContent
            path={activeFile.path}
            oldPath={activeFile.old_path}
            isCollapsed={collapsedPaths.has(activeFile.path)}
            showKbd
          />
        </button>
      )}
      <div
        style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}
      >
        {virtualItems.map((virtualItem) => {
          const file = files[virtualItem.index];
          return (
            <div
              key={file.path}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
              className="border-b border-border"
            >
              <FileSection
                file={file}
                commentsByLine={commentsByFile.get(file.path) ?? new Map()}
                draftsByLine={draftsByFile.get(file.path) ?? new Map()}
                isActive={file.path === activePath}
                isCollapsed={collapsedPaths.has(file.path)}
                onToggleCollapsed={() => onToggleCollapsed(file.path)}
                activeCommentLine={
                  activeCommentLine?.filePath === file.path ? activeCommentLine : null
                }
                onLineClick={onLineClick ? (ln, lt) => onLineClick(file.path, ln, lt) : undefined}
                onSaveDraft={
                  onSaveDraft ? (ln, lt, body) => onSaveDraft(file.path, ln, lt, body) : undefined
                }
                onCancelDraft={onCancelDraft}
                onDeleteDraft={onDeleteDraft}
                draftBody={draftBody}
                onDraftBodyChange={onDraftBodyChange}
              />
            </div>
          );
        })}
      </div>
    </>
  );
});
