//! Forge-themed file list entry — name, status dot, jump-nav highlight.

import { useEffect, useRef } from "react";
import type { HighlightedFileDiff } from "../../../hooks/useDiff";

interface ForgeDiffFileEntryProps {
  file: HighlightedFileDiff;
  name: string;
  depth: number;
  isActive: boolean;
  onClick: () => void;
}

export function ForgeDiffFileEntry({ file, name, depth, isActive, onClick }: ForgeDiffFileEntryProps) {
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
        isActive
          ? "bg-[var(--surface-2)]"
          : "hover:bg-[var(--surface-hover)]"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor}`} />
      <span
        className={`font-forge-mono text-forge-mono-sm truncate ${isActive ? "text-[var(--text-0)] font-medium" : "text-[var(--text-1)]"}`}
        title={file.path}
      >
        {name}
      </span>
    </button>
  );
}

function getStatusColor(changeType: string): string {
  switch (changeType) {
    case "added":    return "bg-[var(--green)]";
    case "modified": return "bg-[var(--blue)]";
    case "deleted":  return "bg-[var(--red)]";
    case "renamed":  return "bg-[var(--amber)]";
    default:         return "bg-[var(--text-3)]";
  }
}
