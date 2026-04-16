// Historical run view — artifact and logs for a past stage run.

import { FileText } from "lucide-react";
import { useRef } from "react";
import { useLogs } from "../../hooks/useLogs";
import { useWorkflowConfig } from "../../providers";
import type { WorkflowTaskView } from "../../types/workflow";
import type { StageRun } from "../../utils/stageRuns";
import { EmptyState } from "../ui/EmptyState";
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
  const config = useWorkflowConfig();

  // Derive verdict for historical run — only show for approval-capability stages
  const stageConfig = config.flows[task.flow]?.stages.find((s) => s.name === run.stage);
  let verdict: "approved" | "rejected" | undefined;
  let rejectionTarget: string | undefined;
  if (stageConfig?.gate === true) {
    const lastOutcome = run.iterations[run.iterations.length - 1]?.outcome;
    if (lastOutcome?.type === "approved") {
      verdict = "approved";
    } else if (
      lastOutcome?.type === "rejected" ||
      lastOutcome?.type === "rejection" ||
      lastOutcome?.type === "awaiting_rejection_review"
    ) {
      verdict = "rejected";
      if (lastOutcome.type === "rejection" || lastOutcome.type === "awaiting_rejection_review") {
        const { from_stage, target } = lastOutcome;
        if (target !== from_stage) {
          rejectionTarget = target;
        }
      }
    }
  }

  const tabs: DrawerTab[] = [
    { id: "artifact", label: run.artifactLabel, hotkey: "a" },
    { id: "logs", label: "Logs", hotkey: "l" },
  ];

  const [activeTab, setActiveTab] = useDrawerTabs("artifact");
  const isLogsActive = activeTab === "logs";

  const { logs, error } = useLogs(task, isLogsActive, run.stage);

  useNavHandler("a", () => setActiveTab("artifact"));
  useNavHandler("l", () => setActiveTab("logs"));
  useNavHandler("ArrowDown", () => scrollRef.current?.scrollBy({ top: 56, behavior: "smooth" }));
  useNavHandler("j", () => scrollRef.current?.scrollBy({ top: 56, behavior: "smooth" }));
  useNavHandler("ArrowUp", () => scrollRef.current?.scrollBy({ top: -56, behavior: "smooth" }));
  useNavHandler("k", () => scrollRef.current?.scrollBy({ top: -56, behavior: "smooth" }));

  return (
    <>
      <DrawerTabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} accent={accent} />
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {activeTab === "artifact" ? (
          artifact ? (
            <ArtifactView artifact={artifact} verdict={verdict} rejectionTarget={rejectionTarget} />
          ) : (
            <EmptyState icon={FileText} message="No artifact for this stage." />
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
