//! Footer shown when draft line comments exist and the diff tab is active.

import { Button } from "../../../ui/Button";
import { FooterBar } from "./FooterBar";

interface LineCommentsFooterProps {
  draftCount: number;
  guidance: string;
  onGuidanceChange: (v: string) => void;
  loading: boolean;
  error: string | null;
  onSubmit: () => void;
  onClear: () => void;
}

export function LineCommentsFooter({
  draftCount,
  guidance,
  onGuidanceChange,
  loading,
  error,
  onSubmit,
  onClear,
}: LineCommentsFooterProps) {
  return (
    <FooterBar className="flex-col h-auto py-3 px-4 gap-2">
      <textarea
        value={guidance}
        onChange={(e) => onGuidanceChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
          }
        }}
        placeholder="Add general guidance..."
        rows={2}
        className="w-full font-sans text-forge-body text-text-primary placeholder:text-text-quaternary bg-surface-2 border border-border rounded-panel-sm px-3 py-2 resize-none focus:outline-none focus:border-text-tertiary transition-colors"
      />
      {error && <div className="text-status-error font-sans text-forge-mono-label">{error}</div>}
      <div className="flex gap-2">
        <Button variant="merge" fullWidth onClick={onSubmit} disabled={loading}>
          {loading ? "Submitting…" : `Submit ${draftCount} comment${draftCount !== 1 ? "s" : ""}`}
        </Button>
        <Button variant="secondary" fullWidth onClick={onClear} disabled={loading}>
          Clear all
        </Button>
      </div>
    </FooterBar>
  );
}
