//! Footer for the working state — interrupt button.

import { Button } from "../../../ui/Button";
import { Kbd } from "../../../ui/Kbd";
import { FooterBar } from "./FooterBar";

interface WorkingFooterProps {
  interrupting: boolean;
  onInterrupt: () => void;
}

export function WorkingFooter({ interrupting, onInterrupt }: WorkingFooterProps) {
  return (
    <FooterBar>
      <Button variant="secondary" onClick={onInterrupt} disabled={interrupting} className="gap-2">
        {interrupting ? (
          "Interrupting…"
        ) : (
          <>
            <span>Interrupt</span>
            <Kbd>i</Kbd>
          </>
        )}
      </Button>
    </FooterBar>
  );
}
