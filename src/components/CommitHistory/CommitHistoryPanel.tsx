import { GitCommit } from "lucide-react";
import { useGitHistory } from "../../providers";
import { EmptyState, Panel } from "../ui";
import { CommitEntry } from "./CommitEntry";

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
        {loading && (
          <>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="px-3 py-2.5 border-b border-stone-100 dark:border-stone-800">
                <div className="flex items-center gap-2 mb-0.5">
                  <div className="h-3.5 w-14 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
                  <div className="h-3.5 w-10 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
                </div>
                <div className="h-4 w-48 bg-stone-200 dark:bg-stone-700 rounded animate-pulse mt-1" />
                <div className="flex items-center gap-2 mt-1">
                  <div className="h-3 w-20 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
                  <div className="h-3 w-12 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </>
        )}
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
