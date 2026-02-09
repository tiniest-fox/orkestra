import { GitCommit } from "lucide-react";
import { useGitHistory } from "../../providers";
import { EmptyState, Panel } from "../ui";
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
  const { commits, loading, error } = useGitHistory();

  return (
    <Panel className="flex flex-col">
      <Panel.Header>
        <Panel.Title>Commits</Panel.Title>
        <Panel.CloseButton onClick={onClose} />
      </Panel.Header>
      <Panel.Body className="flex-1 overflow-y-auto pt-0">
        {loading && <CommitHistorySkeleton />}
        {error && (
          <div className="flex items-center justify-center h-32 text-error-600 dark:text-error-400">
            Error: {error}
          </div>
        )}
        {!loading && !error && commits.length === 0 && (
          <EmptyState icon={GitCommit} message="No commits found" />
        )}
        {!loading &&
          !error &&
          commits.map((commit) => (
            <CommitEntry
              key={commit.hash}
              commit={commit}
              isSelected={commit.hash === selectedCommit}
              onSelect={onSelectCommit}
            />
          ))}
      </Panel.Body>
    </Panel>
  );
}
