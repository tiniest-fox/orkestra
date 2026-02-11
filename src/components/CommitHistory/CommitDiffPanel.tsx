import { useEffect, useState } from "react";
import { useCommitDiff } from "../../hooks/useCommitDiff";
import type { HighlightedFileDiff } from "../../hooks/useDiff";
import { DiffPanelBody } from "../Diff/DiffPanelBody";
import { Panel } from "../ui";

interface CommitDiffPanelProps {
  commitHash: string;
  onClose: () => void;
}

export function CommitDiffPanel({ commitHash, onClose }: CommitDiffPanelProps) {
  const { diff, loading, error } = useCommitDiff(commitHash);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

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
      <DiffPanelBody
        diff={diff}
        loading={loading}
        error={error}
        emptyMessage="No changes in this commit"
        selectedFile={selectedFile}
        onSelectFile={handleSelectFile}
      />
    </Panel>
  );
}
