// Footer status line — git info and keyboard hints, swaps content when drawer is open.

import { useEffect } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useGitHistory } from "../../providers/GitHistoryProvider";
import type { WorkflowTaskView } from "../../types/workflow";
import { Kbd } from "../ui/Kbd";

interface FeedStatusLineProps {
  tasks: WorkflowTaskView[];
  drawerMode:
    | null
    | "review"
    | "review-reject"
    | "answer"
    | "focus"
    | "ship"
    | "git-history"
    | "new-task"
    | "assistant";
  onToggleHistory?: () => void;
}

export function FeedStatusLine({ tasks, drawerMode, onToggleHistory }: FeedStatusLineProps) {
  const isMobile = useIsMobile();
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
    operationError,
  } = useGitHistory();

  // Git key handlers — suspended while a task drawer is open or on mobile.
  useEffect(() => {
    if (isMobile) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // H toggles git history only when no task drawer is open (avoids conflicting with
      // the task history tab shortcut inside the task drawer's HotkeyScope).
      if (
        e.key === "h" &&
        (drawerMode === null ||
          drawerMode === "git-history" ||
          drawerMode === "new-task" ||
          drawerMode === "assistant")
      ) {
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
  }, [
    isMobile,
    drawerMode,
    drawerOpen,
    canPush,
    canPull,
    pushToOrigin,
    pullFromOrigin,
    fetchFromOrigin,
    pushLoading,
    pullLoading,
    fetchLoading,
    onToggleHistory,
  ]);

  if (isMobile) return null;

  const hasGitInfo = currentBranch !== null;
  const latestCommit = commits[0]?.message ?? null;
  const hasSyncActions = canPush || canPull;

  return (
    <div className="flex items-center justify-between px-6 min-h-7 pt-1 pb-[max(4px,env(safe-area-inset-bottom))] border-t border-border bg-surface shrink-0 font-mono text-[11px] text-text-tertiary">
      <div className="flex items-center gap-3 min-w-0">
        {hasGitInfo && <span className="font-medium shrink-0 text-accent">{currentBranch}</span>}
        {latestCommit && (
          <span className="text-text-quaternary truncate max-w-[240px]" title={latestCommit}>
            {latestCommit}
          </span>
        )}
        {syncStatus && syncStatus.ahead > 0 && (
          <button
            type="button"
            onClick={pushToOrigin}
            disabled={pushLoading}
            className={`shrink-0 text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-40 cursor-default${isMobile ? " min-h-[44px] min-w-[44px] flex items-center justify-center" : ""}`}
            title={`Push ${syncStatus.ahead} commit${syncStatus.ahead !== 1 ? "s" : ""} (P)`}
          >
            ↑{syncStatus.ahead}
          </button>
        )}
        {syncStatus && syncStatus.behind > 0 && (
          <button
            type="button"
            onClick={pullFromOrigin}
            disabled={pullLoading}
            className={`shrink-0 text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-40 cursor-default${isMobile ? " min-h-[44px] min-w-[44px] flex items-center justify-center" : ""}`}
            title={`Pull ${syncStatus.behind} commit${syncStatus.behind !== 1 ? "s" : ""} (F)`}
          >
            ↓{syncStatus.behind}
          </button>
        )}
        {operationError && (
          <span
            className="shrink-0 text-status-error truncate max-w-[320px]"
            title={`${operationError.type === "pull" ? "Pull" : "Push"} failed: ${operationError.message}`}
          >
            {operationError.type === "pull" ? "Pull failed" : "Push failed"}:{" "}
            {operationError.message}
          </span>
        )}
        {agentCount > 0 && (
          <>
            {hasGitInfo && <span className="text-text-quaternary shrink-0">·</span>}
            <span className="shrink-0">
              <span className="font-medium text-status-warning">{agentCount}</span> agent
              {agentCount !== 1 ? "s" : ""} running
            </span>
          </>
        )}
      </div>
      {!isMobile &&
        (drawerMode === "new-task" ? (
          <div className="flex items-center gap-3 shrink-0">
            <span className="flex items-center gap-1.5">
              <Kbd>tab</Kbd>
              <span>next field</span>
            </span>
            <span className="text-text-quaternary">·</span>
            <span className="flex items-center gap-1.5">
              <Kbd>cmd+enter</Kbd>
              <span>create</span>
            </span>
            <span className="text-text-quaternary">·</span>
            <span className="flex items-center gap-1.5">
              <Kbd>esc</Kbd>
              <span>cancel</span>
            </span>
          </div>
        ) : drawerMode === "assistant" ? (
          <div className="flex items-center gap-3 shrink-0">
            <span className="flex items-center gap-1.5">
              <Kbd>⌘⏎</Kbd>
              <span>send</span>
            </span>
            <span className="text-text-quaternary">·</span>
            <span className="flex items-center gap-1.5">
              <Kbd>esc</Kbd>
              <span>close</span>
            </span>
          </div>
        ) : drawerMode === "git-history" ? (
          <div className="flex items-center gap-3 shrink-0">
            <span className="flex items-center gap-1.5">
              <Kbd>j/k</Kbd>
              <span>navigate</span>
            </span>
            <span className="text-text-quaternary">·</span>
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
                <span className="text-text-quaternary">·</span>
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
                <span className="text-text-quaternary">·</span>
                <span className="flex items-center gap-1.5">
                  <Kbd>R</Kbd>
                  <span>reject</span>
                </span>
                <span className="text-text-quaternary">·</span>
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
                <span className="text-text-quaternary">·</span>
              </>
            )}
            <span className="flex items-center gap-1.5">
              <Kbd>G</Kbd>
              <span>fetch</span>
            </span>
            <span className="text-text-quaternary">·</span>
            <span className="flex items-center gap-1.5">
              <Kbd>H</Kbd>
              <span>history</span>
            </span>
            <span className="text-text-quaternary">·</span>
            <span className="flex items-center gap-1.5">
              <Kbd>enter</Kbd>
              <span>focus</span>
            </span>
            <span className="text-text-quaternary">·</span>
            <span className="flex items-center gap-1.5">
              <Kbd>↑↓</Kbd>
              <Kbd>j/k</Kbd>
              <span>navigate</span>
            </span>
          </div>
        ))}
    </div>
  );
}
