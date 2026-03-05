//! Loading skeleton for the Feed view — shown while config or tasks are loading.
//!
//! Mirrors the Feed frame (header + content area + status footer) so the
//! transition to the live view is seamless.

import type { ReactNode } from "react";

interface FeedLoadingSkeletonProps {
  /** Status text shown below the spinner (e.g. "Connecting…", "Loading…"). */
  statusText?: string;
  /** Project name shown in the header with a dot separator, when available from cache. */
  projectName?: string;
  /** Extra content rendered below the status text (e.g. a Disconnect button). */
  children?: ReactNode;
}

export function FeedLoadingSkeleton({
  statusText = "Loading…",
  projectName,
  children,
}: FeedLoadingSkeletonProps = {}) {
  return (
    <div className="w-screen h-screen overflow-clip flex flex-col">
      {/* Header — same structure as FeedHeader, no metrics */}
      <div className="flex items-center justify-between px-6 h-11 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-sans text-[13px] font-bold tracking-[0.06em] uppercase text-text-primary select-none">
            Orkestra
          </span>
          {projectName && (
            <>
              <span className="text-text-quaternary select-none">·</span>
              <span className="text-[13px] font-semibold text-text-secondary select-none">
                {projectName}
              </span>
            </>
          )}
        </div>
        <kbd className="font-mono text-[10px] font-medium text-text-quaternary bg-canvas border border-border rounded px-1.5 py-0.5 leading-none select-none opacity-50">
          cmd+k
        </kbd>
      </div>

      {/* Body — spinner centered where the task list would be */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-canvas">
        <div className="w-[18px] h-[18px] rounded-full border-2 border-border border-t-text-tertiary animate-spin" />
        {statusText && <p className="text-[13px] text-text-tertiary select-none">{statusText}</p>}
        {children}
      </div>

      {/* Footer — same dimensions as FeedStatusLine, empty */}
      <div className="h-7 border-t border-border bg-surface shrink-0" />
    </div>
  );
}
