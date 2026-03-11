// Displays a generated pairing code as an inline banner with countdown and dismiss button.

import { X } from "lucide-react";
import { useEffect, useState } from "react";

interface PairingCodeBoxProps {
  code: string;
  expiresAt: number; // epoch ms
  onExpired: () => void;
  onDismiss: () => void;
}

export function PairingCodeBox({ code, expiresAt, onExpired, onDismiss }: PairingCodeBoxProps) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const secs = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemaining(secs);
      if (secs === 0) {
        clearInterval(interval);
        onExpired();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpired]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="flex items-center justify-between px-6 h-12 bg-surface border-b border-border shrink-0">
      <div className="flex items-center">
        <span className="font-mono text-[10px] font-semibold tracking-[0.10em] uppercase text-text-quaternary mr-3">
          PAIRING CODE
        </span>
        <span className="font-mono text-[16px] font-bold text-text-primary tracking-wider">
          {code}
        </span>
      </div>
      <div className="flex items-center">
        <span className="font-mono text-[11px] text-text-tertiary mr-3">
          {mins}:{String(secs).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss pairing code"
          className="text-text-quaternary hover:text-text-secondary p-1 rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
