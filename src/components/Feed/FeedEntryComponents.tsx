// Shared log-entry display components used by FeedLogList and AssistantDrawer.

import { memo } from "react";

// ============================================================================
// Tool variant map
// ============================================================================

export const TOOL_VARIANTS = {
  tool: "text-text-tertiary",
  task: "text-accent",
  script: "text-text-tertiary",
} as const;

// ============================================================================
// Components
// ============================================================================

export const ToolLine = memo(function ToolLine({
  label,
  summary,
  variant,
}: {
  label: string;
  summary: string;
  variant: keyof typeof TOOL_VARIANTS;
}) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span
        className={`font-mono text-forge-mono-sm font-medium shrink-0 ${TOOL_VARIANTS[variant]}`}
      >
        {label}
      </span>
      {summary && (
        <span className="font-mono text-forge-mono-sm text-text-quaternary truncate min-w-0">
          {summary}
        </span>
      )}
    </div>
  );
});

export const ErrorLine = memo(function ErrorLine({ message }: { message: string }) {
  return (
    <div className="font-mono text-forge-mono-sm text-status-error py-2 border-l-2 border-status-error pl-2 my-2">
      {message}
    </div>
  );
});

export const ScriptOutputLine = memo(function ScriptOutputLine({ content }: { content: string }) {
  const trimmed = content.trimEnd();
  if (!trimmed) return null;
  return (
    <div className="font-mono text-forge-mono-sm text-text-tertiary py-[2px] whitespace-pre-wrap">
      {trimmed}
    </div>
  );
});
