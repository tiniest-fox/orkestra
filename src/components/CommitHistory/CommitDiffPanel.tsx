import { useEffect, useState } from "react";
import { useCommitDiff } from "../../hooks/useCommitDiff";
import type { HighlightedFileDiff } from "../../hooks/useDiff";
import { useGitHistory } from "../../providers/GitHistoryProvider";
import { DiffPanelBody } from "../Diff/DiffPanelBody";
import { Panel } from "../ui";

interface CommitDiffPanelProps {
  commitHash: string;
  onClose: () => void;
}

export function CommitDiffPanel({ commitHash, onClose }: CommitDiffPanelProps) {
  const { diff, loading, error } = useCommitDiff(commitHash);
  const { commits } = useGitHistory();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const commit = commits.find((c) => c.hash === commitHash);
  const selectedFile = diff?.files.find((f) => f.path === selectedPath) ?? null;

  // Reset to first file on every commit change (diff identity changes only when commitHash changes).
  // Unlike DiffPanel (which polls), we want to reset selection when switching commits.
  useEffect(() => {
    if (diff && diff.files.length > 0) {
      setSelectedPath(diff.files[0].path);
    } else {
      setSelectedPath(null);
    }
  }, [diff]);

  const handleSelectFile = (file: HighlightedFileDiff) => {
    setSelectedPath(file.path);
  };

  return (
    <Panel className="flex flex-col">
      <Panel.Header>
        <Panel.Title>
          <code className="text-xs font-mono">{commitHash}</code>
        </Panel.Title>
        <Panel.CloseButton onClick={onClose} />
      </Panel.Header>
      {commit?.body && (
        <div className="px-4 pb-3 border-b border-stone-200 dark:border-stone-700">
          <pre className="text-sm text-stone-600 dark:text-stone-400 whitespace-pre-wrap font-sans max-h-32 overflow-y-auto">
            {commit.body}
          </pre>
        </div>
      )}
      <DiffPanelBody
        diff={diff}
        loading={loading}
        error={error}
        emptyMessage="No changes in this commit"
        selectedFile={selectedFile}
        onSelectFile={handleSelectFile}
        comments={[]}
      />
    </Panel>
  );
}
