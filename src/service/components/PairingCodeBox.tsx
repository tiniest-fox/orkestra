//! Displays a generated pairing code with a live countdown until expiry.

import { useEffect, useState } from "react";
import { Panel } from "../../components/ui";

// ============================================================================
// Types
// ============================================================================

interface PairingCodeBoxProps {
  code: string;
  expiresAt: number; // epoch ms
  onExpired: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function PairingCodeBox({ code, expiresAt, onExpired }: PairingCodeBoxProps) {
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
    <Panel autoFill={false} className="mt-3 text-center">
      <Panel.Body>
        <p className="text-sm text-text-secondary">Pairing Code</p>
        <p className="font-mono text-3xl font-bold tracking-wider text-text-primary my-2">{code}</p>
        <p className="text-sm text-text-tertiary">
          Expires in {mins}:{String(secs).padStart(2, "0")}
        </p>
      </Panel.Body>
    </Panel>
  );
}
