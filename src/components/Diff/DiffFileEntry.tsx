//! Diff file list entry — name, status dot, jump-nav highlight.

import { useEffect, useRef } from "react";
import type { HighlightedFileDiff } from "../../hooks/useDiff";

interface DiffFileEntryProps {
  file: HighlightedFileDiff;
  name: string;
  depth: number;
  isActive: boolean;
  onClick: () => void;
}

export function DiffFileEntry({ file, name, depth, isActive, onClick }: DiffFileEntryProps) {
  const statusColor = getStatusColor(file.change_type);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isActive) {
      btnRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isActive]);

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={onClick}
      style={{ paddingLeft: depth * 12 + 8 }}
      className={`scroll-my-6 w-full text-left pr-2 py-1 flex items-center gap-1.5 transition-colors rounded-tl rounded-bl ${
        isActive ? "bg-surface-2" : "hover:bg-surface-hover"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor}`} />
      <span
        className={`font-mono text-forge-mono-sm truncate ${isActive ? "text-text-primary font-medium" : "text-text-secondary"}`}
        title={file.path}
      >
        {name}
      </span>
    </button>
  );
}

function getStatusColor(changeType: string): string {
  switch (changeType) {
    case "added":
      return "bg-status-success";
    case "modified":
      return "bg-status-info";
    case "deleted":
      return "bg-status-error";
    case "renamed":
      return "bg-status-warning";
    default:
      return "bg-text-quaternary";
  }
}
