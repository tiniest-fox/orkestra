//! Gate tab — shows accumulated output from the most recent gate script run.

import { ShieldCheck } from "lucide-react";
import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { AnsiText } from "../../utils/ansi";
import { EmptyState } from "../ui/EmptyState";
import { findGateStage } from "./Drawer/drawerTabs";

// ============================================================================
// Component
// ============================================================================

interface DrawerGateTabProps {
  task: WorkflowTaskView;
  config: WorkflowConfig;
}

export function DrawerGateTab({ task, config }: DrawerGateTabProps) {
  const gateStage = findGateStage(config);
  if (!gateStage) return null;

  // Most recent work iteration that has a gate_result
  const latestGateIteration = [...task.iterations]
    .reverse()
    .find((i) => i.stage === gateStage.name && i.gate_result);

  const gateResult = latestGateIteration?.gate_result;
  const isRunning = task.state.type === "gate_running";

  if (!gateResult && !isRunning) {
    return <EmptyState icon={ShieldCheck} message="No gate output yet." />;
  }

  const exitCode = gateResult?.exit_code ?? undefined;
  const passed = exitCode === 0;
  const failed = exitCode !== undefined && exitCode !== 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {(passed || failed) && (
        <div
          className={`px-4 py-2 text-xs font-medium border-b border-border ${
            passed ? "text-status-success" : "text-status-error"
          }`}
        >
          {passed ? "Gate passed" : `Gate failed (exit ${exitCode})`}
        </div>
      )}
      {isRunning && !failed && !passed && (
        <div className="px-4 py-2 text-xs text-text-tertiary border-b border-border">
          Gate running…
        </div>
      )}
      <pre className="flex-1 overflow-y-auto p-4 text-xs font-mono whitespace-pre-wrap text-text-secondary">
        <AnsiText text={(gateResult?.lines ?? []).join("\n")} />
      </pre>
    </div>
  );
}
