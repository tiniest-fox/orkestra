/**
 * DiffFileEntry - Single file in the file list.
 *
 * Displays:
 * - File name (basename only)
 * - Colored status bubble (new/modified/deleted)
 */

import type { HighlightedFileDiff } from "../../hooks/useDiff";

interface DiffFileEntryProps {
  file: HighlightedFileDiff;
  isSelected: boolean;
  onClick: () => void;
}

export function DiffFileEntry({ file, isSelected, onClick }: DiffFileEntryProps) {
  const statusColor = getStatusColor(file.change_type);
  const fileName = file.path.split("/").pop() ?? file.path;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 flex items-center gap-1.5 transition-colors rounded-tl rounded-bl ${
        isSelected ? "bg-purple-100 dark:bg-purple-900" : "hover:bg-purple-50 dark:hover:bg-purple-950"
      }`}
    >
      {/* Status bubble */}
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor}`} />

      {/* File name */}
      <span className="text-xs text-stone-700 dark:text-stone-300 truncate" title={file.path}>
        {fileName}
      </span>
    </button>
  );
}

function getStatusColor(changeType: string): string {
  switch (changeType) {
    case "added":
      return "bg-success-500 dark:bg-success-400";
    case "modified":
      return "bg-info-500 dark:bg-info-400";
    case "deleted":
      return "bg-error-500 dark:bg-error-400";
    case "renamed":
      return "bg-warning-500 dark:bg-warning-400";
    default:
      return "bg-stone-400 dark:bg-stone-500";
  }
}
