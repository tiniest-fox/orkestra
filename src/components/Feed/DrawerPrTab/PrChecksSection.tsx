//! CI checks section — compact summary when all pass, full list with selection otherwise.

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
  selectedCheckNames: Set<string>;
  onToggleCheck: (name: string) => void;
  suppressed: boolean;
}

export function PrChecksSection({
  checks,
  allPassing,
  compact,
  selectedCheckNames,
  onToggleCheck,
  suppressed,
}: PrChecksSectionProps) {
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

  const hasSelection = selectedCheckNames.size > 0;

  return (
    <div className="border-b border-border">
      <div className="px-6 pt-4 pb-2 font-mono text-[10px] font-semibold tracking-[0.08em] uppercase text-text-quaternary">
        Checks
      </div>
      <div className="px-6 pb-2">
        {checks.map((check) => {
          if (check.status === "failure") {
            return (
              <FailingCheckRow
                key={check.name}
                check={check}
                selected={selectedCheckNames.has(check.name)}
                onToggle={onToggleCheck}
                suppressed={suppressed}
                dimmed={hasSelection && !selectedCheckNames.has(check.name)}
              />
            );
          }
          return <PassingCheckRow key={check.name} check={check} dimmed={hasSelection} />;
        })}
      </div>
    </div>
  );
}

function FailingCheckRow({
  check,
  selected,
  onToggle,
  suppressed,
  dimmed,
}: {
  check: PrCheck;
  selected: boolean;
  onToggle: (name: string) => void;
  suppressed: boolean;
  dimmed: boolean;
}) {
  const iconInfo = CHECK_ICON_CLASSES[check.status] ?? { icon: "·", color: "text-status-warning" };

  return (
    <label
      className={`flex gap-3 py-2.5 px-3 rounded-lg mb-1.5 border cursor-pointer transition-all ${
        selected ? "bg-canvas border-border" : "border-transparent"
      } ${dimmed ? "opacity-45" : "opacity-100"}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(check.name)}
        disabled={suppressed}
        className="mt-0.5 shrink-0 accent-status-success"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[12px] w-4 shrink-0 text-center ${iconInfo.color}`}>
            {iconInfo.icon}
          </span>
          <span className="font-mono text-[11px] text-text-secondary flex-1 min-w-0 truncate">
            {check.name}
          </span>
        </div>
        {check.summary && (
          <p className="font-mono text-[10px] text-text-quaternary mt-1 line-clamp-2">
            {check.summary}
          </p>
        )}
      </div>
    </label>
  );
}

function PassingCheckRow({ check, dimmed }: { check: PrCheck; dimmed: boolean }) {
  const isPending = check.status === "pending";
  const iconInfo = CHECK_ICON_CLASSES[check.status] ?? { icon: "·", color: "text-status-warning" };

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 mb-1.5 ${dimmed ? "opacity-45" : "opacity-100"}`}
    >
      <span className={`font-mono text-[12px] w-4 shrink-0 text-center ${iconInfo.color}`}>
        {iconInfo.icon}
      </span>
      <span className="font-mono text-[11px] text-text-secondary flex-1 min-w-0 truncate">
        {check.name}
      </span>
      {isPending && <span className="font-mono text-[10px] text-status-warning">running</span>}
    </div>
  );
}
