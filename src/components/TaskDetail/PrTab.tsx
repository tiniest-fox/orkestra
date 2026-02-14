/**
 * PR tab - displays pull request status, checks, and reviews.
 */

import {
  AlertCircle,
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  MessageCircle,
  XCircle,
} from "lucide-react";
import { usePrStatus } from "../../providers";
import type { PrCheck, PrReview } from "../../types/workflow";
import { Badge, FlexContainer, Link, Panel } from "../ui";

interface PrTabProps {
  prUrl: string;
  taskId: string;
}

export function PrTab({ prUrl, taskId }: PrTabProps) {
  const { getPrStatus, isLoading } = usePrStatus();
  const status = getPrStatus(taskId);
  const loading = isLoading(taskId);

  return (
    <FlexContainer direction="vertical" padded={true} gap={12}>
      {/* Header with state badge and link */}
      <Panel accent={stateToAccent(status?.state)} autoFill={false} padded={true}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StateBadge state={status?.state} isLoading={loading && !status} />
            {!status && loading && (
              <span className="text-sm text-stone-500 dark:text-stone-400">Loading...</span>
            )}
          </div>
          <Link href={prUrl} external className="text-sm">
            <ExternalLink className="w-4 h-4 inline mr-1" />
            View on GitHub
          </Link>
        </div>
      </Panel>

      {/* CI Checks section */}
      {status?.checks && status.checks.length > 0 && (
        <Panel autoFill={false} padded={true}>
          <h4 className="text-sm font-medium mb-2 text-stone-700 dark:text-stone-300">Checks</h4>
          <div className="space-y-1">
            {status.checks.map((check) => (
              <CheckRow key={check.name} check={check} />
            ))}
          </div>
        </Panel>
      )}

      {/* Reviews section */}
      {status?.reviews && status.reviews.length > 0 && (
        <Panel autoFill={false} padded={true}>
          <h4 className="text-sm font-medium mb-2 text-stone-700 dark:text-stone-300">Reviews</h4>
          <div className="space-y-1">
            {status.reviews.map((review) => (
              <ReviewRow key={review.author} review={review} />
            ))}
          </div>
        </Panel>
      )}

      {/* Empty state for no checks/reviews */}
      {status && status.checks.length === 0 && status.reviews.length === 0 && (
        <div className="text-sm text-stone-500 dark:text-stone-400 text-center py-4">
          No checks or reviews yet
        </div>
      )}
    </FlexContainer>
  );
}

function stateToAccent(state?: string): "none" | "info" | "warning" | "error" {
  if (!state) return "none";
  if (state === "merged") return "info";
  if (state === "closed") return "error";
  return "none"; // open
}

function StateBadge({ state, isLoading }: { state?: string; isLoading: boolean }) {
  if (isLoading && !state) {
    return <Badge variant="waiting">Loading...</Badge>;
  }
  const variant = state === "merged" ? "done" : state === "closed" ? "failed" : "working";
  const label = state ? state.charAt(0).toUpperCase() + state.slice(1) : "Unknown";
  return <Badge variant={variant}>{label}</Badge>;
}

function CheckRow({ check }: { check: PrCheck }) {
  const icon =
    check.status === "success" ? (
      <CheckCircle2 className="w-4 h-4 text-success-500" />
    ) : check.status === "failure" ? (
      <XCircle className="w-4 h-4 text-error-500" />
    ) : check.status === "pending" ? (
      <Loader2 className="w-4 h-4 text-stone-400 dark:text-stone-500 animate-spin" />
    ) : (
      <Circle className="w-4 h-4 text-stone-400 dark:text-stone-500" />
    );

  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span className="text-stone-700 dark:text-stone-300">{check.name}</span>
    </div>
  );
}

function ReviewRow({ review }: { review: PrReview }) {
  const normalizedState = review.state.toLowerCase();
  const icon =
    normalizedState === "approved" ? (
      <CheckCircle2 className="w-4 h-4 text-success-500" />
    ) : normalizedState === "changes_requested" ? (
      <AlertCircle className="w-4 h-4 text-warning-500" />
    ) : normalizedState === "commented" ? (
      <MessageCircle className="w-4 h-4 text-stone-400 dark:text-stone-500" />
    ) : (
      <Circle className="w-4 h-4 text-stone-400 dark:text-stone-500" />
    );

  const stateLabel =
    normalizedState === "approved"
      ? "approved"
      : normalizedState === "changes_requested"
        ? "requested changes"
        : normalizedState === "commented"
          ? "commented"
          : "pending";

  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span className="font-medium text-stone-700 dark:text-stone-300">{review.author}</span>
      <span className="text-stone-500 dark:text-stone-400">{stateLabel}</span>
    </div>
  );
}
