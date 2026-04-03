// Service manager header bar — ORKESTRA · SERVICE wordmark and action buttons.

import { Button } from "../../components/ui";
import { HotkeyScope } from "../../components/ui/HotkeyScope";
import { useIsMobile } from "../../hooks/useIsMobile";

interface ServiceHeaderProps {
  onAddProject: () => void;
  onGeneratePairingCode: () => void;
  hotkeyActive: boolean;
}

export function ServiceHeader({
  onAddProject,
  onGeneratePairingCode,
  hotkeyActive,
}: ServiceHeaderProps) {
  const isMobile = useIsMobile();

  return (
    <div className="flex items-center justify-between px-6 h-11 border-b border-border bg-surface shrink-0">
      <div className="flex items-center gap-2">
        <span className="font-sans text-forge-body font-bold tracking-[0.06em] uppercase text-text-primary select-none">
          ORKESTRA
        </span>
      </div>
      {isMobile && (
        <span className="font-mono text-forge-mono-sm text-text-quaternary">
          {(import.meta.env.VITE_RELEASE_VERSION as string) ||
            (import.meta.env.VITE_COMMIT_HASH as string) ||
            "dev"}
        </span>
      )}
      {!isMobile && (
        <HotkeyScope active={hotkeyActive}>
          <div className="flex items-center gap-2">
            <Button hotkey="a" variant="primary" size="sm" onClick={onAddProject}>
              Add project
            </Button>
            <Button hotkey="p" variant="secondary" size="sm" onClick={onGeneratePairingCode}>
              Pairing code
            </Button>
          </div>
        </HotkeyScope>
      )}
    </div>
  );
}
