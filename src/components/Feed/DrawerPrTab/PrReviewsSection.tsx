//! Reviews and comments section with checkboxes for selecting comments to address.

import { useCallback, useState } from "react";
import type { PrComment, PrReview } from "../../../types/workflow";

const REVIEW_STATE_CLASSES: Record<string, string> = {
  APPROVED: "text-status-success",
  CHANGES_REQUESTED: "text-status-error",
  COMMENTED: "text-text-tertiary",
  PENDING: "text-text-quaternary",
};

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  PENDING: "pending",
};

interface PrReviewsSectionProps {
  reviewsWithComments: Array<{ review: PrReview; comments: PrComment[] }>;
  standaloneComments: PrComment[];
  allComments: PrComment[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  suppressed: boolean;
}

export function PrReviewsSection({
  reviewsWithComments,
  standaloneComments,
  allComments,
  selectedIds,
  onToggle,
  suppressed,
}: PrReviewsSectionProps) {
  const selectionCount = selectedIds.size;

  const [expandedOutdated, setExpandedOutdated] = useState<Set<number>>(new Set());

  const toggleOutdatedExpand = useCallback((id: number) => {
    setExpandedOutdated((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  return (
    <div className={suppressed ? "opacity-50 pointer-events-none" : ""}>
      <div className="px-6 pt-4 pb-2 flex items-center justify-between">
        <span className="font-mono text-forge-mono-label font-semibold tracking-[0.08em] uppercase text-text-quaternary">
          Reviews
        </span>
        {suppressed && (
          <span className="font-mono text-forge-mono-label text-status-warning">
            resolve conflicts first
          </span>
        )}
      </div>

      {!suppressed && selectionCount > 0 && (
        <div className="mx-6 mb-3 px-3 py-2 rounded bg-canvas border border-border font-mono text-forge-mono-label text-text-secondary">
          {selectionCount} of {allComments.filter((c) => !c.outdated).length} comment
          {allComments.filter((c) => !c.outdated).length !== 1 ? "s" : ""} selected to address
        </div>
      )}

      {reviewsWithComments.map(({ review, comments }) => (
        <div key={review.id} className="px-6 mb-4">
          <ReviewHeader review={review} />
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              selected={selectedIds.has(comment.id)}
              onToggle={onToggle}
              suppressed={suppressed}
              dimmed={selectionCount > 0 && !selectedIds.has(comment.id)}
              collapsed={comment.outdated && !expandedOutdated.has(comment.id)}
              onToggleCollapse={() => toggleOutdatedExpand(comment.id)}
            />
          ))}
        </div>
      ))}

      {standaloneComments.length > 0 && (
        <div className="px-6 mb-4">
          {standaloneComments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              selected={selectedIds.has(comment.id)}
              onToggle={onToggle}
              suppressed={suppressed}
              dimmed={selectionCount > 0 && !selectedIds.has(comment.id)}
              collapsed={comment.outdated && !expandedOutdated.has(comment.id)}
              onToggleCollapse={() => toggleOutdatedExpand(comment.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewHeader({ review }: { review: PrReview }) {
  const body = review.body?.trim();
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-forge-mono-sm font-medium text-text-secondary">
          {review.author}
        </span>
        <span
          className={`font-mono text-forge-mono-label ${REVIEW_STATE_CLASSES[review.state] ?? "text-text-quaternary"}`}
        >
          {REVIEW_STATE_LABELS[review.state] ?? review.state.toLowerCase()}
        </span>
      </div>
      {body && (
        <div className="mt-1 text-forge-body text-text-primary whitespace-pre-wrap">{body}</div>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  selected,
  onToggle,
  suppressed,
  dimmed,
  collapsed,
  onToggleCollapse,
}: {
  comment: PrComment;
  selected: boolean;
  onToggle: (id: number) => void;
  suppressed: boolean;
  dimmed: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex items-center gap-2 py-1.5 px-3 rounded-lg mb-1.5 opacity-45 cursor-pointer w-full text-left"
      >
        {comment.path && (
          <span className="font-mono text-forge-mono-label text-text-quaternary truncate">
            {comment.path}
            {comment.line != null ? `:${comment.line}` : ""}
          </span>
        )}
        <span className="font-mono text-forge-mono-label text-text-quaternary">outdated</span>
      </button>
    );
  }

  if (comment.outdated) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        className={`flex gap-3 py-2.5 px-3 rounded-lg mb-1.5 border border-transparent cursor-pointer transition-all w-full text-left ${dimmed ? "opacity-45" : "opacity-75"}`}
      >
        <div className="min-w-0 flex-1">
          {comment.path && (
            <div className="font-mono text-forge-mono-label text-text-quaternary mb-1 truncate flex items-center gap-2">
              <span>
                {comment.path}
                {comment.line != null ? `:${comment.line}` : ""}
              </span>
              <span className="text-text-quaternary">outdated</span>
            </div>
          )}
          <p className="font-sans text-forge-body text-text-secondary leading-relaxed break-words">
            {comment.body}
          </p>
          <div className="font-mono text-forge-mono-label text-text-quaternary mt-1">
            {comment.author}
          </div>
        </div>
      </button>
    );
  }

  return (
    <label
      className={`flex gap-3 py-2.5 px-3 rounded-lg mb-1.5 border cursor-pointer transition-all ${
        selected ? "bg-canvas border-border" : "border-transparent"
      } ${dimmed ? "opacity-45" : "opacity-100"}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(comment.id)}
        disabled={suppressed}
        className="mt-0.5 shrink-0 accent-status-success"
      />
      <div className="min-w-0 flex-1">
        {comment.path && (
          <div className="font-mono text-forge-mono-label text-text-quaternary mb-1 truncate">
            {comment.path}
            {comment.line != null ? `:${comment.line}` : ""}
          </div>
        )}
        <p className="font-sans text-forge-body text-text-secondary leading-relaxed break-words">
          {comment.body}
        </p>
        <div className="font-mono text-forge-mono-label text-text-quaternary mt-1">
          {comment.author}
        </div>
      </div>
    </label>
  );
}
