// Activity log — iteration history rendered as a stage-grouped timeline.

import { History } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type {
  IterationTrigger,
  WorkflowIteration,
  WorkflowOutcome,
  WorkflowQuestionAnswer,
} from "../../types/workflow";
import { PROSE_CLASSES } from "../../utils/prose";
import { EmptyState } from "../ui/EmptyState";
import { richContentComponents, richContentPlugins } from "../ui/RichContent";
import { OutcomeBadge } from "./OutcomeBadge";

// ============================================================================
// Public component
// ============================================================================

interface ActivityLogProps {
  iterations: WorkflowIteration[];
}

export function ActivityLog({ iterations }: ActivityLogProps) {
  if (iterations.length === 0) {
    return <EmptyState icon={History} message="No activity yet." className="h-full" />;
  }

  const runs = consecutiveRuns(iterations);

  return (
    <div className="px-5 py-5 space-y-5">
      {runs.map((run, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: run order is stable
        <div key={i}>
          <div className="font-mono text-forge-mono-label text-text-quaternary uppercase tracking-widest mb-2">
            {run.stage}
          </div>
          <div className="border-l-2 border-canvas ml-[3px] pl-4 space-y-4">
            {run.iterations.map((iter) => (
              <IterationEntry key={iter.id} iteration={iter} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function consecutiveRuns(
  iterations: WorkflowIteration[],
): { stage: string; iterations: WorkflowIteration[] }[] {
  const runs: { stage: string; iterations: WorkflowIteration[] }[] = [];
  for (const iter of iterations) {
    const last = runs[runs.length - 1];
    if (last && last.stage === iter.stage) {
      last.iterations.push(iter);
    } else {
      runs.push({ stage: iter.stage, iterations: [iter] });
    }
  }
  return runs;
}

// ============================================================================
// Iteration entry
// ============================================================================

function IterationEntry({ iteration }: { iteration: WorkflowIteration }) {
  const duration = formatDuration(iteration.started_at, iteration.ended_at);

  return (
    <div>
      {iteration.incoming_context && <ContextCallout trigger={iteration.incoming_context} />}
      <div className="flex items-center gap-2">
        <OutcomeDot outcome={iteration.outcome} />
        <span className="font-mono text-forge-mono-label text-text-quaternary">
          #{iteration.iteration_number}
        </span>
        <OutcomeBadge outcome={iteration.outcome} />
        {duration && (
          <span className="font-mono text-forge-mono-label text-text-quaternary ml-auto">
            {duration}
          </span>
        )}
      </div>
      {iteration.activity_log && (
        <div className={`text-forge-body mt-2 ${PROSE_CLASSES}`}>
          <ReactMarkdown remarkPlugins={richContentPlugins} components={richContentComponents}>
            {iteration.activity_log}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Outcome dot + badge
// ============================================================================

function OutcomeDot({ outcome }: { outcome?: WorkflowOutcome }) {
  const color = outcome == null ? "bg-canvas" : dotColor(outcome);
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />;
}

function dotColor(outcome: WorkflowOutcome): string {
  switch (outcome.type) {
    case "approved":
    case "completed":
      return "bg-status-success";
    case "rejected":
    case "rejection":
    case "awaiting_rejection_review":
    case "interrupted":
      return "bg-status-warning";
    case "agent_error":
    case "spawn_failed":
    case "gate_failed":
    case "commit_failed":
    case "integration_failed":
      return "bg-status-error";
    case "awaiting_answers":
      return "bg-status-info";
    case "blocked":
    case "skipped":
      return "bg-text-quaternary";
    default:
      return "bg-canvas";
  }
}

// ============================================================================
// Context callout
// ============================================================================

function ContextCallout({ trigger }: { trigger: IterationTrigger }) {
  const info = calloutInfo(trigger);
  if (!info) return null;

  return (
    <div className={`border-l-2 ${info.borderColor} bg-canvas rounded-r px-3 py-2 mb-3`}>
      <div className="font-mono text-forge-mono-label text-text-quaternary uppercase tracking-wider mb-1">
        {info.label}
      </div>
      <div className={`text-forge-body text-text-tertiary ${PROSE_CLASSES}`}>
        <ReactMarkdown remarkPlugins={richContentPlugins} components={richContentComponents}>
          {info.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function calloutInfo(
  trigger: IterationTrigger,
): { label: string; content: string; borderColor: string } | null {
  switch (trigger.type) {
    case "feedback":
      return { label: "Feedback", content: trigger.feedback, borderColor: "border-status-warning" };
    case "answers":
      return {
        label: "Questions Answered",
        content: answersContent(trigger.answers),
        borderColor: "border-status-info",
      };
    case "integration":
      return {
        label: "Integration Note",
        content: trigger.message,
        borderColor: "border-canvas",
      };
    case "gate_failure":
      return { label: "Gate Failed", content: trigger.error, borderColor: "border-status-error" };
    case "interrupted":
      return null;
    default:
      return null;
  }
}

function answersContent(answers: WorkflowQuestionAnswer[]): string {
  if (answers.length === 0) return "Answers provided.";
  return answers.map((a) => `- ${a.question}\n  - ${a.answer}`).join("\n\n");
}

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(startedAt: string, endedAt?: string): string | null {
  if (!endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return "< 1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
