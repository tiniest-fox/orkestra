//! Footer for the review state — approve or enter reject mode.

import { Button } from "../../../ui/Button";
import { FooterBar } from "./FooterBar";

interface ReviewFooterProps {
  reviewVariant: "violet" | "teal";
  loading: boolean;
  onApprove: () => void;
  onEnterRejectMode: () => void;
  onEnterChatMode: () => void;
}

export function ReviewFooter({
  reviewVariant,
  loading,
  onApprove,
  onEnterRejectMode,
  onEnterChatMode,
}: ReviewFooterProps) {
  return (
    <FooterBar>
      <Button
        hotkey="a"
        onAccent
        variant={reviewVariant === "violet" ? "violet" : "teal"}
        onClick={onApprove}
        disabled={loading}
      >
        Approve
      </Button>
      <Button hotkey="r" variant="secondary" onClick={onEnterRejectMode} disabled={loading}>
        Reject
      </Button>
      <Button hotkey="c" variant="secondary" onClick={onEnterChatMode} disabled={loading}>
        Chat
      </Button>
    </FooterBar>
  );
}
