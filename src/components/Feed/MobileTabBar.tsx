// Mobile bottom tab bar: git (left), new task (center), assistant (right).
//
// The center Plus button protrudes above the bar. The outer wrapper uses
// overflow-visible so the button isn't clipped; the border-t is on the inner
// row so it doesn't span behind the protruding button area.

import { GitBranch, MessageSquare, Plus } from "lucide-react";
import { useGitHistory } from "../../providers/GitHistoryProvider";

interface MobileTabBarProps {
  gitActive: boolean;
  assistantActive: boolean;
  onGitOpen: () => void;
  onNewTask: () => void;
  onAssistantOpen: () => void;
}

export function MobileTabBar({
  gitActive,
  assistantActive,
  onGitOpen,
  onNewTask,
  onAssistantOpen,
}: MobileTabBarProps) {
  const { syncStatus, currentBranch } = useGitHistory();
  const hasPending = syncStatus != null && (syncStatus.ahead > 0 || syncStatus.behind > 0);

  return (
    <div className="shrink-0 overflow-visible pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-end h-[49px] border-t border-border bg-surface">
        {/* Git panel */}
        <button
          type="button"
          onClick={onGitOpen}
          className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 h-full transition-colors ${gitActive ? "text-accent" : "text-text-tertiary"}`}
          aria-label="Git history"
        >
          <GitBranch size={20} />
          <span className="font-mono text-[10px] truncate max-w-[72px]">{currentBranch ?? ""}</span>
          {hasPending && !gitActive && (
            <span className="absolute top-2 right-[calc(50%-12px)] w-1.5 h-1.5 rounded-full bg-status-warning" />
          )}
        </button>

        {/* New task — protrudes 10px above the bar */}
        <div className="flex items-end justify-center pb-2 px-6 -translate-y-2.5">
          <button
            type="button"
            onClick={onNewTask}
            className="flex items-center justify-center w-14 h-14 rounded-full bg-accent text-white shadow-lg active:scale-95 transition-transform"
            aria-label="New Trak"
          >
            <Plus size={24} />
          </button>
        </div>

        {/* Assistant */}
        <button
          type="button"
          onClick={onAssistantOpen}
          className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 h-full transition-colors ${assistantActive ? "text-accent" : "text-text-tertiary"}`}
          aria-label="Assistant"
        >
          <MessageSquare size={20} />
          <span className="font-mono text-[10px]">Assistant</span>
        </button>
      </div>
    </div>
  );
}
