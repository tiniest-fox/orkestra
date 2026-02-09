import { invoke } from "@tauri-apps/api/core";
import { GitCommit } from "lucide-react";
import { useEffect, useState } from "react";
import type { CommitInfo } from "../../types/workflow";
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
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<CommitInfo[]>("workflow_get_commit_log")
      .then((result) => {
        if (!cancelled) setCommits(result);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Panel className="flex flex-col">
      <Panel.Header>
        <Panel.Title>Commits</Panel.Title>
        <Panel.CloseButton onClick={onClose} />
      </Panel.Header>
      <Panel.Body className="flex-1 overflow-y-auto pt-0">
        {loading && (
          <div className="flex items-center justify-center h-32 text-stone-400">Loading...</div>
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
