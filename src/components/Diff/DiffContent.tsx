//! Diff content — all files stacked for continuous scrolling with file-level virtualization.
//!
//! Uses Virtua's Virtualizer for auto-measured variable-height items. No height estimation
//! is needed — Virtua measures each file section after render via ResizeObserver, so wrapped
//! lines, collapsed files, and draft comments all resolve to the correct height automatically.

import { GitCompare } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Virtualizer, type VirtualizerHandle } from "virtua";
import type { HighlightedFileDiff } from "../../hooks/useDiff";
import type { PrComment } from "../../types/workflow";
import { EmptyState } from "../ui/EmptyState";
import { FileHeaderContent } from "./FileHeaderContent";
import { FileSection } from "./FileSection";
import type { DraftComment } from "./types";
import { FILE_HEADER_BUTTON_BASE } from "./types";
import type { DiffMatch } from "./useDiffSearch";

export interface DiffContentHandle {
  scrollToFile(path: string): void;
}

interface DiffContentProps {
  files: HighlightedFileDiff[];
  comments: PrComment[];
  activePath: string | null;
  collapsedPaths: Set<string>;
  /** The parent's overflow-scroll container. Used for scroll event tracking. */
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
  activeCommentLine?: {
    filePath: string;
    lineNumber: number;
    lineType: "add" | "delete" | "context";
  } | null;
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
  // -- Search props (all optional) --
  matches?: DiffMatch[];
  currentMatch?: DiffMatch | null;
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
    matches,
    currentMatch,
  },
  ref,
) {
  const isScrollingRef = useRef(false);
  const virtualizerRef = useRef<VirtualizerHandle>(null);

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
    if (!draftComments) return new Map<string, Map<string, DraftComment[]>>();
    const map = new Map<string, Map<string, DraftComment[]>>();
    for (const draft of draftComments) {
      if (!map.has(draft.filePath)) map.set(draft.filePath, new Map());
      const byLine = map.get(draft.filePath);
      if (!byLine) continue;
      const key = `${draft.lineType}:${draft.lineNumber}`;
      const existing = byLine.get(key) ?? [];
      existing.push(draft);
      byLine.set(key, existing);
    }
    return map;
  }, [draftComments]);

  // Track the topmost visible file by listening to scroll events on the container.
  // Since VirtualizerHandle has no findStartIndex, we compute it: find the last file
  // whose getItemOffset is <= current scrollOffset.
  useEffect(() => {
    const el = scrollElement;
    if (!el) return;
    const onScroll = () => {
      if (isScrollingRef.current) return;
      const handle = virtualizerRef.current;
      if (!handle || files.length === 0) return;
      const offset = handle.scrollOffset;
      let idx = 0;
      for (let i = files.length - 1; i >= 0; i--) {
        if (handle.getItemOffset(i) <= offset) {
          idx = i;
          break;
        }
      }
      onActivePathChange(files[idx]?.path ?? null);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollElement, files, onActivePathChange]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToFile(path: string) {
        const index = files.findIndex((f) => f.path === path);
        if (index >= 0) {
          isScrollingRef.current = true;
          virtualizerRef.current?.scrollToIndex(index, { align: "start", smooth: true });
          setTimeout(() => {
            isScrollingRef.current = false;
          }, 500);
        }
      },
    }),
    [files],
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
      <Virtualizer ref={virtualizerRef}>
        {files.map((file, index) => {
          const isMatchFile = currentMatch?.fileIndex === index;
          const fileMatches = (matches ?? []).filter((m) => m.fileIndex === index);
          return (
            <div key={file.path} className="border-b border-border">
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
                fileMatches={fileMatches}
                currentMatch={isMatchFile ? (currentMatch ?? null) : null}
              />
            </div>
          );
        })}
      </Virtualizer>
    </>
  );
});
