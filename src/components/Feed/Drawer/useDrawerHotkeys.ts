//! Hotkey registrations for the task drawer — scroll, tab switching, and quick actions.

import type { RefObject } from "react";
import { useEffect } from "react";
import type { WorkflowTaskView } from "../../../types/workflow";
import type { StageRun } from "../../../utils/stageRuns";
import { useNavHandler } from "../../ui/HotkeyScope";
import { useRunNavigation } from "../useRunNavigation";
import type { DrawerTabId } from "./drawerTabs";

interface DrawerHotkeysOptions {
  task: WorkflowTaskView;
  activeTab: DrawerTabId;
  setActiveTab: (tab: DrawerTabId) => void;
  activeScrollRef: RefObject<HTMLDivElement>;
  selectedRunIdx: number | null;
  setSelectedRunIdx: (idx: number | null) => void;
  runs: StageRun[];
  onArchive: () => void;
}

export function useDrawerHotkeys({
  task,
  activeTab,
  setActiveTab,
  activeScrollRef,
  selectedRunIdx,
  setSelectedRunIdx,
  runs,
  onArchive,
}: DrawerHotkeysOptions) {
  useEffect(() => {
    if (activeTab === "questions" || activeTab === "subtasks") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowDown") activeScrollRef.current?.scrollBy({ top: 56, behavior: "smooth" });
      if (e.key === "ArrowUp") activeScrollRef.current?.scrollBy({ top: -56, behavior: "smooth" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, activeScrollRef]);

  useNavHandler("j", () => activeScrollRef.current?.scrollBy({ top: 56, behavior: "smooth" }));
  useNavHandler("k", () => activeScrollRef.current?.scrollBy({ top: -56, behavior: "smooth" }));
  useNavHandler("l", () => {
    if (selectedRunIdx === null) setActiveTab("logs");
  });
  useNavHandler("d", () => {
    if (selectedRunIdx === null) setActiveTab("diff");
  });
  useNavHandler("a", () => {
    if (selectedRunIdx === null) setActiveTab("artifact");
  });
  useNavHandler("h", () => {
    if (selectedRunIdx === null) setActiveTab("history");
  });
  useNavHandler("q", () => {
    if (task.derived.has_questions && selectedRunIdx === null) setActiveTab("questions");
  });
  useNavHandler("t", () => {
    if (task.derived.is_waiting_on_children && selectedRunIdx === null) setActiveTab("subtasks");
  });
  useNavHandler("p", () => {
    if (task.derived.is_done && task.pr_url && selectedRunIdx === null) setActiveTab("pr");
  });
  useNavHandler("x", () => {
    if (task.derived.is_done) onArchive();
  });

  useRunNavigation(runs, selectedRunIdx, setSelectedRunIdx, task.derived.is_waiting_on_children);
}
