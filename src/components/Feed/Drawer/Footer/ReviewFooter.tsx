//! Footer for the review state — approve or enter reject mode.

import { Button } from "../../../ui/Button";
import { FooterBar } from "./FooterBar";

interface ReviewFooterProps {
  reviewVariant: "violet" | "teal";
  loading: boolean;
  onApprove: () => void;
  onEnterRejectMode: () => void;
}

export function ReviewFooter({
  reviewVariant,
  loading,
  onApprove,
  onEnterRejectMode,
}: ReviewFooterProps) {
  return (
    <FooterBar>
      <Button
        hotkey="a"
        onAccent
        variant="custom"
        className={
          reviewVariant === "violet"
            ? "bg-[#7C3AED] hover:bg-[#6D28D9] text-white border-transparent"
            : "bg-[#0D9488] hover:bg-[#0B7D74] text-white border-transparent"
        }
        onClick={onApprove}
        disabled={loading}
      >
        Approve
      </Button>
      <Button hotkey="r" variant="secondary" onClick={onEnterRejectMode} disabled={loading}>
        Reject
      </Button>
    </FooterBar>
  );
}
