// Service manager header bar — ORKESTRA · SERVICE wordmark and action buttons.

import { Button } from "../../components/ui";
import { HotkeyScope } from "../../components/ui/HotkeyScope";

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
  return (
    <div className="flex items-center justify-between px-6 h-11 border-b border-border bg-surface shrink-0">
      <div className="flex items-center gap-2">
        <span className="font-sans text-[13px] font-bold tracking-[0.06em] uppercase text-text-primary select-none">
          ORKESTRA
        </span>
        <span className="text-text-quaternary select-none">·</span>
        <span className="text-[13px] font-medium text-text-secondary select-none">SERVICE</span>
      </div>
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
    </div>
  );
}
