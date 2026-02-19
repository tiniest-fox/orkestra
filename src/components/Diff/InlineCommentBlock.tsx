/**
 * InlineCommentBlock - Renders PR comments inline below a diff line.
 *
 * Displays one or more PR comments with distinctive info-tinted styling
 * to visually separate them from diff content.
 */

import type { PrComment } from "../../types/workflow";
import { formatTimestamp } from "../../utils/formatters";

interface InlineCommentBlockProps {
  comments: PrComment[];
}

export function InlineCommentBlock({ comments }: InlineCommentBlockProps) {
  if (comments.length === 0) {
    return null;
  }

  return (
    <div className="ml-20 my-1">
      {comments.map((comment) => (
        <div
          key={comment.id}
          className="bg-info-50 dark:bg-info-950/50 border-l-2 border-info-400 dark:border-info-600 px-3 py-2 mb-1 last:mb-0"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm text-stone-700 dark:text-stone-300">
              {comment.author}
            </span>
            <span className="text-xs text-stone-500 dark:text-stone-400">
              {formatTimestamp(comment.created_at)}
            </span>
          </div>
          <div className="text-sm text-stone-600 dark:text-stone-400 whitespace-pre-wrap">
            {comment.body}
          </div>
        </div>
      ))}
    </div>
  );
}
