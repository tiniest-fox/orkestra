//! Self-contained diff tab — file list sidebar + syntax-highlighted content pane.
//! Handles all scroll tracking, file jumping, and collapse state internally.
//! Registers c / ] / [ / j·k hotkeys when active.

import { GitCompare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HighlightedTaskDiff } from "../../hooks/useDiff";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { FORGE_SYNTAX_OVERRIDES } from "../../styles/syntaxHighlighting";
import type { DiffContentHandle } from "../Diff/DiffContent";
import { DiffContent } from "../Diff/DiffContent";
import { DiffFileList } from "../Diff/DiffFileList";
import { DiffFindBar } from "../Diff/DiffFindBar";
import { DiffSkeleton } from "../Diff/DiffSkeleton";
import { MobileDiffFileListOverlay } from "../Diff/MobileDiffFileListOverlay";
import type { DraftComment } from "../Diff/types";
import { useAutoCollapsePaths } from "../Diff/useAutoCollapsePaths";
import { useDiffFindNavigation } from "../Diff/useDiffFindNavigation";
import { useDiffSearch } from "../Diff/useDiffSearch";
import { EmptyState } from "../ui/EmptyState";
import { useNavHandler } from "../ui/HotkeyScope";
import { useDrawerDiff } from "./DrawerTaskProvider";

interface DrawerDiffTabProps {
  /** Whether this tab is currently visible — controls data loading and hotkey registration. */
  active: boolean;
  draftComments?: DraftComment[];
  onAddDraftComment?: (
    filePath: string,
    lineNumber: number,
    lineType: "add" | "delete" | "context",
    body: string,
  ) => void;
  onRemoveDraftComment?: (id: string) => void;
}

export function DrawerDiffTab({
  active,
  draftComments,
  onAddDraftComment,
  onRemoveDraftComment,
}: DrawerDiffTabProps) {
  const { diff: liveDiff, diffLoading } = useDrawerDiff();
  const { css } = useSyntaxCss();
  const isMobile = useIsMobile();
  const [activePath, setActivePath] = useState<string | null>(null);
  const [fileListOpen, setFileListOpen] = useState(false);
  const diffContentRef = useRef<DiffContentHandle>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    setScrollEl(el);
  }, []);

  // -- Active comment line (local state) --
  const [activeCommentLine, setActiveCommentLine] = useState<{
    filePath: string;
    lineNumber: number;
  } | null>(null);
  const [draftBody, setDraftBody] = useState("");

  // -- Frozen diff: snapshot the diff when drafts exist so line numbers stay stable --
  const hasDrafts = (draftComments?.length ?? 0) > 0;
  const diffSnapshotRef = useRef<HighlightedTaskDiff | null>(null);

  // Update snapshot only when there are no drafts. Must be a useEffect — mutating a ref
  // during render is unsafe in concurrent mode (discarded renders leave the mutation behind).
  useEffect(() => {
    if (!hasDrafts) {
      diffSnapshotRef.current = liveDiff;
    }
  }, [hasDrafts, liveDiff]);

  const diff = hasDrafts ? diffSnapshotRef.current : liveDiff;

  const { collapsedPaths, toggleCollapsed, expandForSearch } = useAutoCollapsePaths(diff?.files);

  const search = useDiffSearch(diff?.files ?? []);

  const { findBarOpen, closeFindBar } = useDiffFindNavigation({
    search,
    files: diff?.files ?? [],
    collapsedPaths,
    expandForSearch,
    diffContentRef,
    scrollEl,
    active,
  });

  // Pre-select the first file when the diff loads.
  useEffect(() => {
    if (diff && diff.files.length > 0 && activePath === null) {
      setActivePath(diff.files[0].path);
    }
  }, [diff, activePath]);

  function handleToggleCollapsed(path: string) {
    toggleCollapsed(path);
    // Anchor scroll at the toggled file to prevent viewport jump.
    requestAnimationFrame(() => {
      diffContentRef.current?.scrollToFile(path);
    });
  }

  function handleJumpTo(path: string) {
    setActivePath(path);
    diffContentRef.current?.scrollToFile(path);
  }

  // -- Draft comment handlers --
  function handleLineClick(
    filePath: string,
    lineNumber: number,
    _lineType: "add" | "delete" | "context",
  ) {
    setActiveCommentLine({ filePath, lineNumber });
    setDraftBody("");
  }

  function handleSaveDraft(
    filePath: string,
    lineNumber: number,
    lineType: "add" | "delete" | "context",
    body: string,
  ) {
    onAddDraftComment?.(filePath, lineNumber, lineType, body);
    setActiveCommentLine(null);
    setDraftBody("");
  }

  function handleDismissCommentInput() {
    setActiveCommentLine(null);
    setDraftBody("");
  }

  // Keyboard navigation — only meaningful when this tab is active.
  useNavHandler("ArrowDown", () => {
    if (active) scrollEl?.scrollBy({ top: 120, behavior: "smooth" });
  });
  useNavHandler("j", () => {
    if (active) scrollEl?.scrollBy({ top: 120, behavior: "smooth" });
  });
  useNavHandler("ArrowUp", () => {
    if (active) scrollEl?.scrollBy({ top: -120, behavior: "smooth" });
  });
  useNavHandler("k", () => {
    if (active) scrollEl?.scrollBy({ top: -120, behavior: "smooth" });
  });
  useNavHandler("c", () => {
    if (active && activePath) handleToggleCollapsed(activePath);
  });
  useNavHandler("]", () => {
    if (!active || !diff) return;
    const paths = diff.files.map((f) => f.path);
    const next = paths[(activePath ? paths.indexOf(activePath) : -1) + 1];
    if (next) handleJumpTo(next);
  });
  useNavHandler("[", () => {
    if (!active || !diff) return;
    const paths = diff.files.map((f) => f.path);
    const prev = paths[(activePath ? paths.indexOf(activePath) : paths.length) - 1];
    if (prev) handleJumpTo(prev);
  });
  const isCommentingEnabled = !!onAddDraftComment;

  return (
    <div className="flex flex-col flex-1 overflow-hidden relative">
      {css && (
        <style
          // biome-ignore lint/security/noDangerouslySetInnerHtml: syntect CSS output is trusted
          dangerouslySetInnerHTML={{
            __html:
              css.light +
              `@media (prefers-color-scheme: dark) {${css.dark}}` +
              FORGE_SYNTAX_OVERRIDES,
          }}
        />
      )}
      {diffLoading && !diff ? (
        <div className="flex-1 overflow-auto p-4">
          <DiffSkeleton />
        </div>
      ) : diff && diff.files.length > 0 ? (
        <>
          <MobileDiffFileListOverlay
            files={diff.files}
            activePath={activePath}
            onJumpTo={handleJumpTo}
            fileListOpen={fileListOpen}
            onToggle={() => setFileListOpen((o) => !o)}
          />
          <div className="flex flex-1 overflow-hidden">
            {!isMobile && (
              <div className="w-56 shrink-0 overflow-y-auto border-r border-border">
                <DiffFileList files={diff.files} activePath={activePath} onJumpTo={handleJumpTo} />
              </div>
            )}
            <div ref={setScrollRef} className="flex-1 overflow-y-auto relative bg-surface">
              {findBarOpen && (
                <DiffFindBar
                  query={search.query}
                  onQueryChange={search.setQuery}
                  currentIndex={search.currentIndex}
                  count={search.count}
                  onNext={search.next}
                  onPrev={search.prev}
                  onClose={closeFindBar}
                />
              )}
              <DiffContent
                ref={diffContentRef}
                files={diff.files}
                comments={[]}
                activePath={activePath}
                collapsedPaths={collapsedPaths}
                scrollElement={scrollEl}
                onActivePathChange={setActivePath}
                onToggleCollapsed={handleToggleCollapsed}
                onLineClick={isCommentingEnabled ? handleLineClick : undefined}
                draftComments={draftComments}
                activeCommentLine={activeCommentLine}
                onSaveDraft={isCommentingEnabled ? handleSaveDraft : undefined}
                onCancelDraft={isCommentingEnabled ? handleDismissCommentInput : undefined}
                onDeleteDraft={onRemoveDraftComment}
                draftBody={draftBody}
                onDraftBodyChange={setDraftBody}
                matches={search.matches}
                currentMatch={search.currentMatch}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon={GitCompare} message="No changes." />
        </div>
      )}
    </div>
  );
}
