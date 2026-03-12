//! Footer for the done state — merge/archive/PR actions driven by PR tab state.

import type React from "react";
import type { WorkflowTaskView } from "../../../../types/workflow";
import { openExternal } from "../../../../utils/openExternal";
import { Button } from "../../../ui/Button";
import type { DrawerTabId, PrTabFooterState } from "../drawerTabs";
import { FooterBar } from "./FooterBar";

interface DoneFooterProps {
  task: WorkflowTaskView;
  activeTab: DrawerTabId;
  loading: boolean;
  prTabState: PrTabFooterState;
  updateMode: boolean;
  updateNotes: string;
  onUpdateNotesChange: (v: string) => void;
  updateNotesRef: React.RefObject<HTMLTextAreaElement>;
  onRequestUpdate: () => void;
  onEnterUpdateMode: () => void;
  onExitUpdateMode: () => void;
  onMerge: () => void;
  onOpenPr: () => void;
  onArchive: () => void;
  onFixConflicts: () => void;
  onAddressFeedback: () => void;
  onPushPr: () => void;
  onPullPr: () => void;
  pushPullError: string | null;
}

export function DoneFooter({
  task,
  activeTab,
  loading,
  prTabState,
  updateMode,
  updateNotes,
  onUpdateNotesChange,
  updateNotesRef,
  onRequestUpdate,
  onEnterUpdateMode,
  onExitUpdateMode,
  onMerge,
  onOpenPr,
  onArchive,
  onFixConflicts,
  onAddressFeedback,
  onPushPr,
  onPullPr,
  pushPullError,
}: DoneFooterProps) {
  if (updateMode) {
    return (
      <FooterBar className="flex-col h-auto pt-3 pb-3 gap-2">
        <textarea
          ref={updateNotesRef}
          value={updateNotes}
          onChange={(e) => onUpdateNotesChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (updateNotes.trim()) onRequestUpdate();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              onExitUpdateMode();
            }
          }}
          placeholder="Notes for the agent…"
          rows={2}
          className="w-full font-sans text-[13px] text-text-primary placeholder:text-text-quaternary bg-surface-2 border border-border rounded px-3 py-2 resize-none focus:outline-none focus:border-text-tertiary transition-colors"
        />
        <div className="flex gap-2 w-full">
          <Button
            variant="primary"
            className="flex-1 justify-center"
            onClick={onRequestUpdate}
            disabled={loading || !updateNotes.trim()}
          >
            {loading ? (
              "Sending…"
            ) : (
              <>
                Request Changes{" "}
                <span className="font-mono text-[10px] font-medium opacity-60 ml-3">⌘↵</span>
              </>
            )}
          </Button>
          <Button
            variant="secondary"
            className="flex-1 justify-center"
            onClick={onExitUpdateMode}
            disabled={loading}
          >
            Cancel
          </Button>
        </div>
      </FooterBar>
    );
  }

  const viewPrButton = (
    <Button hotkey="v" variant="secondary" onClick={() => openExternal(task.pr_url as string)}>
      View PR ↗
    </Button>
  );

  if (task.pr_url) {
    if (activeTab === "pr" && prTabState.type === "conflicts") {
      return (
        <FooterBar>
          <Button variant="warning" onClick={onFixConflicts} disabled={loading}>
            {loading ? "Fixing…" : "Fix Conflicts"}
          </Button>
          {viewPrButton}
          <Button variant="secondary" onClick={onPushPr} disabled={loading}>
            Push
          </Button>
          <Button variant="secondary" onClick={onPullPr} disabled={loading}>
            Pull
          </Button>
          <Button variant="secondary" onClick={onEnterUpdateMode} disabled={loading}>
            Request Changes
          </Button>
          {pushPullError && (
            <span className="ml-auto text-status-error font-sans text-forge-mono-label truncate">
              {pushPullError}
            </span>
          )}
        </FooterBar>
      );
    }

    if (activeTab === "pr" && prTabState.type === "feedback_selected") {
      const { commentCount, checkCount } = prTabState;
      const parts: string[] = [];
      if (commentCount > 0) parts.push(`${commentCount} comment${commentCount !== 1 ? "s" : ""}`);
      if (checkCount > 0) parts.push(`${checkCount} check${checkCount !== 1 ? "s" : ""}`);
      const label = `Address ${parts.join(" & ")}`;

      return (
        <FooterBar>
          <Button variant="merge" onClick={onAddressFeedback} disabled={loading}>
            {loading ? "Sending…" : label}
          </Button>
          {viewPrButton}
          <Button variant="secondary" onClick={onEnterUpdateMode} disabled={loading}>
            Request Changes
          </Button>
        </FooterBar>
      );
    }

    return (
      <FooterBar>
        <Button hotkey="m" onAccent variant="merge" onClick={onMerge} disabled={loading}>
          {loading ? "Merging…" : "Merge"}
        </Button>
        <Button
          hotkey="v"
          variant="merge-outline"
          onClick={() => openExternal(task.pr_url as string)}
        >
          View PR ↗
        </Button>
        <Button hotkey="x" variant="secondary" onClick={onArchive} disabled={loading}>
          Archive
        </Button>
        {activeTab === "pr" && (
          <>
            <Button variant="secondary" onClick={onPushPr} disabled={loading}>
              Push
            </Button>
            <Button variant="secondary" onClick={onPullPr} disabled={loading}>
              Pull
            </Button>
          </>
        )}
        <Button variant="secondary" onClick={onEnterUpdateMode} disabled={loading}>
          Request Changes
        </Button>
        {pushPullError && (
          <span className="ml-auto text-status-error font-sans text-forge-mono-label truncate">
            {pushPullError}
          </span>
        )}
      </FooterBar>
    );
  }

  return (
    <FooterBar>
      <Button hotkey="m" onAccent variant="merge" onClick={onMerge} disabled={loading}>
        {loading ? "Merging…" : "Merge"}
      </Button>
      <Button hotkey="o" variant="merge-outline" onClick={onOpenPr} disabled={loading}>
        {loading ? "Opening…" : "Open PR"}
      </Button>
      <Button hotkey="x" variant="secondary" onClick={onArchive} disabled={loading}>
        Archive
      </Button>
      <Button variant="secondary" onClick={onEnterUpdateMode} disabled={loading}>
        Request Changes
      </Button>
    </FooterBar>
  );
}
