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

  it("returns Unknown for unrecognized outcome type", () => {
    const result = badgeLabel({ type: "something_unknown" } as unknown as WorkflowOutcome);
    expect(result.label).toBe("Unknown");
  });
});

describe("artifactBadgeLabel", () => {
  it("returns Approved with success styling for approved outcome", () => {
    const result = artifactBadgeLabel("verdict", outcome("approved"));
    expect(result.label).toBe("Approved");
    expect(result.classes).toContain("bg-status-success");
    expect(result.classes).toContain("text-white");
  });

  it("returns Rejected with error styling for rejected outcome", () => {
    const result = artifactBadgeLabel("verdict", outcome("rejected"));
    expect(result.label).toBe("Rejected");
    expect(result.classes).toContain("bg-status-error");
    expect(result.classes).toContain("text-white");
  });

  it("returns Rejected with error styling for rejection outcome", () => {
    const result = artifactBadgeLabel("verdict", outcome("rejection"));
    expect(result.label).toBe("Rejected");
    expect(result.classes).toContain("bg-status-error");
  });

  it("returns title-cased artifact name with neutral styling when no outcome", () => {
    const result = artifactBadgeLabel("plan", undefined);
    expect(result.label).toBe("Plan");
    expect(result.classes).toContain("bg-surface-3");
  });

  it("returns title-cased artifact name for non-approval outcome", () => {
    const result = artifactBadgeLabel("summary", outcome("completed"));
    expect(result.label).toBe("Summary");
    expect(result.classes).toContain("bg-surface-3");
  });

  it("handles underscored artifact names", () => {
    const result = artifactBadgeLabel("code_review", undefined);
    expect(result.label).toBe("Code Review");
  });
});
