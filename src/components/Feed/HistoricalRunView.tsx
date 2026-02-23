//! Historical run view — artifact and logs for a past stage run.

import { useEffect, useRef } from "react";
import { useLogs } from "../../hooks/useLogs";
import type { WorkflowTaskView } from "../../types/workflow";
import type { StageRun } from "../../utils/stageRuns";
import { useNavHandler } from "../ui/HotkeyScope";
import { ArtifactView } from "./ArtifactView";
import type { DrawerTab } from "./DrawerTabBar";
import { DrawerTabBar } from "./DrawerTabBar";
import { FeedLogList } from "./FeedLogList";
import { useDrawerTabs } from "./useDrawerTabs";

interface HistoricalRunViewProps {
  task: WorkflowTaskView;
  run: StageRun;
  accent: string;
}

export function HistoricalRunView({ task, run, accent }: HistoricalRunViewProps) {
  const artifact = task.artifacts[run.artifactKey] ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);

  const tabs: DrawerTab[] = [
    { id: "artifact", label: run.artifactLabel, hotkey: "a" },
    { id: "logs", label: "Logs", hotkey: "l" },
  ];

  const [activeTab, setActiveTab] = useDrawerTabs("artifact");
  const isLogsActive = activeTab === "logs";

  const { logs, error, setActiveLogStage } = useLogs(task, isLogsActive);
  const setActiveLogStageRef = useRef(setActiveLogStage);
  setActiveLogStageRef.current = setActiveLogStage;

  useNavHandler("a", () => setActiveTab("artifact"));
  useNavHandler("l", () => setActiveTab("logs"));
  useNavHandler("ArrowDown", () => scrollRef.current?.scrollBy({ top: 56, behavior: "smooth" }));
  useNavHandler("j", () => scrollRef.current?.scrollBy({ top: 56, behavior: "smooth" }));
  useNavHandler("ArrowUp", () => scrollRef.current?.scrollBy({ top: -56, behavior: "smooth" }));
  useNavHandler("k", () => scrollRef.current?.scrollBy({ top: -56, behavior: "smooth" }));

  useEffect(() => {
    if (isLogsActive) setActiveLogStageRef.current(run.stage);
  }, [isLogsActive, run.stage]);

  return (
    <>
      <DrawerTabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} accent={accent} />
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {activeTab === "artifact" ? (
          artifact ? (
            <ArtifactView artifact={artifact} />
          ) : (
            <div className="p-6 font-forge-mono text-[11px] text-[var(--text-3)]">
              No artifact for this stage.
            </div>
          )
        ) : (
          <div className="p-4">
            <FeedLogList logs={logs} error={error} />
          </div>
        )}
      </div>
    </>
  );
}
