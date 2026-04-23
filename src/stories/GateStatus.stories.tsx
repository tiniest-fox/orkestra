// Storybook stories for gate status states: running, passed, and failed.
import type { Meta, StoryObj } from "@storybook/react";
import type { LogEntry } from "../types/workflow";
import { AnsiText } from "../utils/ansi";
import { storybookDecorator } from "./storybook-helpers";

// ============================================================================
// Gate log view component
// ============================================================================

interface GateLogViewProps {
  entries: LogEntry[];
  isGateRunning: boolean;
}

function GateLogView({ entries, isGateRunning }: GateLogViewProps) {
  return (
    <div className="border border-border rounded-lg bg-surface px-3 pt-2 pb-3 max-w-2xl">
      {entries.map((ge, idx) => {
        if (ge.type === "gate_started") {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
            <div key={idx} className="font-mono text-forge-mono-sm text-text-tertiary py-1">
              Running: {ge.command}
            </div>
          );
        }
        if (ge.type === "gate_output") {
          const outputCls =
            "font-mono text-forge-mono-sm whitespace-pre-wrap text-text-secondary py-0.5";
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
            <pre key={idx} className={outputCls}>
              <AnsiText text={ge.content} />
            </pre>
          );
        }
        if (ge.type === "gate_completed") {
          const completedCls = `font-mono text-forge-mono-sm py-1 ${ge.passed ? "text-status-success" : "text-status-error"}`;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
            <div key={idx} className={completedCls}>
              {ge.passed ? "Gate passed" : `Gate failed (exit ${ge.exit_code})`}
            </div>
          );
        }
        return null;
      })}
      {isGateRunning && (
        <div className="flex items-center gap-2 py-1.5 text-status-info">
          <span className="w-3 h-3 border-2 border-status-info/40 border-t-status-info rounded-full animate-spin shrink-0" />
          <span className="font-mono text-forge-mono-sm">Running gate checks…</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Stories
// ============================================================================

const meta = {
  title: "Feed/GateStatus",
  component: GateLogView,
  decorators: [storybookDecorator],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof GateLogView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Gate in progress — spinner shown while checks run. */
export const GateRunning: Story = {
  args: {
    entries: [
      { type: "gate_started", command: "checks.sh" },
      { type: "gate_output", content: "Running cargo fmt --check..." },
      { type: "gate_output", content: "Running cargo clippy..." },
    ] as LogEntry[],
    isGateRunning: true,
  },
};

/** Gate completed successfully — no spinner shown. */
export const GatePassed: Story = {
  args: {
    entries: [
      { type: "gate_started", command: "checks.sh" },
      { type: "gate_output", content: "All checks passed" },
      { type: "gate_completed", exit_code: 0, passed: true },
    ] as LogEntry[],
    isGateRunning: false,
  },
};

/** Gate completed with failure — error shown in red, no spinner. */
export const GateFailed: Story = {
  args: {
    entries: [
      { type: "gate_started", command: "checks.sh" },
      { type: "gate_output", content: "error[E0308]: mismatched types" },
      { type: "gate_completed", exit_code: 1, passed: false },
    ] as LogEntry[],
    isGateRunning: false,
  },
};
