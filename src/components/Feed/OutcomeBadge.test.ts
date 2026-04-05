import { describe, expect, it } from "vitest";
import type { WorkflowOutcome } from "../../types/workflow";
import { artifactBadgeLabel, badgeLabel } from "./OutcomeBadge";

const outcome = (type: string) => ({ type }) as WorkflowOutcome;

describe("badgeLabel", () => {
  it("returns Approved for approved outcome", () => {
    const result = badgeLabel(outcome("approved"));
    expect(result.label).toBe("Approved");
    expect(result.color).toContain("success");
  });

  it("returns Rejected for rejected outcome", () => {
    const result = badgeLabel(outcome("rejected"));
    expect(result.label).toBe("Rejected");
    expect(result.color).toContain("warning");
  });

  it("returns Rejected for rejection outcome", () => {
    const result = badgeLabel(outcome("rejection"));
    expect(result.label).toBe("Rejected");
    expect(result.color).toContain("warning");
  });

  it("returns Done for completed outcome", () => {
    const result = badgeLabel(outcome("completed"));
    expect(result.label).toBe("Done");
    expect(result.color).toContain("success");
  });

  it("returns Error for agent_error outcome", () => {
    const result = badgeLabel(outcome("agent_error"));
    expect(result.label).toBe("Error");
    expect(result.color).toContain("error");
  });

  it("returns Blocked for blocked outcome", () => {
    const result = badgeLabel(outcome("blocked"));
    expect(result.label).toBe("Blocked");
  });

  it("returns Skipped for skipped outcome", () => {
    const result = badgeLabel(outcome("skipped"));
    expect(result.label).toBe("Skipped");
  });

  it("returns Pending Review for awaiting_rejection_review outcome", () => {
    const result = badgeLabel(outcome("awaiting_rejection_review"));
    expect(result.label).toBe("Pending Review");
    expect(result.color).toContain("warning");
  });

  it("returns Spawn Failed for spawn_failed outcome", () => {
    const result = badgeLabel(outcome("spawn_failed"));
    expect(result.label).toBe("Spawn Failed");
    expect(result.color).toContain("error");
  });

  it("returns Gate Failed for gate_failed outcome", () => {
    const result = badgeLabel(outcome("gate_failed"));
    expect(result.label).toBe("Gate Failed");
    expect(result.color).toContain("error");
  });

  it("returns Commit Failed for commit_failed outcome", () => {
    const result = badgeLabel(outcome("commit_failed"));
    expect(result.label).toBe("Commit Failed");
    expect(result.color).toContain("error");
  });

  it("returns Merge Failed for integration_failed outcome", () => {
    const result = badgeLabel(outcome("integration_failed"));
    expect(result.label).toBe("Merge Failed");
    expect(result.color).toContain("error");
  });

  it("returns Interrupted for interrupted outcome", () => {
    const result = badgeLabel(outcome("interrupted"));
    expect(result.label).toBe("Interrupted");
    expect(result.color).toContain("warning");
  });

  it("returns Waiting for awaiting_answers outcome", () => {
    const result = badgeLabel(outcome("awaiting_answers"));
    expect(result.label).toBe("Waiting");
    expect(result.color).toContain("info");
  });

  it("returns Unknown for unrecognized outcome type", () => {
    const result = badgeLabel({ type: "something_unknown" } as unknown as WorkflowOutcome);
    expect(result.label).toBe("Unknown");
  });
});

describe("artifactBadgeLabel", () => {
  it("returns Approved with success styling for approved verdict", () => {
    const result = artifactBadgeLabel("verdict", "approved");
    expect(result.label).toBe("Approved");
    expect(result.classes).toContain("bg-status-success");
    expect(result.classes).toContain("text-white");
  });

  it("returns Rejected with error styling for rejected verdict", () => {
    const result = artifactBadgeLabel("verdict", "rejected");
    expect(result.label).toBe("Rejected");
    expect(result.classes).toContain("bg-status-error");
    expect(result.classes).toContain("text-white");
  });

  it("returns title-cased artifact name with neutral styling when no verdict", () => {
    const result = artifactBadgeLabel("plan", undefined);
    expect(result.label).toBe("Plan");
    expect(result.classes).toContain("bg-surface-3");
    expect(result.classes).toContain("text-text-secondary");
  });

  it("handles underscored artifact names", () => {
    const result = artifactBadgeLabel("code_review", undefined);
    expect(result.label).toBe("Code Review");
  });
});
