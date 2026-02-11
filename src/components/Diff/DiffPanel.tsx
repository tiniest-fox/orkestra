/**
 * DiffPanel - Full-screen diff viewer.
 *
 * Layout:
 * - Left: File list
 * - Right: Unified diff view
 *
 * Fetches diff data with 2-second polling.
 * Injects syntax CSS into a <style> tag.
 */

import { useEffect, useState } from "react";
import { type HighlightedFileDiff, useDiff } from "../../hooks/useDiff";
import { Panel } from "../ui";
import { DiffPanelBody } from "./DiffPanelBody";

interface DiffPanelProps {
  taskId: string;
  onClose: () => void;
}

export function DiffPanel({ taskId, onClose }: DiffPanelProps) {
  const { diff, loading, error } = useDiff(taskId);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Derive selected file from path (survives diff refresh)
  const selectedFile = diff?.files.find((f) => f.path === selectedPath) ?? null;

  // Auto-select first file when diff loads, but preserve manual selection across polls.
  // Unlike CommitDiffPanel (which switches commits), we poll the same diff and should
  // NOT reset selection when diff refreshes with same content.
  useEffect(() => {
    if (diff && diff.files.length > 0 && !selectedPath) {
      setSelectedPath(diff.files[0].path);
    }
  }, [diff, selectedPath]);

  const handleSelectFile = (file: HighlightedFileDiff) => {
    setSelectedPath(file.path);
  };

  return (
    <Panel className="flex flex-col">
      <Panel.Header>
        <Panel.Title>Changes</Panel.Title>
        <Panel.CloseButton onClick={onClose} />
      </Panel.Header>
      <DiffPanelBody
        diff={diff}
        loading={loading}
        error={error}
        emptyMessage="No changes to display"
        selectedFile={selectedFile}
        onSelectFile={handleSelectFile}
      />
    </Panel>
  );
}
