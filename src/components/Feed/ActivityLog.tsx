//! Activity log — iteration history rendered as a stage-grouped timeline.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  IterationTrigger,
  WorkflowIteration,
  WorkflowOutcome,
  WorkflowQuestionAnswer,
} from "../../types/workflow";
import { FORGE_PROSE } from "../../utils/prose";

// ============================================================================
// Public component
// ============================================================================

interface ActivityLogProps {
  iterations: WorkflowIteration[];
}

export function ActivityLog({ iterations }: ActivityLogProps) {
  if (iterations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="font-forge-mono text-forge-mono-sm text-[var(--text-3)]">
          No activity yet.
        </span>
      </div>
    );
  }

  const runs = consecutiveRuns(iterations);

  return (
    <div className="px-5 py-5 space-y-5">
      {runs.map((run, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: run order is stable
        <div key={i}>
          <div className="font-forge-mono text-forge-mono-label text-[var(--text-3)] uppercase tracking-widest mb-2">
            {run.stage}
          </div>
          <div className="border-l-2 border-[var(--surface-3)] ml-[3px] pl-4 space-y-4">
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
        <span className="font-forge-mono text-forge-mono-label text-[var(--text-3)]">
          #{iteration.iteration_number}
        </span>
        <OutcomeBadge outcome={iteration.outcome} />
        {duration && (
          <span className="font-forge-mono text-forge-mono-label text-[var(--text-3)] ml-auto">
            {duration}
          </span>
        )}
      </div>
      {iteration.activity_log && (
        <div className={`text-forge-body mt-2 ${FORGE_PROSE}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{iteration.activity_log}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Outcome dot + badge
// ============================================================================

function OutcomeDot({ outcome }: { outcome?: WorkflowOutcome }) {
  const color = outcome == null ? "bg-[var(--surface-3)]" : dotColor(outcome);
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />;
}

function dotColor(outcome: WorkflowOutcome): string {
  switch (outcome.type) {
    case "approved":
    case "completed":
      return "bg-[var(--green)]";
    case "rejected":
    case "rejection":
    case "awaiting_rejection_review":
    case "interrupted":
      return "bg-[var(--amber)]";
    case "agent_error":
    case "spawn_failed":
    case "script_failed":
    case "commit_failed":
    case "integration_failed":
      return "bg-[var(--red)]";
    case "awaiting_answers":
      return "bg-[var(--blue)]";
    case "blocked":
    case "skipped":
      return "bg-[var(--text-3)]";
    default:
      return "bg-[var(--surface-3)]";
  }
}

function OutcomeBadge({ outcome }: { outcome?: WorkflowOutcome }) {
  if (!outcome) return null;
  const { label, color } = badgeLabel(outcome);
  return (
    <span
      className={`font-forge-mono text-forge-mono-label px-1.5 py-0.5 rounded bg-[var(--surface-2)] ${color}`}
    >
      {label}
    </span>
  );
}

function badgeLabel(outcome: WorkflowOutcome): { label: string; color: string } {
  switch (outcome.type) {
    case "approved":
      return { label: "Approved", color: "text-[var(--green)]" };
    case "completed":
      return { label: "Done", color: "text-[var(--green)]" };
    case "rejected":
    case "rejection":
      return { label: "Rejected", color: "text-[var(--amber)]" };
    case "awaiting_rejection_review":
      return { label: "Pending Review", color: "text-[var(--amber)]" };
    case "awaiting_answers":
      return { label: "Waiting", color: "text-[var(--blue)]" };
    case "interrupted":
      return { label: "Interrupted", color: "text-[var(--amber)]" };
    case "agent_error":
      return { label: "Error", color: "text-[var(--red)]" };
    case "spawn_failed":
      return { label: "Spawn Failed", color: "text-[var(--red)]" };
    case "script_failed":
      return { label: "Script Failed", color: "text-[var(--red)]" };
    case "commit_failed":
      return { label: "Commit Failed", color: "text-[var(--red)]" };
    case "integration_failed":
      return { label: "Merge Failed", color: "text-[var(--red)]" };
    case "blocked":
      return { label: "Blocked", color: "text-[var(--text-3)]" };
    case "skipped":
      return { label: "Skipped", color: "text-[var(--text-3)]" };
    default:
      return { label: "Unknown", color: "text-[var(--text-3)]" };
  }
}

// ============================================================================
// Context callout
// ============================================================================

function ContextCallout({ trigger }: { trigger: IterationTrigger }) {
  const info = calloutInfo(trigger);
  if (!info) return null;

  return (
    <div
      className={`border-l-2 ${info.borderColor} bg-[var(--surface-2)] rounded-r px-3 py-2 mb-3`}
    >
      <div className="font-forge-mono text-forge-mono-label text-[var(--text-3)] uppercase tracking-wider mb-1">
        {info.label}
      </div>
      <div className={`text-forge-body text-[var(--text-2)] ${FORGE_PROSE}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{info.content}</ReactMarkdown>
      </div>
    </div>
  );
}

function calloutInfo(
  trigger: IterationTrigger,
): { label: string; content: string; borderColor: string } | null {
  switch (trigger.type) {
    case "feedback":
      return { label: "Feedback", content: trigger.feedback, borderColor: "border-[var(--amber)]" };
    case "answers":
      return {
        label: "Questions Answered",
        content: answersContent(trigger.answers),
        borderColor: "border-[var(--blue)]",
      };
    case "integration":
      return {
        label: "Integration Note",
        content: trigger.message,
        borderColor: "border-[var(--surface-3)]",
      };
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
