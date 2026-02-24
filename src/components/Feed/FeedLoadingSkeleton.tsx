//! Loading skeleton for the Feed view — shown while config or tasks are loading.
//!
//! Mirrors the Feed frame (header + content area + status footer) so the
//! transition to the live view is seamless.

export function FeedLoadingSkeleton() {
  return (
    <div className="w-screen h-screen overflow-clip flex flex-col">
      {/* Header — same structure as FeedHeader, no metrics */}
      <div className="flex items-center justify-between px-6 h-11 border-b border-border bg-surface shrink-0">
        <span className="font-sans text-[13px] font-bold tracking-[0.06em] uppercase text-text-primary select-none">
          Orkestra
        </span>
        <kbd className="font-mono text-[10px] font-medium text-text-quaternary bg-canvas border border-border rounded px-1.5 py-0.5 leading-none select-none opacity-50">
          cmd+k
        </kbd>
      </div>

      {/* Body — spinner centered where the task list would be */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-canvas">
        <div className="w-[18px] h-[18px] rounded-full border-2 border-border border-t-text-tertiary animate-spin" />
      </div>

      {/* Footer — same dimensions as FeedStatusLine, empty */}
      <div className="h-7 border-t border-border bg-surface shrink-0" />
    </div>
  );
}
