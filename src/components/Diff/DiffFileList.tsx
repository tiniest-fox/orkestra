/**
 * DiffFileList - Left-side file list (250px fixed width).
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
    <div className="w-64 flex-shrink-0 border-r border-gray-700 flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 text-sm font-medium">
        {files.length} {files.length === 1 ? "file" : "files"} changed
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {files.map((file, i) => (
          <DiffFileEntry
            key={i}
            file={file}
            isSelected={selectedFile === file}
            onClick={() => onSelectFile(file)}
          />
        ))}
      </div>
    </div>
  );
}
