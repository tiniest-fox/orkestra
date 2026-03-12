//! Git history drawer — commit log for the current branch with inline diff view.
//!
//! Mounted/unmounted by the parent (FeedView). The Drawer is always open while
//! this component exists; data comes from GitHistoryProvider which polls independently.

import { ChevronDown, ChevronRight, GitCompare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCommitDiff } from "../../hooks/useCommitDiff";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { useGitHistory } from "../../providers/GitHistoryProvider";
import { FORGE_SYNTAX_OVERRIDES } from "../../styles/syntaxHighlighting";
import type { CommitInfo } from "../../types/workflow";
import { relativeTime } from "../../utils/relativeTime";
import type { DiffContentHandle } from "../Diff/DiffContent";
import { DiffContent } from "../Diff/DiffContent";
import { DiffFileList } from "../Diff/DiffFileList";
import { DiffFindBar } from "../Diff/DiffFindBar";
import { DiffSkeleton } from "../Diff/DiffSkeleton";
import { MobileDiffFileListOverlay } from "../Diff/MobileDiffFileListOverlay";
import { useAutoCollapsePaths } from "../Diff/useAutoCollapsePaths";
import { useDiffFindNavigation } from "../Diff/useDiffFindNavigation";
import { useDiffSearch } from "../Diff/useDiffSearch";
import { Drawer } from "../ui/Drawer/Drawer";
import { DrawerHeader } from "../ui/Drawer/DrawerHeader";
import { EmptyState } from "../ui/EmptyState";
import { HotkeyScope, useNavHandler } from "../ui/HotkeyScope";

// ============================================================================
// CommitRow
// ============================================================================

interface CommitRowProps {
  commit: CommitInfo;
  fileCount: number | undefined;
  selected: boolean;
  onClick: () => void;
}

function CommitRow({ commit, fileCount, selected, onClick }: CommitRowProps) {
  return (
    <button
      type="button"
      data-hash={commit.hash}
      onClick={onClick}
      className={[
        "w-full text-left px-3 py-2.5 border-b border-border transition-colors",
        selected ? "bg-accent-soft border-l-2 border-l-accent !pl-[10px]" : "hover:bg-canvas",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5 mb-[3px]">
        <span className="font-mono text-[10px] text-text-quaternary bg-canvas px-[5px] py-[1px] rounded leading-tight shrink-0">
          {commit.hash}
        </span>
      </div>
      <div className="font-sans text-[12px] text-text-primary leading-snug line-clamp-2 mb-[3px]">
        {commit.message}
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[10px] text-text-quaternary">
        <span className="truncate max-w-[80px]">{commit.author.split(" ")[0]}</span>
        <span>·</span>
        <span className="shrink-0">{relativeTime(commit.timestamp)}</span>
        {fileCount != null && (
          <>
            <span>·</span>
            <span className="shrink-0">{fileCount}f</span>
          </>
        )}
      </div>
    </button>
  );
}

// ============================================================================
// GitHistoryDrawer
// ============================================================================

interface GitHistoryDrawerProps {
  onClose: () => void;
}

// Inner component — rendered inside HotkeyScope so useNavHandler is available.
function GitHistoryDrawerContent({ onClose }: GitHistoryDrawerProps) {
  const { commits, fileCounts, currentBranch } = useGitHistory();
  const { css } = useSyntaxCss();
  const isMobile = useIsMobile();

  // Start with no selection so the initial mount is cheap (no diff rendering).
  // The commit list renders instantly; diff loads only after explicit selection.
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [bodyExpanded, setBodyExpanded] = useState(true);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [fileListOpen, setFileListOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const diffContentRef = useRef<DiffContentHandle>(null);
  const [diffScrollEl, setDiffScrollEl] = useState<HTMLDivElement | null>(null);
  const setDiffScrollRef = useCallback((el: HTMLDivElement | null) => {
    setDiffScrollEl(el);
  }, []);

  const { diff, loading: diffLoading } = useCommitDiff(selectedHash);

  const { collapsedPaths, toggleCollapsed, resetInteraction, expandForSearch } =
    useAutoCollapsePaths(diff?.files);

  const search = useDiffSearch(diff?.files ?? []);

  const { findBarOpen, closeFindBar } = useDiffFindNavigation({
    search,
    files: diff?.files ?? [],
    collapsedPaths,
    expandForSearch,
    diffContentRef,
    scrollEl: diffScrollEl,
  });

  // Reset per-commit state when selection changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedHash is the intentional trigger; setters are stable
  useEffect(() => {
    setActivePath(null);
    setBodyExpanded(true);
    closeFindBar();
    resetInteraction();
  }, [selectedHash]);

  // Auto-select first file when diff loads.
  useEffect(() => {
    if (diff && diff.files.length > 0 && activePath === null) {
      setActivePath(diff.files[0].path);
    }
  }, [diff, activePath]);

  // Scroll selected commit into view in the list.
  useEffect(() => {
    if (!selectedHash || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-hash="${selectedHash}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedHash]);

  // j/k keyboard navigation for the commit list — via HotkeyScope (mobile-suppressed automatically).
  useNavHandler("j", () => {
    setSelectedHash((prev) => {
      const idx = prev ? commits.findIndex((c) => c.hash === prev) : -1;
      return commits[idx + 1]?.hash ?? prev;
    });
  });
  useNavHandler("ArrowDown", () => {
    setSelectedHash((prev) => {
      const idx = prev ? commits.findIndex((c) => c.hash === prev) : -1;
      return commits[idx + 1]?.hash ?? prev;
    });
  });
  useNavHandler("k", () => {
    setSelectedHash((prev) => {
      const idx = prev ? commits.findIndex((c) => c.hash === prev) : commits.length;
      return commits[idx - 1]?.hash ?? prev;
    });
  });
  useNavHandler("ArrowUp", () => {
    setSelectedHash((prev) => {
      const idx = prev ? commits.findIndex((c) => c.hash === prev) : commits.length;
      return commits[idx - 1]?.hash ?? prev;
    });
  });
  function handleToggleCollapsed(path: string) {
    toggleCollapsed(path);
    requestAnimationFrame(() => {
      diffContentRef.current?.scrollToFile(path);
    });
  }

  function handleJumpTo(path: string) {
    setActivePath(path);
    diffContentRef.current?.scrollToFile(path);
  }

  const selectedCommit = selectedHash
    ? (commits.find((c) => c.hash === selectedHash) ?? null)
    : null;

  return (
    <>
      {css && (
        <style
          // biome-ignore lint/security/noDangerouslySetInnerHtml: syntect CSS output is trusted
          dangerouslySetInnerHTML={{ __html: css.light + FORGE_SYNTAX_OVERRIDES }}
        />
      )}
      <div className="flex flex-col h-full">
        <DrawerHeader
          title={
            <span className="flex items-center gap-2.5">
              Git History
              {currentBranch && (
                <span className="font-mono text-[11px] font-normal text-accent shrink-0">
                  {currentBranch}
                </span>
              )}
            </span>
          }
          onClose={onClose}
        />

        {/* Body: commit list (left) + commit detail (right) */}
        <div className="flex flex-1 overflow-hidden">
          {/* Commit list */}
          <div ref={listRef} className="w-60 shrink-0 overflow-y-auto border-r border-border">
            {commits.map((commit) => (
              <CommitRow
                key={commit.hash}
                commit={commit}
                fileCount={fileCounts.get(commit.hash)}
                selected={commit.hash === selectedHash}
                onClick={() => setSelectedHash(commit.hash)}
              />
            ))}
            {commits.length === 0 && (
              <div className="p-4 font-mono text-[10px] text-text-quaternary">No commits.</div>
            )}
          </div>

          {/* Commit detail */}
          {selectedCommit ? (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Commit info */}
              <div className="shrink-0 px-6 py-4 border-b border-border">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-[10px] text-text-quaternary bg-canvas px-[5px] py-[1px] rounded leading-tight">
                    {selectedCommit.hash}
                  </span>
                </div>
                <div className="font-sans text-[14px] font-semibold tracking-[-0.01em] text-text-primary leading-snug mb-2">
                  {selectedCommit.message}
                </div>
                {selectedCommit.body && (
                  <div className="mb-2">
                    <button
                      type="button"
                      onClick={() => setBodyExpanded((e) => !e)}
                      className="flex items-center gap-[3px] font-mono text-[10px] text-text-quaternary hover:text-text-secondary transition-colors mb-1"
                    >
                      {bodyExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      {bodyExpanded ? "hide description" : "show description"}
                    </button>
                    {bodyExpanded && (
                      <pre className="font-mono text-[11px] text-text-tertiary leading-relaxed whitespace-pre-wrap">
                        {selectedCommit.body}
                      </pre>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-3 font-mono text-[10px] text-text-quaternary">
                  <span>{selectedCommit.author}</span>
                  <span>·</span>
                  <span>{relativeTime(selectedCommit.timestamp)}</span>
                  {fileCounts.get(selectedCommit.hash) != null && (
                    <>
                      <span>·</span>
                      <span>{fileCounts.get(selectedCommit.hash)} files changed</span>
                    </>
                  )}
                </div>
              </div>

              {/* Diff viewer */}
              <div className="flex flex-col flex-1 overflow-hidden relative">
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
                        <div className="w-48 shrink-0 overflow-y-auto border-r border-border">
                          <DiffFileList
                            files={diff.files}
                            activePath={activePath}
                            onJumpTo={handleJumpTo}
                          />
                        </div>
                      )}
                      <div ref={setDiffScrollRef} className="flex-1 overflow-y-auto relative">
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
                          scrollElement={diffScrollEl}
                          onActivePathChange={setActivePath}
                          onToggleCollapsed={handleToggleCollapsed}
                          matches={search.matches}
                          currentMatch={search.currentMatch}
                        />
                      </div>
                    </div>
                  </>
                ) : diff ? (
                  <div className="flex-1 flex items-center justify-center">
                    <EmptyState icon={GitCompare} message="No changes." />
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center font-mono text-[11px] text-text-quaternary">
              Select a commit to view details.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function GitHistoryDrawer({ onClose }: GitHistoryDrawerProps) {
  return (
    <Drawer onClose={onClose}>
      <HotkeyScope active>
        <GitHistoryDrawerContent onClose={onClose} />
      </HotkeyScope>
    </Drawer>
  );
}
