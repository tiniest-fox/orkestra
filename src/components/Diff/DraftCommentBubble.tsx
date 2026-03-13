//! Inline display of a saved draft comment below a diff line.

import { MessageSquare, X } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import type { DraftComment } from "./types";

interface DraftCommentBubbleProps {
  comment: DraftComment;
  onDelete: (id: string) => void;
}

export function DraftCommentBubble({ comment, onDelete }: DraftCommentBubbleProps) {
  return (
    <div className="bg-surface border border-border rounded-panel-sm mx-2 my-1 p-2 flex items-start gap-2">
      <MessageSquare className="w-4 h-4 mt-0.5 shrink-0 text-accent mx-1" />
      <div className="flex-1 min-w-0">
        <div className="font-sans text-forge-body text-text-primary whitespace-pre-wrap">
          {comment.body}
        </div>
      </div>
      <IconButton
        icon={<X />}
        aria-label="Delete draft comment"
        size="sm"
        onClick={() => onDelete(comment.id)}
      />
    </div>
  );
}
