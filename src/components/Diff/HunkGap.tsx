// HunkGap — expand context button rendered between/above/below diff hunks.

interface HunkGapProps {
  gapSize: number | null; // lines in gap; null = below last hunk (unknown size)
  position: "above" | "between" | "below";
  onExpand: (amount: number) => void;
}

export function HunkGap({ gapSize, position, onExpand }: HunkGapProps) {
  // Empty gap — nothing to show
  if (gapSize === 0) return null;

  const btnClass =
    "w-full flex items-center gap-2 px-4 py-0.5 text-forge-mono-sm text-text-tertiary bg-canvas hover:text-text-secondary hover:bg-surface-2 transition-colors cursor-pointer border-none outline-none select-none";

  if (position === "above") {
    const amount = gapSize ?? 10;
    return (
      <button type="button" className={btnClass} onClick={() => onExpand(Math.min(amount, 10))}>
        <span className="flex-1 border-t border-border" />
        <span>↑ {gapSize !== null ? `${gapSize} lines above` : "more above"}</span>
        <span className="flex-1 border-t border-border" />
      </button>
    );
  }

  if (position === "below") {
    return (
      <button type="button" className={btnClass} onClick={() => onExpand(10)}>
        <span className="flex-1 border-t border-border" />
        <span>↓ more below</span>
        <span className="flex-1 border-t border-border" />
      </button>
    );
  }

  // position === "between"
  if (gapSize !== null && gapSize <= 10) {
    // Small gap — single click closes it
    return (
      <button type="button" className={btnClass} onClick={() => onExpand(Math.ceil(gapSize / 2))}>
        <span className="flex-1 border-t border-border" />
        <span>↕ {gapSize} lines</span>
        <span className="flex-1 border-t border-border" />
      </button>
    );
  }

  // Large or unknown gap — two buttons
  return (
    <div className="flex flex-col">
      <button type="button" className={btnClass} onClick={() => onExpand(10)}>
        <span className="flex-1 border-t border-border" />
        <span>↓ 10 more</span>
        <span className="flex-1 border-t border-border" />
      </button>
      <button type="button" className={btnClass} onClick={() => onExpand(10)}>
        <span className="flex-1 border-t border-border" />
        <span>↑ 10 more</span>
        <span className="flex-1 border-t border-border" />
      </button>
    </div>
  );
}
