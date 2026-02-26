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
    return { abbrevColor: "text-text-tertiary", glyph: null };
  }
  switch (outcome.type) {
    case "approved":
    case "completed":
      return { abbrevColor: "text-status-success", glyph: "✓" };
    case "rejected":
    case "rejection":
    case "awaiting_rejection_review":
      return { abbrevColor: "text-status-error", glyph: "×" };
    case "agent_error":
    case "spawn_failed":
    case "gate_failed":
    case "commit_failed":
    case "integration_failed":
      return { abbrevColor: "text-status-warning", glyph: "!" };
    case "interrupted":
    case "skipped":
    case "blocked":
      return { abbrevColor: "text-text-quaternary", glyph: "—" };
    case "awaiting_answers":
      return { abbrevColor: "text-status-info", glyph: "?" };
    default:
      return { abbrevColor: "text-text-tertiary", glyph: null };
  }
}

export function IterationChain({ iterations }: IterationChainProps) {
  const sorted = [...iterations].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const hidden = Math.max(0, sorted.length - 5);
  const visible = sorted.slice(-5);

  if (visible.length === 0) return null;

  return (
    <div className="min-w-0">
      <span className="whitespace-nowrap font-mono text-[10px] font-medium">
        {hidden > 0 && (
          <span className="text-text-quaternary">
            +{hidden}
            <span className="mx-[2px]">·</span>
          </span>
        )}
        {visible.map((iter, idx) => {
          const abbrev = abbreviateStage(iter.stage);
          const { abbrevColor, glyph } = outcomeStyle(iter.outcome);
          return (
            <span key={iter.id}>
              {idx > 0 && <span className="text-text-quaternary mx-[2px]">·</span>}
              <span className={abbrevColor}>{abbrev}</span>
              {glyph && <span className={`ml-[2px] ${abbrevColor}`}>{glyph}</span>}
            </span>
          );
        })}
      </span>
    </div>
  );
}
