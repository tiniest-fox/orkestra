// Self-contained diff tab — file list sidebar + syntax-highlighted content pane.
// Handles all scroll tracking, file jumping, and collapse state internally.
// Registers c / ] / [ / j·k hotkeys when active.

import { GitCommit, GitCompare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCommitDiff } from "../../hooks/useCommitDiff";
import type { HighlightedTaskDiff } from "../../hooks/useDiff";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { FORGE_SYNTAX_OVERRIDES } from "../../styles/syntaxHighlighting";
import { useTransport } from "../../transport";
import { isDisconnectError } from "../../utils/transportErrors";
import type { DiffContentHandle } from "../Diff/DiffContent";
import { DiffContent } from "../Diff/DiffContent";
import { DiffFileList } from "../Diff/DiffFileList";
import { DiffFindBar } from "../Diff/DiffFindBar";
import { DiffSkeleton } from "../Diff/DiffSkeleton";
import { MobileDiffFileListOverlay } from "../Diff/MobileDiffFileListOverlay";
import { MobileSlidePanel } from "../Diff/MobileSlidePanel";
import type { DraftComment } from "../Diff/types";
import { useAutoCollapsePaths } from "../Diff/useAutoCollapsePaths";
import { useDiffFindNavigation } from "../Diff/useDiffFindNavigation";
import { useDiffSearch } from "../Diff/useDiffSearch";
import { EmptyState } from "../ui/EmptyState";
import { useNavHandler } from "../ui/HotkeyScope";
import type { ExpandPosition } from "./applySplice";
import type { DiffMode } from "./DiffCommitPanel";
import { DiffCommitPanel } from "./DiffCommitPanel";
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
  const {
    diff: liveDiff,
    diffLoading,
    fileContextLines,
    expandContext,
    branchCommits: commits,
    hasUncommittedChanges,
    taskId,
  } = useDrawerDiff();
  const transport = useTransport();
  const { css } = useSyntaxCss();
  const isMobile = useIsMobile();
  const [activePath, setActivePath] = useState<string | null>(null);
  const [fileListOpen, setFileListOpen] = useState(false);
  const diffContentRef = useRef<DiffContentHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [diffMode, setDiffMode] = useState<DiffMode>("all");
  const [commitPanelCollapsed, setCommitPanelCollapsed] = useState(true);
  const [commitOverlayOpen, setCommitOverlayOpen] = useState(false);

  const isAllMode = diffMode === "all";
  const isUncommittedMode = diffMode === "uncommitted";
  const isPerCommitMode = !isAllMode && !isUncommittedMode;
  const selectedCommitHash = isPerCommitMode ? diffMode : null;

  // -- Active comment line (local state) --
  const [activeCommentLine, setActiveCommentLine] = useState<{
    filePath: string;
    lineNumber: number;
    lineType: "add" | "delete" | "context";
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

  // -- Uncommitted diff fetching --
  const [uncommittedDiff, setUncommittedDiff] = useState<HighlightedTaskDiff | null>(null);
  const [uncommittedDiffLoading, setUncommittedDiffLoading] = useState(false);

  useEffect(() => {
    if (!isUncommittedMode) {
      setUncommittedDiff(null);
      return;
    }
    let cancelled = false;
    setUncommittedDiffLoading(true);
    transport
      .call<HighlightedTaskDiff>("get_uncommitted_diff", { task_id: taskId })
      .then((result) => {
        if (!cancelled) {
          setUncommittedDiff(result);
          setUncommittedDiffLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled && !isDisconnectError(err)) {
          console.error("Failed to fetch uncommitted diff:", err);
          setUncommittedDiffLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isUncommittedMode, transport, taskId]);

  const { diff: commitDiff, loading: commitDiffLoading } = useCommitDiff(selectedCommitHash);

  // Per-commit mode: use commit diff directly (immutable, no snapshot needed).
  // Uncommitted mode: use the fetched uncommitted diff.
  // All-changes mode: use frozen snapshot if drafts exist (preserves line refs).
  const rawDiff = isPerCommitMode
    ? commitDiff
    : isUncommittedMode
      ? uncommittedDiff
      : hasDrafts
        ? diffSnapshotRef.current
        : liveDiff;
  const activeDiffLoading = isPerCommitMode
    ? commitDiffLoading
    : isUncommittedMode
      ? uncommittedDiffLoading
      : diffLoading;

  // Memoize sorted files so useAutoCollapsePaths doesn't re-run on every render.
  const diff = useMemo(
    () =>
      rawDiff
        ? { ...rawDiff, files: [...rawDiff.files].sort((a, b) => a.path.localeCompare(b.path)) }
        : rawDiff,
    [rawDiff],
  );

  const { collapsedPaths, toggleCollapsed, expandForSearch, resetInteraction } =
    useAutoCollapsePaths(diff?.files);

  const search = useDiffSearch(diff?.files ?? []);

  const { findBarOpen, closeFindBar } = useDiffFindNavigation({
    search,
    files: diff?.files ?? [],
    collapsedPaths,
    expandForSearch,
    diffContentRef,
    scrollEl: scrollRef.current,
    active,
  });

  // Pre-select the first file when the diff loads.
  useEffect(() => {
    if (diff && diff.files.length > 0 && activePath === null) {
      setActivePath(diff.files[0].path);
    }
  }, [diff, activePath]);

  // If selected commit disappears from list (rebase), reset to all-changes.
  useEffect(() => {
    if (isPerCommitMode && commits.length > 0 && !commits.some((c) => c.hash === diffMode)) {
      setDiffMode("all");
    }
  }, [diffMode, isPerCommitMode, commits]);

  // If uncommitted changes disappear while viewing, reset to all-changes.
  useEffect(() => {
    if (isUncommittedMode && !hasUncommittedChanges) {
      setDiffMode("all");
    }
  }, [isUncommittedMode, hasUncommittedChanges]);

  // Reset per-commit state when selection changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: diffMode is the intentional trigger; closeFindBar and resetInteraction are stable useCallback references that never change identity
  useEffect(() => {
    setActivePath(null);
    setActiveCommentLine(null);
    setDraftBody("");
    setCommitOverlayOpen(false);
    closeFindBar();
    resetInteraction();
  }, [diffMode]);

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
    lineType: "add" | "delete" | "context",
  ) {
    setActiveCommentLine({ filePath, lineNumber, lineType });
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

  function handleExpandContext(
    filePath: string,
    hunkIndex: number,
    position: ExpandPosition,
    amount: number,
  ) {
    void expandContext(filePath, hunkIndex, position, amount);
  }

  // Keyboard navigation — only meaningful when this tab is active.
  useNavHandler("ArrowDown", () => {
    if (active) scrollRef.current?.scrollBy({ top: 120, behavior: "smooth" });
  });
  useNavHandler("j", () => {
    if (active) scrollRef.current?.scrollBy({ top: 120, behavior: "smooth" });
  });
  useNavHandler("ArrowUp", () => {
    if (active) scrollRef.current?.scrollBy({ top: -120, behavior: "smooth" });
  });
  useNavHandler("k", () => {
    if (active) scrollRef.current?.scrollBy({ top: -120, behavior: "smooth" });
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
  // Only per-commit diffs are immutable; all-changes and uncommitted allow draft comments.
  const isImmutableMode = isPerCommitMode;
  // Context expansion only makes sense for all-changes mode (has base-branch context).
  const supportsContextExpansion = isAllMode;

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
      {activeDiffLoading && !diff ? (
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
            extraControls={
              isMobile ? (
                <button
                  type="button"
                  onClick={() => setCommitOverlayOpen((o) => !o)}
                  onKeyDown={() => {}}
                  aria-label={`${commits.length} commits`}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-panel-sm text-text-tertiary hover:text-text-primary hover:bg-canvas transition-colors"
                >
                  <GitCommit size={14} />
                  <span className="font-mono text-forge-mono-label px-1 py-0.5 rounded bg-canvas text-text-secondary font-semibold">
                    {commits.length}
                  </span>
                </button>
              ) : undefined
            }
          />
          {/* Mobile commit overlay */}
          {isMobile && (
            <MobileSlidePanel
              open={commitOverlayOpen}
              onClose={() => setCommitOverlayOpen(false)}
              ariaLabel="Close commit list"
            >
              <DiffCommitPanel
                commits={commits}
                diffMode={diffMode}
                onSelectHash={(hash) => {
                  setDiffMode(hash);
                  setCommitOverlayOpen(false);
                }}
                onSelectAll={() => {
                  setDiffMode("all");
                  setCommitOverlayOpen(false);
                }}
                onSelectUncommitted={() => {
                  setDiffMode("uncommitted");
                  setCommitOverlayOpen(false);
                }}
                hasUncommittedChanges={hasUncommittedChanges}
              />
            </MobileSlidePanel>
          )}
          {/* Desktop commit panel */}
          {!isMobile && (
            <DiffCommitPanel
              commits={commits}
              diffMode={diffMode}
              onSelectHash={(hash) => setDiffMode(hash)}
              onSelectAll={() => setDiffMode("all")}
              onSelectUncommitted={() => setDiffMode("uncommitted")}
              hasUncommittedChanges={hasUncommittedChanges}
              collapsed={commitPanelCollapsed}
              onToggleCollapsed={() => setCommitPanelCollapsed((c) => !c)}
            />
          )}
          <div className="flex flex-1 overflow-hidden">
            {!isMobile && (
              <div className="w-56 shrink-0 overflow-y-auto border-r border-border">
                <DiffFileList files={diff.files} activePath={activePath} onJumpTo={handleJumpTo} />
              </div>
            )}
            <div ref={scrollRef} className="flex-1 overflow-y-auto relative bg-surface">
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
                scrollRef={scrollRef}
                onActivePathChange={setActivePath}
                onToggleCollapsed={handleToggleCollapsed}
                onLineClick={isCommentingEnabled && !isImmutableMode ? handleLineClick : undefined}
                draftComments={isImmutableMode ? undefined : draftComments}
                activeCommentLine={isImmutableMode ? null : activeCommentLine}
                onSaveDraft={isCommentingEnabled && !isImmutableMode ? handleSaveDraft : undefined}
                onCancelDraft={
                  isCommentingEnabled && !isImmutableMode ? handleDismissCommentInput : undefined
                }
                onDeleteDraft={isImmutableMode ? undefined : onRemoveDraftComment}
                draftBody={draftBody}
                onDraftBodyChange={setDraftBody}
                matches={search.matches}
                currentMatch={search.currentMatch}
                onExpandContext={supportsContextExpansion ? handleExpandContext : undefined}
                fileContextLines={supportsContextExpansion ? fileContextLines : new Map()}
              />
            </div>
          </div>
        </>
      ) : isUncommittedMode ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon={GitCompare} message="No uncommitted changes found." />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon={GitCompare} message="No changes." />
        </div>
      )}
    </div>
  );
}
