// Mode badge — small label showing the rendering mode of a rich content block.

interface ModeBadgeProps {
  mode: string;
}

export function ModeBadge({ mode }: ModeBadgeProps) {
  return (
    <span className="absolute top-2 right-2 text-forge-mono-label font-mono uppercase tracking-wider text-text-quaternary bg-surface-2 px-1.5 py-0.5 rounded">
      {mode}
    </span>
  );
}
