//! Footer status line — git info and keyboard hints, swaps content when drawer is open.

import { useEffect } from "react";
import { useGitHistory } from "../../providers/GitHistoryProvider";
import type { WorkflowTaskView } from "../../types/workflow";
import { Kbd } from "../ui/Kbd";

interface FeedStatusLineProps {
  tasks: WorkflowTaskView[];
  drawerMode: null | "review" | "review-reject" | "answer" | "focus" | "ship" | "git-history";
  onToggleHistory?: () => void;
}

export function FeedStatusLine({ tasks, drawerMode, onToggleHistory }: FeedStatusLineProps) {
  const drawerOpen = drawerMode !== null;
  const agentCount = tasks.filter((t) => t.derived.is_working).length;
  const {
    currentBranch,
    commits,
    syncStatus,
    canPush,
    canPull,
    pushToOrigin,
    pullFromOrigin,
    fetchFromOrigin,
    pushLoading,
    pullLoading,
    fetchLoading,
  } = useGitHistory();

  // Git key handlers — suspended while a task drawer is open.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // H toggles git history only when no task drawer is open (avoids conflicting with
      // the task history tab shortcut inside the task drawer's HotkeyScope).
      if (e.key === "h" && (drawerMode === null || drawerMode === "git-history")) {
        e.preventDefault();
        onToggleHistory?.();
        return;
      }
      if (drawerOpen) return;
      if (e.key === "p" && canPush && !pushLoading) {
        e.preventDefault();
        pushToOrigin();
      }
      if (e.key === "f" && canPull && !pullLoading) {
        e.preventDefault();
        pullFromOrigin();
      }
      if (e.key === "g" && !fetchLoading) {
        e.preventDefault();
        fetchFromOrigin();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerMode, drawerOpen, canPush, canPull, pushToOrigin, pullFromOrigin, fetchFromOrigin, pushLoading, pullLoading, fetchLoading, onToggleHistory]);

  const hasGitInfo = currentBranch !== null;
  const latestCommit = commits[0]?.message ?? null;
  const hasSyncActions = canPush || canPull;

  return (
    <div className="flex items-center justify-between px-6 h-7 border-t border-[var(--border)] bg-white shrink-0 font-forge-mono text-[11px] text-[var(--text-2)]">
      <div className="flex items-center gap-3 min-w-0">
        {hasGitInfo && (
          <span className="font-medium shrink-0" style={{ color: "var(--accent)" }}>
            {currentBranch}
          </span>
        )}
        {latestCommit && (
          <span className="text-[var(--text-3)] truncate max-w-[240px]" title={latestCommit}>
            {latestCommit}
          </span>
        )}
        {syncStatus && syncStatus.ahead > 0 && (
          <button
            onClick={pushToOrigin}
            disabled={pushLoading}
            className="shrink-0 text-[var(--text-2)] hover:text-[var(--text-0)] transition-colors disabled:opacity-40 cursor-default"
            title={`Push ${syncStatus.ahead} commit${syncStatus.ahead !== 1 ? "s" : ""} (P)`}
          >
            ↑{syncStatus.ahead}
          </button>
        )}
        {syncStatus && syncStatus.behind > 0 && (
          <button
            onClick={pullFromOrigin}
            disabled={pullLoading}
            className="shrink-0 text-[var(--text-2)] hover:text-[var(--text-0)] transition-colors disabled:opacity-40 cursor-default"
            title={`Pull ${syncStatus.behind} commit${syncStatus.behind !== 1 ? "s" : ""} (F)`}
          >
            ↓{syncStatus.behind}
          </button>
        )}
        {agentCount > 0 && (
          <>
            {hasGitInfo && <span className="text-[var(--text-3)] shrink-0">·</span>}
            <span className="shrink-0">
              <span className="font-medium" style={{ color: "var(--amber)" }}>{agentCount}</span>
              {" "}agent{agentCount !== 1 ? "s" : ""} running
            </span>
          </>
        )}
      </div>
      {drawerMode === "git-history" ? (
        <div className="flex items-center gap-3 shrink-0">
          <span className="flex items-center gap-1.5">
            <Kbd>j/k</Kbd>
            <span>navigate</span>
          </span>
          <span className="text-[var(--text-3)]">·</span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd>
            <span>close</span>
          </span>
        </div>
      ) : drawerOpen ? (
        <div className="flex items-center gap-3 shrink-0">
          {drawerMode === "review-reject" ? (
            <>
              <span className="flex items-center gap-1.5">
                <Kbd>enter</Kbd>
                <span>send</span>
              </span>
              <span className="text-[var(--text-3)]">·</span>
              <span className="flex items-center gap-1.5">
                <Kbd>esc</Kbd>
                <span>cancel</span>
              </span>
            </>
          ) : drawerMode === "answer" ? (
            <span className="flex items-center gap-1.5">
              <Kbd>S</Kbd>
              <span>submit</span>
            </span>
          ) : drawerMode === "focus" ? (
            <span className="flex items-center gap-1.5">
              <Kbd>esc</Kbd>
              <span>close</span>
            </span>
          ) : drawerMode === "ship" ? (
            <span className="flex items-center gap-1.5">
              <Kbd>esc</Kbd>
              <span>close</span>
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <Kbd>A</Kbd>
                <span>approve</span>
              </span>
              <span className="text-[var(--text-3)]">·</span>
              <span className="flex items-center gap-1.5">
                <Kbd>R</Kbd>
                <span>reject</span>
              </span>
              <span className="text-[var(--text-3)]">·</span>
              <span className="flex items-center gap-1.5">
                <Kbd>L</Kbd>
                <span>logs</span>
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 shrink-0">
          {hasSyncActions && (
            <>
              {canPush && (
                <span className="flex items-center gap-1.5">
                  <Kbd>P</Kbd>
                  <span>push</span>
                </span>
              )}
              {canPull && (
                <span className="flex items-center gap-1.5">
                  <Kbd>F</Kbd>
                  <span>pull</span>
                </span>
              )}
              <span className="text-[var(--text-3)]">·</span>
            </>
          )}
          <span className="flex items-center gap-1.5">
            <Kbd>G</Kbd>
            <span>fetch</span>
          </span>
          <span className="text-[var(--text-3)]">·</span>
          <span className="flex items-center gap-1.5">
            <Kbd>H</Kbd>
            <span>history</span>
          </span>
          <span className="text-[var(--text-3)]">·</span>
          <span className="flex items-center gap-1.5">
            <Kbd>enter</Kbd>
            <span>focus</span>
          </span>
          <span className="text-[var(--text-3)]">·</span>
          <span className="flex items-center gap-1.5">
            <Kbd>↑↓</Kbd>
            <Kbd>j/k</Kbd>
            <span>navigate</span>
          </span>
        </div>
      )}
    </div>
  );
}
