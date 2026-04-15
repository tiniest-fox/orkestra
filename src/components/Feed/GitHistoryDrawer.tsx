// Git history drawer — commit log for the current branch with inline diff view.
//
// Desktop: side-by-side commit list (left 240px) + diff detail (right).
// Mobile: full-width commit list; clicking a commit slides in a detail overlay.

import { ChevronDown, ChevronRight, Download, GitCompare, RefreshCw, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCommitDiff } from "../../hooks/useCommitDiff";
import type { HighlightedTaskDiff } from "../../hooks/useDiff";
import { useIsMobile } from "../../hooks/useIsMobile";
import { stalenessClass } from "../../hooks/useStalenessTimer";
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
import type { UseDiffSearchResult } from "../Diff/useDiffSearch";
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
  isMobile: boolean;
  onClick: () => void;
}

function CommitRow({ commit, fileCount, selected, isMobile, onClick }: CommitRowProps) {
  return (
    <button
      type="button"
      data-hash={commit.hash}
      onClick={onClick}
      className={[
        "w-full text-left px-3 py-2.5 border-b border-border transition-colors focus:outline-none",
        !isMobile && selected
          ? "bg-accent-soft border-l-2 border-l-accent !pl-[10px]"
          : "hover:bg-canvas",
      ].join(" ")}
    >
      <div className="flex items-baseline gap-1.5 mb-[3px]">
        <span className="font-mono text-[10px] text-text-quaternary bg-canvas px-[5px] py-[1px] rounded leading-tight shrink-0">
          {commit.hash}
        </span>
        <span className="font-sans text-[12px] text-text-primary leading-snug line-clamp-2">
          {commit.message}
        </span>
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
// CommitDetailPanel — shared between desktop inline and mobile overlay
// ============================================================================

interface CommitDetailPanelProps {
  commit: CommitInfo;
  fileCount: number | undefined;
  diff: HighlightedTaskDiff | null;
  diffLoading: boolean;
  activePath: string | null;
  collapsedPaths: Set<string>;
  bodyExpanded: boolean;
  fileListOpen: boolean;
  findBarOpen: boolean;
  search: UseDiffSearchResult;
  diffContentRef: React.RefObject<DiffContentHandle>;
  diffScrollRef: React.RefObject<HTMLDivElement>;
  onActivePathChange: (path: string | null) => void;
  onToggleCollapsed: (path: string) => void;
  onJumpTo: (path: string) => void;
  onToggleBody: () => void;
  onToggleFileList: () => void;
  closeFindBar: () => void;
  isMobile: boolean;
}

function CommitDetailPanel({
  commit,
  fileCount,
  diff,
  diffLoading,
  activePath,
  collapsedPaths,
  bodyExpanded,
  fileListOpen,
  findBarOpen,
  search,
  diffContentRef,
  diffScrollRef,
  onActivePathChange,
  onToggleCollapsed,
  onJumpTo,
  onToggleBody,
  onToggleFileList,
  closeFindBar,
  isMobile,
}: CommitDetailPanelProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Commit info */}
      <div className="shrink-0 px-6 py-4 border-b border-border">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="font-mono text-[10px] text-text-quaternary bg-canvas px-[5px] py-[1px] rounded leading-tight shrink-0">
            {commit.hash}
          </span>
          <div className="font-sans text-[14px] font-semibold tracking-[-0.01em] text-text-primary leading-snug">
            {commit.message}
          </div>
        </div>
        {commit.body && (
          <div className="mb-2">
            <button
              type="button"
              onClick={onToggleBody}
              className="flex items-center gap-[3px] font-mono text-[10px] text-text-quaternary hover:text-text-secondary transition-colors mb-1"
            >
              {bodyExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {bodyExpanded ? "hide description" : "show description"}
            </button>
            {bodyExpanded && (
              <pre className="font-mono text-[11px] text-text-tertiary leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
                {commit.body}
              </pre>
            )}
          </div>
        )}
        <div className="flex items-center gap-3 font-mono text-[10px] text-text-quaternary">
          <span>{commit.author}</span>
          <span>·</span>
          <span>{relativeTime(commit.timestamp)}</span>
          {fileCount != null && (
            <>
              <span>·</span>
              <span>{fileCount} files changed</span>
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
              onJumpTo={onJumpTo}
              fileListOpen={fileListOpen}
              onToggle={onToggleFileList}
            />
            <div className="flex flex-1 overflow-hidden">
              {!isMobile && (
                <div className="w-48 shrink-0 overflow-y-auto border-r border-border">
                  <DiffFileList files={diff.files} activePath={activePath} onJumpTo={onJumpTo} />
                </div>
              )}
              <div ref={diffScrollRef} className="flex-1 overflow-y-auto relative bg-surface">
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
                  scrollRef={diffScrollRef}
                  onActivePathChange={onActivePathChange}
                  onToggleCollapsed={onToggleCollapsed}
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
  );
}

// ============================================================================
// GitHistoryDrawerContent
// ============================================================================

interface GitHistoryDrawerProps {
  onClose: () => void;
}

function GitHistoryDrawerContent({ onClose }: GitHistoryDrawerProps) {
  const {
    commits,
    fileCounts,
    currentBranch,
    showSyncStatus,
    syncStatus,
    canPush,
    canPull,
    pushLoading,
    pullLoading,
    fetchLoading,
    isStale,

    pushToOrigin,
    pullFromOrigin,
    fetchFromOrigin,
  } = useGitHistory();
  const { css } = useSyntaxCss();
  const isMobile = useIsMobile();

  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [bodyExpanded, setBodyExpanded] = useState(true);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [fileListOpen, setFileListOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const diffContentRef = useRef<DiffContentHandle>(null);
  const diffScrollRef = useRef<HTMLDivElement>(null);

  const { diff: rawDiff, loading: diffLoading } = useCommitDiff(selectedHash, 3);
  // Memoize sorted files so useAutoCollapsePaths doesn't re-run on every render.
  const diff = useMemo(
    () =>
      rawDiff
        ? { ...rawDiff, files: [...rawDiff.files].sort((a, b) => a.path.localeCompare(b.path)) }
        : rawDiff,
    [rawDiff],
  );

  const { collapsedPaths, toggleCollapsed, resetInteraction, expandForSearch } =
    useAutoCollapsePaths(diff?.files);

  const search = useDiffSearch(diff?.files ?? []);

  const { findBarOpen, closeFindBar } = useDiffFindNavigation({
    search,
    files: diff?.files ?? [],
    collapsedPaths,
    expandForSearch,
    diffContentRef,
    scrollEl: diffScrollRef.current,
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

  const detailPanelProps: Omit<CommitDetailPanelProps, "commit" | "fileCount"> = {
    diff: diff ?? null,
    diffLoading,
    activePath,
    collapsedPaths,
    bodyExpanded,
    fileListOpen,
    findBarOpen,
    search,
    diffContentRef,
    diffScrollRef,
    onActivePathChange: setActivePath,
    onToggleCollapsed: handleToggleCollapsed,
    onJumpTo: handleJumpTo,
    onToggleBody: () => setBodyExpanded((e) => !e),
    onToggleFileList: () => setFileListOpen((o) => !o),
    closeFindBar,
    isMobile,
  };

  return (
    <>
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
      <div className="flex flex-col h-full relative overflow-hidden">
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
          actions={[
            ...(showSyncStatus
              ? [
                  {
                    icon: <RefreshCw size={14} />,
                    label: "Fetch",
                    shortLabel: fetchLoading ? "Fetching…" : "Fetch",
                    onClick: fetchFromOrigin,
                    disabled: fetchLoading,
                  },
                  ...(canPull
                    ? [
                        {
                          icon: <Download size={14} />,
                          label: `Pull (${syncStatus?.behind ?? 0} behind)`,
                          shortLabel: pullLoading
                            ? "Pulling…"
                            : `Pull ↓${syncStatus?.behind ?? ""}`,
                          onClick: pullFromOrigin,
                          disabled: pullLoading,
                        },
                      ]
                    : []),
                  ...(canPush
                    ? [
                        {
                          icon: <Upload size={14} />,
                          label: `Push (${syncStatus?.ahead ?? 0} ahead)`,
                          shortLabel: pushLoading ? "Pushing…" : `Push ↑${syncStatus?.ahead ?? ""}`,
                          onClick: pushToOrigin,
                          disabled: pushLoading,
                        },
                      ]
                    : []),
                ]
              : []),
          ]}
        />

        {/* Desktop: side-by-side */}
        {!isMobile && (
          <div className="flex flex-1 overflow-hidden">
            <div
              ref={listRef}
              className={`w-60 shrink-0 overflow-y-auto border-r border-border ${stalenessClass(isStale)}`}
            >
              {commits.map((commit) => (
                <CommitRow
                  key={commit.hash}
                  commit={commit}
                  fileCount={fileCounts.get(commit.hash)}
                  selected={commit.hash === selectedHash}
                  isMobile={false}
                  onClick={() => setSelectedHash(commit.hash)}
                />
              ))}
              {commits.length === 0 && (
                <div className="p-4 font-mono text-[10px] text-text-quaternary">No commits.</div>
              )}
            </div>
            {selectedCommit ? (
              <CommitDetailPanel
                commit={selectedCommit}
                fileCount={fileCounts.get(selectedCommit.hash)}
                {...detailPanelProps}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center font-mono text-[11px] text-text-quaternary">
                Select a commit to view details.
              </div>
            )}
          </div>
        )}

        {/* Mobile: full-width commit list */}
        {isMobile && (
          <div ref={listRef} className={`flex-1 overflow-y-auto ${stalenessClass(isStale)}`}>
            {commits.map((commit) => (
              <CommitRow
                key={commit.hash}
                commit={commit}
                fileCount={fileCounts.get(commit.hash)}
                selected={commit.hash === selectedHash}
                isMobile={true}
                onClick={() => setSelectedHash(commit.hash)}
              />
            ))}
            {commits.length === 0 && (
              <div className="p-4 font-mono text-[10px] text-text-quaternary">No commits.</div>
            )}
          </div>
        )}

        {/* Mobile: commit detail overlay — slides in from right */}
        {isMobile && (
          <div
            className={[
              "absolute inset-0 bg-surface z-20 flex flex-col transition-transform duration-[160ms] ease-out",
              selectedHash ? "translate-x-0" : "translate-x-full",
            ].join(" ")}
          >
            <DrawerHeader
              title={selectedCommit?.message ?? "Commit"}
              onClose={onClose}
              onBack={() => setSelectedHash(null)}
            />
            {selectedCommit && (
              <CommitDetailPanel
                commit={selectedCommit}
                fileCount={fileCounts.get(selectedCommit.hash)}
                {...detailPanelProps}
              />
            )}
          </div>
        )}
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
