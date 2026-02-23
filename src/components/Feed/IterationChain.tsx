//! Iteration chain — compact mono glyph sequence showing stage history at a glance.

import type { WorkflowIteration, WorkflowOutcome } from "../../types/workflow";
import { abbreviateStage } from "../../utils/stageAbbreviation";

interface IterationChainProps {
  iterations: WorkflowIteration[];
}

interface OutcomeStyle {
  abbrevColor: string;
  glyph: string | null;
}

function outcomeStyle(outcome: WorkflowOutcome | undefined): OutcomeStyle {
  if (!outcome) {
    // In-progress: no glyph, active color.
    return { abbrevColor: "text-[var(--text-2)]", glyph: null };
  }
  switch (outcome.type) {
    case "approved":
    case "completed":
      return { abbrevColor: "text-[var(--green)]", glyph: "✓" };
    case "rejected":
    case "rejection":
    case "awaiting_rejection_review":
      return { abbrevColor: "text-[var(--red)]", glyph: "×" };
    case "agent_error":
    case "spawn_failed":
    case "script_failed":
    case "commit_failed":
    case "integration_failed":
      return { abbrevColor: "text-[var(--amber)]", glyph: "!" };
    case "interrupted":
    case "skipped":
    case "blocked":
      return { abbrevColor: "text-[var(--text-3)]", glyph: "—" };
    case "awaiting_answers":
      return { abbrevColor: "text-[var(--blue)]", glyph: "?" };
    default:
      return { abbrevColor: "text-[var(--text-2)]", glyph: null };
  }
}

export function IterationChain({ iterations }: IterationChainProps) {
  const sorted = [...iterations].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const hidden = Math.max(0, sorted.length - 5);
  const visible = sorted.slice(-5);

  if (visible.length === 0) return null;

  return (
    <div className="min-w-0">
      <span className="whitespace-nowrap font-forge-mono text-[10px] font-medium">
        {hidden > 0 && (
          <span className="text-[var(--text-3)]">
            +{hidden}
            <span className="mx-[2px]">·</span>
          </span>
        )}
        {visible.map((iter, idx) => {
          const abbrev = abbreviateStage(iter.stage);
          const { abbrevColor, glyph } = outcomeStyle(iter.outcome);
          return (
            <span key={iter.id}>
              {idx > 0 && <span className="text-[var(--text-3)] mx-[2px]">·</span>}
              <span className={abbrevColor}>{abbrev}</span>
              {glyph && <span className={`ml-[2px] ${abbrevColor}`}>{glyph}</span>}
            </span>
          );
        })}
      </span>
    </div>
  );
}
