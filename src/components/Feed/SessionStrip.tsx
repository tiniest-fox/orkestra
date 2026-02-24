//! Session strip — compact interactive chips showing the task's stage run history.

import type { WorkflowOutcome } from "../../types/workflow";
import { abbreviateStage } from "../../utils/stageAbbreviation";
import type { StageRun } from "../../utils/stageRuns";

interface SessionStripProps {
  runs: StageRun[];
  /** Index of the selected past run, or null for the current run. */
  selectedRunIdx: number | null;
  onSelect: (idx: number | null) => void;
  /** Accent color for the current-run chip (matches the drawer's accent). */
  accent: string;
  /** When the task is waiting on children, show this stage as an in-progress chip. */
  waitingStage?: string;
  isWaitingSelected?: boolean;
  onWaitingSelect?: () => void;
}

function runOutcomeStyle(run: StageRun): { glyph: string | null; color: string } {
  const lastIter = run.iterations[run.iterations.length - 1];
  const outcome: WorkflowOutcome | undefined = lastIter?.outcome;
  if (!outcome) return { glyph: null, color: "" };
  switch (outcome.type) {
    case "approved":
    case "completed":
      return { glyph: "✓", color: "text-status-success" };
    case "rejected":
    case "rejection":
    case "awaiting_rejection_review":
      return { glyph: "×", color: "text-status-error" };
    case "agent_error":
    case "spawn_failed":
    case "script_failed":
    case "commit_failed":
    case "integration_failed":
      return { glyph: "!", color: "text-status-warning" };
    case "awaiting_answers":
      return { glyph: "?", color: "text-status-info" };
    default:
      return { glyph: null, color: "" };
  }
}

export function SessionStrip({
  runs,
  selectedRunIdx,
  onSelect,
  accent,
  waitingStage,
  isWaitingSelected,
  onWaitingSelect,
}: SessionStripProps) {
  if (runs.length === 0 && !waitingStage) return null;

  const isViewingPast = selectedRunIdx !== null;
  // When a waiting chip is present it owns the "current" state, so existing
  // runs are always treated as past entries (only selected by explicit index).
  const runsArePast = !!waitingStage;

  return (
    <div className="min-w-0 overflow-hidden flex items-center gap-[3px] flex-shrink">
      {runs.map((run, realIdx) => {
        const isCurrent = run.isCurrentRun && !runsArePast;
        const isSelected = runsArePast
          ? selectedRunIdx === realIdx
          : isCurrent
            ? !isViewingPast
            : selectedRunIdx === realIdx;
        const { glyph, color } = runOutcomeStyle(run);
        const abbrev = abbreviateStage(run.stage).toUpperCase();

        // Current chip is also clickable when the stage has a final outcome (✓/×/!).
        // This allows navigating to the completed stage's content (e.g. breakdown on
        // a waiting-on-children task) without treating it as "you're already here".
        const clickable = !isCurrent || isViewingPast || glyph !== null;
        // When clicking the current chip while viewing a past run → return to current view.
        // All other clicks → navigate to that run's historical view.
        const onClick = clickable
          ? () => onSelect(isCurrent && isViewingPast ? null : realIdx)
          : undefined;

        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: realIdx is the run number, not array index
          <span key={realIdx} className="flex items-center gap-[3px]">
            {realIdx > 0 && (
              <span className="text-text-quaternary font-mono text-[9px] mx-[1px]">·</span>
            )}
            <Chip
              abbrev={abbrev}
              glyph={glyph}
              glyphColor={color}
              count={run.iterations.length}
              isCurrent={isCurrent}
              isSelected={isSelected}
              isViewingPast={isViewingPast}
              accent={accent}
              clickable={clickable}
              onClick={onClick}
            />
          </span>
        );
      })}
      {waitingStage && (
        <span className="flex items-center gap-[3px]">
          {runs.length > 0 && (
            <span className="text-text-quaternary font-mono text-[9px] mx-[1px]">·</span>
          )}
          <WaitingChip
            abbrev={abbreviateStage(waitingStage).toUpperCase()}
            isSelected={isWaitingSelected ?? false}
            accent={accent}
            onClick={onWaitingSelect}
          />
        </span>
      )}
    </div>
  );
}

// ============================================================================
// WaitingChip
// ============================================================================

interface WaitingChipProps {
  abbrev: string;
  isSelected: boolean;
  accent: string;
  onClick?: () => void;
}

function WaitingChip({ abbrev, isSelected, accent, onClick }: WaitingChipProps) {
  const base =
    "inline-flex items-center gap-[2px] px-[6px] py-[3px] rounded font-mono text-[10px] font-medium transition-colors border cursor-pointer";

  if (isSelected) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} text-text-primary`}
        style={{
          borderColor: accent,
          backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
        }}
      >
        <span>{abbrev}</span>
        <span className="text-[8px] opacity-60">…</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} border-border bg-canvas text-text-tertiary hover:bg-canvas hover:border-border hover:text-text-secondary`}
    >
      <span>{abbrev}</span>
      <span className="text-[8px] opacity-60">…</span>
    </button>
  );
}

// ============================================================================
// Chip
// ============================================================================

interface ChipProps {
  abbrev: string;
  glyph: string | null;
  glyphColor: string;
  count: number;
  isCurrent: boolean;
  isSelected: boolean;
  isViewingPast: boolean;
  accent: string;
  clickable: boolean;
  onClick?: () => void;
}

function Chip({
  abbrev,
  glyph,
  glyphColor,
  count,
  isCurrent,
  isSelected,
  isViewingPast,
  accent,
  clickable,
  onClick,
}: ChipProps) {
  // Base classes for all chips
  const base =
    "inline-flex items-center gap-[2px] px-[6px] py-[3px] rounded font-mono text-[10px] font-medium transition-colors border";

  let chipClass: string;
  let inlineStyle: React.CSSProperties | undefined;

  if (isSelected && isCurrent) {
    // Active current run: colored border + tinted bg using accent
    chipClass = `${base} text-text-primary cursor-default`;
    inlineStyle = {
      borderColor: accent,
      backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
    };
  } else if (isSelected) {
    // Selected past run
    chipClass = `${base} border-status-purple bg-status-purple-bg text-text-primary cursor-pointer`;
  } else if (isCurrent && isViewingPast) {
    // Current chip while viewing a past run — muted, clickable to return
    chipClass = `${base} border-border bg-canvas text-text-tertiary hover:text-text-secondary hover:border-border cursor-pointer`;
  } else {
    // Unselected past chip — always show as a button
    chipClass = `${base} border-border bg-canvas text-text-tertiary hover:bg-canvas hover:border-border hover:text-text-secondary cursor-pointer`;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={chipClass}
      style={inlineStyle}
    >
      <span>{abbrev}</span>
      {glyph && <span className={`text-[9px] ${glyphColor}`}>{glyph}</span>}
      {count > 1 && <span className="text-text-quaternary text-[9px] ml-[1px]">×{count}</span>}
    </button>
  );
}
