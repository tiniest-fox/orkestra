//! Footer for the waiting-on-children state — subtask progress summary.

import { FooterBar } from "./FooterBar";

interface WaitingFooterProps {
  progress: { done: number; total: number; failed: number };
}

export function WaitingFooter({ progress }: WaitingFooterProps) {
  return (
    <FooterBar className="gap-2">
      <span className="font-mono text-[11px] text-text-tertiary">
        {progress.done} of {progress.total} complete
      </span>
      {progress.failed > 0 && (
        <span className="ml-auto font-mono text-[11px] text-status-error">
          {progress.failed} failed
        </span>
      )}
    </FooterBar>
  );
}
