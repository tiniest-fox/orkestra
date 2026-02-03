/**
 * DiffFileList - Left sidebar showing all changed files.
 */

import type { HighlightedFileDiff } from "../../hooks/useDiff";
import { DiffFileEntry } from "./DiffFileEntry";

interface DiffFileListProps {
  files: HighlightedFileDiff[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

export function DiffFileList({ files, selectedPath, onSelectFile }: DiffFileListProps) {
  // Sort files by path
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <div className="w-[250px] flex-shrink-0 overflow-y-auto border-r border-stone-200 dark:border-stone-800">
      {sortedFiles.map((file) => (
        <DiffFileEntry
          key={file.path}
          file={file}
          isSelected={selectedPath === file.path}
          onSelect={() => onSelectFile(file.path)}
        />
      ))}
    </div>
  );
}
