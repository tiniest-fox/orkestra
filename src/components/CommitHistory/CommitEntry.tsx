import type { CommitInfo } from "../../types/workflow";

interface CommitEntryProps {
  commit: CommitInfo;
  fileCount: number | null;
  isSelected: boolean;
  onSelect: (hash: string) => void;
}

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (diffMs < minute) {
    return "just now";
  }
  if (diffMs < hour) {
    const mins = Math.floor(diffMs / minute);
    return `${mins}m ago`;
  }
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    return `${hours}h ago`;
  }
  if (diffMs < week) {
    const days = Math.floor(diffMs / day);
    return `${days}d ago`;
  }
  if (diffMs < month) {
    const weeks = Math.floor(diffMs / week);
    return `${weeks}w ago`;
  }
  if (diffMs < year) {
    const months = Math.floor(diffMs / month);
    return `${months}mo ago`;
  }
  const years = Math.floor(diffMs / year);
  return `${years}y ago`;
}

export function CommitEntry({ commit, fileCount, isSelected, onSelect }: CommitEntryProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(commit.hash)}
      className={`w-full text-left px-3 py-2.5 border-b border-stone-100 dark:border-stone-800 transition-colors ${
        isSelected
          ? "bg-orange-50 dark:bg-orange-900/20"
          : "hover:bg-stone-50 dark:hover:bg-stone-800/50"
      }`}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <code className="text-xs font-mono text-orange-600 dark:text-orange-400">
          {commit.hash}
        </code>
        <span className="text-xs text-stone-400 dark:text-stone-500">
          {formatRelativeTime(commit.timestamp)}
        </span>
      </div>
      <div className="text-sm text-stone-800 dark:text-stone-200 truncate">{commit.message}</div>
      <div className="flex items-center gap-2 mt-0.5 text-xs text-stone-400 dark:text-stone-500">
        <span>{commit.author}</span>
        <span>&middot;</span>
        {fileCount !== null ? (
          <span>
            {fileCount} {fileCount === 1 ? "file" : "files"}
          </span>
        ) : (
          <span className="inline-block h-3 w-12 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
        )}
      </div>
    </button>
  );
}
