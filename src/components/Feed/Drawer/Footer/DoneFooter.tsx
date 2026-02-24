//! Footer for the done state — merge/archive/PR actions driven by PR tab state.

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
  onMerge: () => void;
  onOpenPr: () => void;
  onArchive: () => void;
  onFixConflicts: () => void;
  onAddressComments: () => void;
}

export function DoneFooter({
  task,
  activeTab,
  loading,
  prTabState,
  onMerge,
  onOpenPr,
  onArchive,
  onFixConflicts,
  onAddressComments,
}: DoneFooterProps) {
  const viewPrButton = (
    <Button hotkey="v" variant="secondary" onClick={() => openExternal(task.pr_url as string)}>
      View PR ↗
    </Button>
  );

  if (task.pr_url) {
    if (activeTab === "pr" && prTabState.type === "conflicts") {
      return (
        <FooterBar>
          <Button
            variant="custom"
            className="bg-[#D97706] hover:opacity-90 text-white border-transparent"
            onClick={onFixConflicts}
            disabled={loading}
          >
            {loading ? "Fixing…" : "Fix Conflicts"}
          </Button>
          {viewPrButton}
        </FooterBar>
      );
    }

    if (activeTab === "pr" && prTabState.type === "comments_selected") {
      return (
        <FooterBar>
          <Button
            variant="custom"
            className="bg-[#C85A4C] hover:bg-[#B85040] text-white border-transparent"
            onClick={onAddressComments}
            disabled={loading}
          >
            {loading
              ? "Sending…"
              : `Address ${prTabState.count} comment${prTabState.count !== 1 ? "s" : ""}`}
          </Button>
          {viewPrButton}
        </FooterBar>
      );
    }

    return (
      <FooterBar>
        <Button
          hotkey="m"
          onAccent
          variant="custom"
          className="bg-[#C85A4C] hover:bg-[#B85040] text-white border-transparent"
          onClick={onMerge}
          disabled={loading}
        >
          {loading ? "Merging…" : "Merge"}
        </Button>
        <Button
          hotkey="v"
          variant="custom"
          className="bg-transparent border-[#C85A4C]/30 text-[#C85A4C] hover:bg-[#C85A4C]/7"
          onClick={() => openExternal(task.pr_url as string)}
        >
          View PR ↗
        </Button>
        <Button hotkey="x" variant="secondary" onClick={onArchive} disabled={loading}>
          Archive
        </Button>
      </FooterBar>
    );
  }

  return (
    <FooterBar>
      <Button
        hotkey="m"
        onAccent
        variant="custom"
        className="bg-[#C85A4C] hover:bg-[#B85040] text-white border-transparent"
        onClick={onMerge}
        disabled={loading}
      >
        {loading ? "Merging…" : "Merge"}
      </Button>
      <Button
        hotkey="o"
        variant="custom"
        className="bg-transparent border-[#C85A4C]/30 text-[#C85A4C] hover:bg-[#C85A4C]/7"
        onClick={onOpenPr}
        disabled={loading}
      >
        {loading ? "Opening…" : "Open PR"}
      </Button>
      <Button hotkey="x" variant="secondary" onClick={onArchive} disabled={loading}>
        Archive
      </Button>
    </FooterBar>
  );
}
