//! CI checks section — compact summary when all pass, full list otherwise.

import type { PrCheck } from "../../../types/workflow";

const CHECK_ICON_CLASSES: Record<string, { icon: string; color: string }> = {
  success: { icon: "✓", color: "text-status-success" },
  failure: { icon: "✕", color: "text-status-error" },
  skipped: { icon: "–", color: "text-text-quaternary" },
};

interface PrChecksSectionProps {
  checks: PrCheck[];
  allPassing: boolean;
  compact: boolean;
}

export function PrChecksSection({ checks, allPassing, compact }: PrChecksSectionProps) {
  if (compact && allPassing) {
    return (
      <div className="px-6 py-3 border-b border-border flex items-center gap-2">
        <span className="text-status-success text-[12px]">✓</span>
        <span className="font-mono text-[10px] text-text-quaternary">
          All checks passed · {checks.length} {checks.length === 1 ? "run" : "runs"}
        </span>
      </div>
    );
  }

  return (
    <div className="border-b border-border">
      <div className="px-6 pt-4 pb-2 font-mono text-[10px] font-semibold tracking-[0.08em] uppercase text-text-quaternary">
        Checks
      </div>
      <div className="divide-y divide-border">
        {checks.map((check) => (
          <CheckRow key={check.name} check={check} />
        ))}
      </div>
    </div>
  );
}

function CheckRow({ check }: { check: PrCheck }) {
  const isFailing = check.status === "failure";
  const isPending = check.status === "pending";

  const iconInfo = CHECK_ICON_CLASSES[check.status] ?? { icon: "·", color: "text-status-warning" };

  return (
    <div className={`flex items-center gap-3 px-6 py-2.5${isFailing ? " bg-status-error-bg" : ""}`}>
      <span className={`font-mono text-[12px] w-4 shrink-0 text-center ${iconInfo.color}`}>
        {iconInfo.icon}
      </span>
      <span className="font-mono text-[11px] text-text-secondary flex-1 min-w-0 truncate">
        {check.name}
      </span>
      {isPending && <span className="font-mono text-[10px] text-status-warning">running</span>}
      {isFailing && check.conclusion && (
        <span className="font-mono text-[10px] text-status-error truncate max-w-[160px]">
          {check.conclusion}
        </span>
      )}
    </div>
  );
}
