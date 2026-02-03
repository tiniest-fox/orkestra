/**
 * DiffFileEntry - Single file entry in the file list with change indicator and mini diff bar.
 */

import type { FileChangeType, HighlightedFileDiff } from "../../hooks/useDiff";

interface DiffFileEntryProps {
  file: HighlightedFileDiff;
  isSelected: boolean;
  onSelect: () => void;
}

function getChangeColor(changeType: FileChangeType): string {
  switch (changeType) {
    case "added":
      return "bg-green-500";
    case "modified":
      return "bg-orange-500";
    case "deleted":
      return "bg-red-500";
    case "renamed":
      return "bg-blue-500";
  }
}

export function DiffFileEntry({ file, isSelected, onSelect }: DiffFileEntryProps) {
  // Extract file name and directory path
  const lastSlash = file.path.lastIndexOf("/");
  const fileName = lastSlash === -1 ? file.path : file.path.slice(lastSlash + 1);
  const dirPath = lastSlash === -1 ? "" : file.path.slice(0, lastSlash);

  // Compute mini diff bar proportions
  const total = file.additions + file.deletions;
  const additionsPercent = total === 0 ? 0 : (file.additions / total) * 100;
  const deletionsPercent = total === 0 ? 0 : (file.deletions / total) * 100;

  // Bar colors
  let barContent: JSX.Element;
  if (file.change_type === "added") {
    barContent = <div className="h-full bg-green-500" />;
  } else if (file.change_type === "deleted") {
    barContent = <div className="h-full bg-red-500" />;
  } else if (total === 0) {
    barContent = <div className="h-full bg-stone-300 dark:bg-stone-700" />;
  } else {
    barContent = (
      <>
        <div className="h-full bg-green-500" style={{ width: `${additionsPercent}%` }} />
        <div className="h-full bg-red-500" style={{ width: `${deletionsPercent}%` }} />
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 flex flex-col gap-1 border-b border-stone-200 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors ${
        isSelected ? "bg-stone-200 dark:bg-stone-700" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Change type indicator */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getChangeColor(file.change_type)}`} />

        {/* File name */}
        <div className="font-semibold text-sm text-stone-800 dark:text-stone-100 truncate">
          {fileName}
        </div>
      </div>

      {/* Directory path */}
      {dirPath && (
        <div className="text-xs text-stone-500 dark:text-stone-400 truncate pl-4">{dirPath}</div>
      )}

      {/* Mini diff bar */}
      <div className="h-1 w-full max-w-[60px] flex rounded-sm overflow-hidden ml-4">
        {barContent}
      </div>
    </button>
  );
}
