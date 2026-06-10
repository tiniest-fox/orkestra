// Loading splash shown during system-active intermediate states that have no user action.

import type { TaskState } from "../../../types/workflow";

// ============================================================================
// State mapping
// ============================================================================

export function getSplashLabel(state: TaskState): string | null {
  switch (state.type) {
    case "awaiting_setup":
      return "Awaiting setup…";
    case "setting_up":
      return "Setting up worktree…";
    case "finishing":
      return "Finishing…";
    case "committing":
    case "committed":
      return "Committing changes…";
    case "integrating":
      return "Integrating…";
    default:
      return null;
  }
}

// ============================================================================
// Component
// ============================================================================

export function StageSplash({ label }: { label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3">
      <span className="w-6 h-6 border-2 border-border border-t-transparent rounded-full animate-spin" />
      <p className="text-forge-body font-sans text-text-tertiary">{label}</p>
    </div>
  );
}
