/**
 * DiffPanel - Main container for the git diff viewer.
 */

import { useDiff } from "../../hooks/useDiff";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { Panel } from "../ui";
import { DiffContent } from "./DiffContent";
import { DiffFileList } from "./DiffFileList";

interface DiffPanelProps {
  taskId: string;
}

export function DiffPanel({ taskId }: DiffPanelProps) {
  const { files, selectedFile, selectFile, loading, error } = useDiff(taskId, true);

  // Inject syntax highlighting CSS once
  useSyntaxCss();

  // Error state
  if (error) {
    return (
      <Panel>
        <div className="flex items-center justify-center h-full text-error-500 dark:text-error-400">
          {error}
        </div>
      </Panel>
    );
  }

  // Loading state
  if (loading && files.length === 0) {
    return (
      <Panel>
        <div className="flex items-center justify-center h-full text-stone-500 dark:text-stone-400">
          Loading diff...
        </div>
      </Panel>
    );
  }

  // Empty state
  if (files.length === 0) {
    return (
      <Panel>
        <div className="flex items-center justify-center h-full text-stone-500 dark:text-stone-400">
          No changes yet
        </div>
      </Panel>
    );
  }

  // Two-column layout
  return (
    <Panel>
      <div className="flex h-full overflow-hidden">
        <DiffFileList
          files={files}
          selectedPath={selectedFile?.path ?? null}
          onSelectFile={selectFile}
        />
        {selectedFile && <DiffContent taskId={taskId} file={selectedFile} />}
      </div>
    </Panel>
  );
}
