// Pairing code modal content — large code display with countdown and instructions.

import { useEffect, useState } from "react";
import { DrawerHeader } from "../../components/ui/Drawer/DrawerHeader";

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
    <div className="bg-surface border border-border rounded-panel shadow-panel w-full">
      <DrawerHeader title="Pair a device" onClose={onDismiss} />

      <div className="px-5 py-6 flex flex-col items-center gap-4">
        <p className="font-mono text-forge-mono-sm text-text-tertiary text-center">
          Enter this code in the Orkestra app to connect your device.
        </p>

        <div className="bg-canvas rounded-panel-sm px-8 py-4 w-full flex items-center justify-center">
          <span className="font-mono text-[28px] font-bold tracking-[0.18em] text-text-primary select-all">
            {code}
          </span>
        </div>

        <span className="font-mono text-forge-mono-sm text-text-quaternary">
          Expires in {mins}:{String(secs).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
