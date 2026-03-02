//! FileHeaderContent — shared inner content for file path header buttons.

import { ChevronDown, ChevronRight } from "lucide-react";
import { Kbd } from "../ui/Kbd";

interface FileHeaderContentProps {
  path: string;
  oldPath: string | null;
  isCollapsed: boolean;
  /** Whether to show the collapse/expand keyboard shortcut badge. */
  showKbd: boolean;
}

export function FileHeaderContent({ path, oldPath, isCollapsed, showKbd }: FileHeaderContentProps) {
  return (
    <>
      <span className="flex-1 truncate">
        {path}
        {oldPath && <span className="text-text-quaternary ml-2">(renamed from {oldPath})</span>}
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        {showKbd && <Kbd>C</Kbd>}
        {isCollapsed ? (
          <ChevronRight size={13} className="text-text-quaternary" />
        ) : (
          <ChevronDown size={13} className="text-text-quaternary" />
        )}
      </span>
    </>
  );
}
