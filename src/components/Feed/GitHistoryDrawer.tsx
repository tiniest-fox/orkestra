//! Git history drawer — commit log for the current branch with inline diff view.
//!
//! Mounted/unmounted by the parent (FeedView). The Drawer is always open while
//! this component exists; data comes from GitHistoryProvider which polls independently.

import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCommitDiff } from "../../hooks/useCommitDiff";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { useGitHistory } from "../../providers/GitHistoryProvider";
import type { CommitInfo } from "../../types/workflow";
import { DiffSkeleton } from "../Diff/DiffSkeleton";
import { ForgeDiffContent } from "../Diff/Forge/ForgeDiffContent";
import { ForgeDiffFileList } from "../Diff/Forge/ForgeDiffFileList";
import { Drawer } from "../ui/Drawer/Drawer";
import { Kbd } from "../ui/Kbd";

// Forge syntax theme — matches DrawerDiffTab overrides.
const FORGE_SYNTAX_OVERRIDES = `
.forge-theme .syn-comment,
.forge-theme .syn-comment span { color: #A090B8 !important; font-style: italic !important; }
.forge-theme [class*="syn-string"],
.forge-theme [class*="syn-string"] span { color: #0284C7 !important; }
.forge-theme [class*="syn-string"] [class*="syn-escape"],
.forge-theme [class*="syn-constant"][class*="syn-character"][class*="syn-escape"] { color: #0D9488 !important; }
.forge-theme .syn-keyword,
.forge-theme .syn-keyword span,
.forge-theme .syn-storage,
.forge-theme .syn-storage span,
.forge-theme .syn-storage.syn-type,
.forge-theme .syn-storage.syn-type span,
.forge-theme .syn-storage.syn-modifier,
.forge-theme .syn-storage.syn-modifier span,
.forge-theme .syn-keyword.syn-control,
.forge-theme .syn-keyword.syn-control span,
.forge-theme .syn-keyword.syn-operator,
.forge-theme .syn-keyword.syn-operator span,
.forge-theme .syn-keyword.syn-other,
.forge-theme .syn-keyword.syn-other span { color: #7C3AED !important; }
.forge-theme .syn-constant.syn-numeric,
.forge-theme .syn-constant.syn-numeric span { color: #C96800 !important; }
.forge-theme .syn-constant.syn-language,
.forge-theme .syn-constant.syn-language span { color: #EA580C !important; }
.forge-theme .syn-constant.syn-character,
.forge-theme .syn-constant.syn-character span { color: #0D9488 !important; }
.forge-theme .syn-constant.syn-other,
.forge-theme .syn-constant.syn-other span { color: #C96800 !important; }
.forge-theme .syn-entity.syn-name.syn-function,
.forge-theme .syn-entity.syn-name.syn-function span { color: #1D64D8 !important; }
.forge-theme .syn-support.syn-function,
.forge-theme .syn-support.syn-function span { color: #2B74D6 !important; }
.forge-theme .syn-entity.syn-name.syn-type,
.forge-theme .syn-entity.syn-name.syn-type span,
.forge-theme .syn-entity.syn-name.syn-class,
.forge-theme .syn-entity.syn-name.syn-class span,
.forge-theme .syn-support.syn-type,
.forge-theme .syn-support.syn-type span,
.forge-theme .syn-support.syn-class,
.forge-theme .syn-support.syn-class span { color: #B8850A !important; }
.forge-theme .syn-entity.syn-name.syn-tag,
.forge-theme .syn-entity.syn-name.syn-tag span { color: #C42444 !important; }
.forge-theme .syn-entity.syn-other.syn-attribute-name,
.forge-theme .syn-entity.syn-other.syn-attribute-name span { color: #AD5C1A !important; }
.forge-theme .syn-variable.syn-parameter,
.forge-theme .syn-variable.syn-parameter span { color: #8B5CF6 !important; }
.forge-theme .syn-variable,
.forge-theme .syn-variable span { color: #1C1820 !important; }
.forge-theme .syn-punctuation,
.forge-theme .syn-punctuation span,
.forge-theme .syn-meta.syn-brace,
.forge-theme .syn-meta.syn-brace span { color: #7A7090 !important; }
.forge-theme .syn-meta.syn-preprocessor,
.forge-theme .syn-meta.syn-preprocessor span,
.forge-theme .syn-support.syn-other.syn-macro,
.forge-theme .syn-support.syn-other.syn-macro span { color: #EA580C !important; }
.forge-theme .syn-entity.syn-name.syn-module,
.forge-theme .syn-entity.syn-name.syn-module span,
.forge-theme .syn-entity.syn-name.syn-namespace,
.forge-theme .syn-entity.syn-name.syn-namespace span { color: #B8850A !important; }
.forge-theme .syn-invalid,
.forge-theme .syn-invalid span { color: #DC2626 !important; }
`;

// ============================================================================
// Helpers
// ============================================================================

function relativeTime(timestamp: string): string {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

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
        "w-full text-left px-3 py-2.5 border-b border-[var(--border)] transition-colors",
        selected
          ? "bg-[var(--accent-bg)] border-l-2 border-l-[var(--accent)] !pl-[10px]"
          : "hover:bg-[var(--surface-hover)]",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5 mb-[3px]">
        <span className="font-forge-mono text-[10px] text-[var(--text-3)] bg-[var(--surface-2)] px-[5px] py-[1px] rounded leading-tight shrink-0">
          {commit.hash}
        </span>
      </div>
      <div className="font-forge-sans text-[12px] text-[var(--text-0)] leading-snug line-clamp-2 mb-[3px]">
        {commit.message}
      </div>
      <div className="flex items-center gap-1.5 font-forge-mono text-[10px] text-[var(--text-3)]">
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
  const diffScrollRef = useRef<HTMLDivElement>(null);
  const fileSectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());


  // Reset per-commit state when selection changes.
  useEffect(() => {
    setActivePath(null);
    setBodyExpanded(true);
  }, [selectedHash]);

  const { diff, loading: diffLoading } = useCommitDiff(selectedHash);

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

  const handleFileSectionRef = useCallback((path: string, el: HTMLDivElement | null) => {
    if (el) fileSectionRefs.current.set(path, el);
    else fileSectionRefs.current.delete(path);
  }, []);

  function handleJumpTo(path: string) {
    setActivePath(path);
    const el = fileSectionRefs.current.get(path);
    if (el && diffScrollRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const selectedCommit = selectedHash ? (commits.find((c) => c.hash === selectedHash) ?? null) : null;

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
        <div className="shrink-0 flex items-center gap-3 px-6 h-11 border-b border-[var(--border)]">
          <span className="font-forge-sans text-[13px] font-semibold text-[var(--text-0)] flex-1">
            Git History
          </span>
          {currentBranch && (
            <span className="font-forge-mono text-[11px] shrink-0" style={{ color: "var(--accent)" }}>
              {currentBranch}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 flex items-center gap-1.5 text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
            title="Close (Esc)"
          >
            <Kbd>esc</Kbd>
            <X size={14} />
          </button>
        </div>

        {/* Body: commit list (left) + commit detail (right) */}
        <div className="flex flex-1 overflow-hidden">
          {/* Commit list */}
          <div ref={listRef} className="w-60 shrink-0 overflow-y-auto border-r border-[var(--border)]">
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
              <div className="p-4 font-forge-mono text-[10px] text-[var(--text-3)]">
                No commits.
              </div>
            )}
          </div>

          {/* Commit detail */}
          {selectedCommit ? (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Commit info */}
              <div className="shrink-0 px-6 py-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-forge-mono text-[10px] text-[var(--text-3)] bg-[var(--surface-2)] px-[5px] py-[1px] rounded leading-tight">
                    {selectedCommit.hash}
                  </span>
                </div>
                <div className="font-forge-sans text-[14px] font-semibold tracking-[-0.01em] text-[var(--text-0)] leading-snug mb-2">
                  {selectedCommit.message}
                </div>
                {selectedCommit.body && (
                  <div className="mb-2">
                    <button
                      type="button"
                      onClick={() => setBodyExpanded((e) => !e)}
                      className="flex items-center gap-[3px] font-forge-mono text-[10px] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors mb-1"
                    >
                      {bodyExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      {bodyExpanded ? "hide description" : "show description"}
                    </button>
                    {bodyExpanded && (
                      <pre className="font-forge-mono text-[11px] text-[var(--text-2)] leading-relaxed whitespace-pre-wrap">
                        {selectedCommit.body}
                      </pre>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-3 font-forge-mono text-[10px] text-[var(--text-3)]">
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
                    <div className="w-48 shrink-0 overflow-y-auto border-r border-[var(--border)]">
                      <ForgeDiffFileList
                        files={diff.files}
                        activePath={activePath}
                        onJumpTo={handleJumpTo}
                      />
                    </div>
                    <div ref={diffScrollRef} className="flex-1 overflow-y-auto">
                      <ForgeDiffContent
                        files={diff.files}
                        comments={[]}
                        activePath={activePath}
                        collapsedPaths={new Set()}
                        onToggleCollapsed={() => {}}
                        onFileSectionRef={handleFileSectionRef}
                      />
                    </div>
                  </>
                ) : diff ? (
                  <div className="flex-1 p-6 font-forge-mono text-[11px] text-[var(--text-3)]">
                    No changes.
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center font-forge-mono text-[11px] text-[var(--text-3)]">
              Select a commit to view details.
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
