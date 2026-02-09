/**
 * Expandable content section for long text.
 */

import { useState } from "react";

interface ExpandableContentProps {
  content: string;
  /** Maximum length before truncation (default 200). */
  maxLength?: number;
  className?: string;
}

export function ExpandableContent({
  content,
  maxLength = 200,
  className = "",
}: ExpandableContentProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > maxLength;

  return (
    <div
      className={`text-xs text-stone-500 dark:text-stone-400 font-mono whitespace-pre-wrap break-words ${className}`}
    >
      {expanded || !isLong ? content : `${content.slice(0, maxLength)}...`}
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="ml-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
