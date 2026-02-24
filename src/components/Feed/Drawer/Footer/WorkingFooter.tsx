//! Footer for the working state — interrupt button.

import { Button } from "../../../ui/Button";
import { FooterBar } from "./FooterBar";

interface WorkingFooterProps {
  interrupting: boolean;
  onInterrupt: () => void;
}

export function WorkingFooter({ interrupting, onInterrupt }: WorkingFooterProps) {
  return (
    <FooterBar>
      <Button variant="secondary" hotkey="i" onClick={onInterrupt} disabled={interrupting}>
        {interrupting ? "Interrupting…" : "Interrupt"}
      </Button>
    </FooterBar>
  );
}
