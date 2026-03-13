// Filter bar for the service view — accent prompt and plain text input.

import type { RefObject } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";

interface ServiceFilterBarProps {
  filterText: string;
  onFilterChange: (text: string) => void;
  inputRef: RefObject<HTMLInputElement>;
}

export function ServiceFilterBar({ filterText, onFilterChange, inputRef }: ServiceFilterBarProps) {
  const isMobile = useIsMobile();

  return (
    <div
      className={`flex items-center ${isMobile ? "h-12" : "h-9"} px-6 bg-surface border-b border-border shrink-0`}
    >
      <span className="text-accent font-semibold font-mono text-forge-mono-md mr-2 select-none">
        &gt;
      </span>
      <input
        ref={inputRef}
        type="text"
        value={filterText}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="Filter projects..."
        className="flex-1 bg-transparent outline-none font-mono text-forge-mono-md text-text-primary placeholder:text-text-quaternary"
      />
    </div>
  );
}
