/**
 * DiffFileEntry - Single file in the file list.
 *
 * Displays:
 * - File name with change type badge (M/A/D/R)
 * - Mini diff bar (green/red proportional bar)
 * - Click to select
 */

import type { HighlightedFileDiff } from "../../hooks/useDiff";

interface DiffFileEntryProps {
  file: HighlightedFileDiff;
  isSelected: boolean;
  onClick: () => void;
}

export function DiffFileEntry({ file, isSelected, onClick }: DiffFileEntryProps) {
  const changeTypeBadge = getChangeTypeBadge(file.change_type);
  const totalChanges = file.additions + file.deletions;
  const additionPercent = totalChanges > 0 ? (file.additions / totalChanges) * 100 : 0;
  const deletionPercent = totalChanges > 0 ? (file.deletions / totalChanges) * 100 : 0;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${
        isSelected ? "bg-gray-800" : ""
      }`}
    >
      {/* File name with badge */}
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-mono px-1 rounded ${changeTypeBadge.className}`}>
          {changeTypeBadge.label}
        </span>
        <span className="text-sm truncate" title={file.path}>
          {file.path}
        </span>
      </div>

      {/* Mini diff bar */}
      {!file.is_binary && totalChanges > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden flex">
            <div
              className="bg-green-500 h-full"
              style={{ width: `${additionPercent}%` }}
            />
            <div
              className="bg-red-500 h-full"
              style={{ width: `${deletionPercent}%` }}
            />
          </div>
          <span>
            +{file.additions} -{file.deletions}
          </span>
        </div>
      )}

      {file.is_binary && <div className="text-xs text-gray-500">Binary file</div>}
    </button>
  );
}

function getChangeTypeBadge(changeType: string): { label: string; className: string } {
  switch (changeType) {
    case "added":
      return { label: "A", className: "bg-green-500/20 text-green-400" };
    case "modified":
      return { label: "M", className: "bg-blue-500/20 text-blue-400" };
    case "deleted":
      return { label: "D", className: "bg-red-500/20 text-red-400" };
    case "renamed":
      return { label: "R", className: "bg-yellow-500/20 text-yellow-400" };
    default:
      return { label: "?", className: "bg-gray-500/20 text-gray-400" };
  }
}
