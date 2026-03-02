//! Git history drawer — commit log for the current branch with inline diff view.
//!
//! Mounted/unmounted by the parent (FeedView). The Drawer is always open while
//! this component exists; data comes from GitHistoryProvider which polls independently.

import { ChevronDown, ChevronRight, GitCompare, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCommitDiff } from "../../hooks/useCommitDiff";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { useGitHistory } from "../../providers/GitHistoryProvider";
import { FORGE_SYNTAX_OVERRIDES } from "../../styles/syntaxHighlighting";
import type { CommitInfo } from "../../types/workflow";
import { relativeTime } from "../../utils/relativeTime";
import type { DiffContentHandle } from "../Diff/DiffContent";
import { DiffContent } from "../Diff/DiffContent";
import { DiffFileList } from "../Diff/DiffFileList";
import { DiffSkeleton } from "../Diff/DiffSkeleton";
import { useAutoCollapsePaths } from "../Diff/useAutoCollapsePaths";
import { Drawer } from "../ui/Drawer/Drawer";
import { EmptyState } from "../ui/EmptyState";
import { Kbd } from "../ui/Kbd";

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

export function GitHistoryDrawer({ onClose }: GitHistoryDrawerProps) {
  const { commits, fileCounts, currentBranch } = useGitHistory();
  const { css } = useSyntaxCss();

  // Start with no selection so the initial mount is cheap (no diff rendering).
  // The commit list renders instantly; diff loads only after explicit selection.
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [bodyExpanded, setBodyExpanded] = useState(true);
  const [activePath, setActivePath] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const diffContentRef = useRef<DiffContentHandle>(null);
  const [diffScrollEl, setDiffScrollEl] = useState<HTMLDivElement | null>(null);
  const setDiffScrollRef = useCallback((el: HTMLDivElement | null) => {
    setDiffScrollEl(el);
  }, []);

  const { diff, loading: diffLoading } = useCommitDiff(selectedHash);

  const { collapsedPaths, toggleCollapsed, resetInteraction } = useAutoCollapsePaths(diff?.files);

  // Reset per-commit state when selection changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedHash is the intentional trigger; setters are stable
  useEffect(() => {
    setActivePath(null);
    setBodyExpanded(true);
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

  // j/k keyboard navigation for the commit list.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedHash((prev) => {
          const idx = prev ? commits.findIndex((c) => c.hash === prev) : -1;
          return commits[idx + 1]?.hash ?? prev;
        });
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedHash((prev) => {
          const idx = prev ? commits.findIndex((c) => c.hash === prev) : commits.length;
          return commits[idx - 1]?.hash ?? prev;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commits]);

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
    <Drawer onClose={onClose}>
      {css && (
        <style
          // biome-ignore lint/security/noDangerouslySetInnerHtml: syntect CSS output is trusted
          dangerouslySetInnerHTML={{ __html: css.light + FORGE_SYNTAX_OVERRIDES }}
        />
      )}
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-6 h-11 border-b border-border">
          <span className="font-sans text-[13px] font-semibold text-text-primary flex-1">
            Git History
          </span>
          {currentBranch && (
            <span className="font-mono text-[11px] shrink-0 text-accent">{currentBranch}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 flex items-center gap-1.5 text-text-quaternary hover:text-text-secondary transition-colors"
            title="Close (Esc)"
          >
            <Kbd>esc</Kbd>
            <X size={14} />
          </button>
        </div>

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
              <div className="flex flex-1 overflow-hidden">
                {diffLoading && !diff ? (
                  <div className="flex-1 overflow-auto p-4">
                    <DiffSkeleton />
                  </div>
                ) : diff && diff.files.length > 0 ? (
                  <>
                    <div className="w-48 shrink-0 overflow-y-auto border-r border-border">
                      <DiffFileList
                        files={diff.files}
                        activePath={activePath}
                        onJumpTo={handleJumpTo}
                      />
                    </div>
                    <div ref={setDiffScrollRef} className="flex-1 overflow-y-auto">
                      <DiffContent
                        ref={diffContentRef}
                        files={diff.files}
                        comments={[]}
                        activePath={activePath}
                        collapsedPaths={collapsedPaths}
                        scrollElement={diffScrollEl}
                        onActivePathChange={setActivePath}
                        onToggleCollapsed={handleToggleCollapsed}
                      />
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
    </Drawer>
  );
}
