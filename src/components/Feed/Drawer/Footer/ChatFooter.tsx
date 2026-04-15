// Footer action buttons for chat mode — Return to Work, Approve, and error display.

import { Button } from "../../../ui/Button";
import { FooterBar } from "./FooterBar";

interface ChatFooterProps {
  chatAgentActive: boolean;
  onReturnToWork: () => void;
  onApprove: () => void;
  loading: boolean;
  canApprove: boolean;
  chatError: string | null;
}

export function ChatFooter({
  chatAgentActive,
  onReturnToWork,
  onApprove,
  loading,
  canApprove,
  chatError,
}: ChatFooterProps) {
  return (
    <FooterBar>
      <Button variant="secondary" onClick={onReturnToWork} disabled={loading || chatAgentActive}>
        Return to Work
      </Button>
      {canApprove && (
        <Button variant="secondary" onClick={onApprove} disabled={loading || chatAgentActive}>
          Approve
        </Button>
      )}
      {chatError && (
        <span className="ml-auto font-sans text-forge-mono-label text-status-error truncate">
          {chatError}
        </span>
      )}
    </FooterBar>
  );
}
