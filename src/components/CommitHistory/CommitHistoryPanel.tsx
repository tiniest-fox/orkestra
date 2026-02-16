import { GitCommit } from "lucide-react";
import { useGitHistory } from "../../providers";
import { SyncActionButton, SyncStatusIndicator } from "../SyncStatus";
import { EmptyState, ErrorState, Panel } from "../ui";
import { CommitEntry } from "./CommitEntry";
import { CommitHistorySkeleton } from "./CommitHistorySkeleton";

interface CommitHistoryPanelProps {
  selectedCommit: string | undefined;
  onSelectCommit: (hash: string) => void;
  onClose: () => void;
}

export function CommitHistoryPanel({
  selectedCommit,
  onSelectCommit,
  onClose,
}: CommitHistoryPanelProps) {
  const {
    commits,
    fileCounts,
    loading,
    error,
    syncStatus,
    pushLoading,
    pullLoading,
    pushToOrigin,
    pullFromOrigin,
    operationError,
    canPush,
    canPull,
    showSyncStatus,
  } = useGitHistory();

  return (
    <Panel className="flex flex-col">
      <Panel.Header>
        <Panel.Title>Commits</Panel.Title>

        {/* Sync status and buttons container */}
        <div className="flex items-center gap-2 ml-auto mr-2">
          {/* Sync status indicators */}
          {showSyncStatus && syncStatus && (
            <SyncStatusIndicator ahead={syncStatus.ahead} behind={syncStatus.behind} size="md" />
          )}

          {/* Push button */}
          {canPush && (
            <SyncActionButton
              type="push"
              loading={pushLoading}
              hasError={operationError?.type === "push"}
              onClick={pushToOrigin}
              size="md"
            />
          )}

          {/* Pull button */}
          {canPull && (
            <SyncActionButton
              type="pull"
              loading={pullLoading}
              hasError={operationError?.type === "pull"}
              onClick={pullFromOrigin}
              size="md"
            />
          )}
        </div>

        {/* Error message */}
        {operationError && (
          <span className="text-xs text-error-500 dark:text-error-400 mr-2">
            {operationError.type === "push" ? "Push" : "Pull"} failed: {operationError.message}
          </span>
        )}

        <Panel.CloseButton onClick={onClose} />
      </Panel.Header>
      <Panel.Body className="flex-1 overflow-y-auto pt-0">
        {loading && <CommitHistorySkeleton />}
        {error != null && <ErrorState message="Failed to load commits" error={error} />}
        {!loading && error == null && commits.length === 0 && (
          <EmptyState icon={GitCommit} message="No commits found" />
        )}
        {!loading &&
          error == null &&
          commits.map((commit) => (
            <CommitEntry
              key={commit.hash}
              commit={commit}
              fileCount={fileCounts.get(commit.hash) ?? null}
              isSelected={commit.hash === selectedCommit}
              onSelect={onSelectCommit}
            />
          ))}
      </Panel.Body>
    </Panel>
  );
}
