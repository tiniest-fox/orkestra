//! Mobile-only toggleable file list overlay for diff views.
//! Renders a toggle button bar and an absolute-positioned file list panel.
//! Must be placed inside a `position: relative` ancestor for correct overlay positioning.

import type { HighlightedFileDiff } from "../../hooks/useDiff";
import { useIsMobile } from "../../hooks/useIsMobile";
import { DiffFileList } from "./DiffFileList";

interface MobileDiffFileListOverlayProps {
  files: HighlightedFileDiff[];
  activePath: string | null;
  onJumpTo: (path: string) => void;
  fileListOpen: boolean;
  onToggle: () => void;
}

export function MobileDiffFileListOverlay({
  files,
  activePath,
  onJumpTo,
  fileListOpen,
  onToggle,
}: MobileDiffFileListOverlayProps) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <>
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <button
          type="button"
          onClick={onToggle}
          onKeyDown={() => {}}
          className="flex items-center gap-1.5 font-mono text-forge-mono-sm text-text-tertiary hover:text-text-primary transition-colors"
        >
          <span className="font-semibold">{files.length}</span>
          <span>{files.length === 1 ? "file" : "files"}</span>
        </button>
      </div>
      {fileListOpen && (
        <>
          <button
            type="button"
            aria-label="Close file list"
            className="absolute inset-0 z-20"
            onClick={onToggle}
            onKeyDown={() => {}}
          />
          <div className="absolute top-0 left-0 bottom-0 w-64 z-30 bg-surface border-r border-border shadow-xl overflow-y-auto">
            <DiffFileList
              files={files}
              activePath={activePath}
              onJumpTo={(path) => {
                onJumpTo(path);
                onToggle();
              }}
            />
          </div>
        </>
      )}
    </>
  );
}
