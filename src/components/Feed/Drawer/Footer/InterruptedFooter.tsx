//! Footer for the interrupted state — resume button.

import { Button } from "../../../ui/Button";
import { FooterBar } from "./FooterBar";

interface InterruptedFooterProps {
  resuming: boolean;
  onResume: () => void;
}

export function InterruptedFooter({ resuming, onResume }: InterruptedFooterProps) {
  return (
    <FooterBar>
      <Button variant="primary" onClick={onResume} disabled={resuming}>
        {resuming ? "Resuming…" : "Resume"}
      </Button>
    </FooterBar>
  );
}
