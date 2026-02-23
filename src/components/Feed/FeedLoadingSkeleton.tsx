//! Loading skeleton for the Feed view — shown while config or tasks are loading.
//!
//! Mirrors the Feed frame (header + content area + status footer) so the
//! transition to the live view is seamless.

export function FeedLoadingSkeleton() {
  return (
    <div className="forge-theme w-screen h-screen overflow-clip flex flex-col">
      {/* Header — same structure as FeedHeader, no metrics */}
      <div className="flex items-center justify-between px-6 h-11 border-b border-[var(--border)] bg-white shrink-0">
        <span className="font-forge-sans text-[13px] font-bold tracking-[0.06em] uppercase text-[var(--text-0)] select-none">
          Orkestra
        </span>
        <kbd className="font-forge-mono text-[10px] font-medium text-[var(--text-3)] bg-[var(--surface-2)] border border-[var(--border)] rounded px-1.5 py-0.5 leading-none select-none opacity-50">
          cmd+k
        </kbd>
      </div>

      {/* Body — spinner centered where the task list would be */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-[var(--canvas)]">
        <div className="w-[18px] h-[18px] rounded-full border-2 border-[var(--border)] border-t-[var(--text-2)] animate-spin" />
      </div>

      {/* Footer — same dimensions as FeedStatusLine, empty */}
      <div className="h-7 border-t border-[var(--border)] bg-white shrink-0" />
    </div>
  );
}
