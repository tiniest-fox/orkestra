/**
 * DiffFileList - Left-side file list.
 *
 * Displays:
 * - File count header
 * - Scrollable list of DiffFileEntry components
 */

import type { HighlightedFileDiff } from "../../hooks/useDiff";
import { DiffFileEntry } from "./DiffFileEntry";

interface DiffFileListProps {
  files: HighlightedFileDiff[];
  selectedFile: HighlightedFileDiff | null;
  onSelectFile: (file: HighlightedFileDiff) => void;
}

export function DiffFileList({ files, selectedFile, onSelectFile }: DiffFileListProps) {
  return (
    <div className="w-48 flex-shrink-0 flex flex-col -mr-2">
      {/* Header */}
      <div className="px-2 py-1 mr-4 bg-stone-100 dark:bg-stone-800 text-xs font-semibold text-stone-700 dark:text-stone-200 rounded">
        {files.length} {files.length === 1 ? "file" : "files"}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto mt-1 space-y-1">
        {files.map((file) => (
          <DiffFileEntry
            key={file.path}
            file={file}
            isSelected={selectedFile === file}
            onClick={() => onSelectFile(file)}
          />
        ))}
      </div>
    </div>
  );
}
