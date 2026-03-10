// Floating find bar for searching within a diff view.

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { IconButton } from "../ui/IconButton";

interface DiffFindBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  currentIndex: number;
  count: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function DiffFindBar({
  query,
  onQueryChange,
  currentIndex,
  count,
  onNext,
  onPrev,
  onClose,
}: DiffFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      onPrev();
    } else if (e.key === "Enter") {
      e.preventDefault();
      onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  const matchLabel = count === 0 ? "No results" : `${currentIndex + 1} of ${count}`;

  return (
    <div className="absolute top-2 right-2 z-30 flex items-center gap-1.5 px-2 py-1.5 bg-surface border border-border rounded-panel-sm shadow-lg font-sans text-forge-body">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in diff…"
        className="w-44 bg-transparent outline-none text-text-primary placeholder:text-text-quaternary text-[12px]"
      />
      <span className="text-[11px] text-text-quaternary shrink-0 min-w-[52px] text-right">
        {matchLabel}
      </span>
      <IconButton
        icon={<ChevronUp size={14} />}
        aria-label="Previous match"
        size="sm"
        onClick={onPrev}
        disabled={count === 0}
      />
      <IconButton
        icon={<ChevronDown size={14} />}
        aria-label="Next match"
        size="sm"
        onClick={onNext}
        disabled={count === 0}
      />
      <IconButton icon={<X size={14} />} aria-label="Close find bar" size="sm" onClick={onClose} />
    </div>
  );
}
