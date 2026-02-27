//! Inline display of a saved draft comment below a diff line.

import { X } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import type { DraftComment } from "./types";

interface DraftCommentBubbleProps {
  comment: DraftComment;
  onDelete: (id: string) => void;
}

export function DraftCommentBubble({ comment, onDelete }: DraftCommentBubbleProps) {
  return (
    <div className="bg-surface-2 border-l-2 border-accent px-4 py-2 flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="font-sans text-forge-mono-label text-text-quaternary mb-0.5">
          Draft comment
        </div>
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
