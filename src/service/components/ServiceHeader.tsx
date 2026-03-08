//! Service manager header bar with title and action buttons.

import { Button } from "../../components/ui";

// ============================================================================
// Types
// ============================================================================

interface ServiceHeaderProps {
  onGeneratePairingCode: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function ServiceHeader({ onGeneratePairingCode }: ServiceHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-xl font-semibold text-text-primary">Orkestra Service</h1>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onGeneratePairingCode}>
          Generate Pairing Code
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            window.location.href = "/app";
          }}
        >
          Open App
        </Button>
      </div>
    </div>
  );
}
