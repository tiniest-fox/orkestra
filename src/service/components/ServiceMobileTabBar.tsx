// Mobile bottom tab bar for the service page: pair (left), add project (center), empty balance (right).
//
// Mirrors the MobileTabBar pattern from FeedView. The center Plus button protrudes
// above the bar via -translate-y-2.5; overflow-visible on the wrapper prevents clipping.

import { Plus, QrCode } from "lucide-react";

interface ServiceMobileTabBarProps {
  onAddProject: () => void;
  onGeneratePairingCode: () => void;
}

export function ServiceMobileTabBar({
  onAddProject,
  onGeneratePairingCode,
}: ServiceMobileTabBarProps) {
  return (
    <div className="shrink-0 overflow-visible pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-end h-[49px] border-t border-border bg-surface">
        {/* Balance slot */}
        <div className="flex-1" />

        {/* Add project — protrudes 10px above the bar */}
        <div className="flex items-end justify-center pb-2 px-6 -translate-y-2.5">
          <button
            type="button"
            onClick={onAddProject}
            className="flex items-center justify-center w-14 h-14 rounded-full bg-accent text-white shadow-lg active:scale-95 transition-transform"
            aria-label="Add project"
          >
            <Plus size={24} />
          </button>
        </div>

        {/* Pairing code */}
        <button
          type="button"
          onClick={onGeneratePairingCode}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 h-full text-text-tertiary transition-colors"
          aria-label="Generate pairing code"
        >
          <QrCode size={20} />
          <span className="font-mono text-forge-mono-label">Pair</span>
        </button>
      </div>
    </div>
  );
}
