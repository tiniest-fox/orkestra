//! Inline comment textarea that appears below a diff line when the user clicks "+".

import { useEffect, useRef, useState } from "react";

interface LineCommentInputProps {
  onSave: (body: string) => void;
  onCancel: () => void;
  /** Controlled value — when provided with onChange, uses controlled mode. */
  value?: string;
  /** Controlled onChange — when provided with value, uses controlled mode. */
  onChange?: (body: string) => void;
}

export function LineCommentInput({ onSave, onCancel, value, onChange }: LineCommentInputProps) {
  const [localBody, setLocalBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isControlled = value !== undefined && onChange !== undefined;
  const body = isControlled ? value : localBody;
  const setBody = isControlled ? onChange : setLocalBody;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (body.trim()) onSave(body.trim());
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
  }

  return (
    <div className="bg-surface-2 border border-border rounded-panel-sm mx-2 my-1 p-2 flex flex-col gap-2">
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment..."
        rows={2}
        className="w-full font-sans text-forge-body text-text-primary placeholder:text-text-quaternary bg-transparent resize-none focus:outline-none"
      />
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => onSave(body.trim())}
          disabled={!body.trim()}
          className="px-3 py-1 rounded-panel-sm font-sans text-forge-body font-medium bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 rounded-panel-sm font-sans text-forge-body font-medium bg-canvas border border-border text-text-secondary hover:bg-surface-2 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
