import { describe, expect, it } from "vitest";
import { createMockWorkflowConfig } from "../test/mocks/fixtures";
import type { WorkflowConfig } from "../types/workflow";
import { nextStageInFlow, resolveFlowStageNames } from "./workflowNavigation";

function createThreeStageConfig(): WorkflowConfig {
  const base = createMockWorkflowConfig();
  return {
    ...base,
    stages: [
      ...base.stages,
      {
        name: "review",
        artifact: "verdict",
        inputs: ["summary"],
        is_automated: false,
        is_optional: false,
        capabilities: { ask_questions: false, approval: {} },
      },
    ],
    flows: {
      quick: {
        description: "Skip planning",
        stages: ["work", "review"],
      },
      with_overrides: {
        description: "Flow with stage overrides",
        stages: [
          "planning",
          { work: { inputs: ["plan"], capabilities: { ask_questions: false } } },
        ],
      },
    },
  };
}

describe("resolveFlowStageNames", () => {
  it("returns all stage names in order for default pipeline", () => {
    const config = createThreeStageConfig();
    expect(resolveFlowStageNames(undefined, config)).toEqual(["planning", "work", "review"]);
  });

  it("returns correct subset for flow with string entries", () => {
    const config = createThreeStageConfig();
    expect(resolveFlowStageNames("quick", config)).toEqual(["work", "review"]);
  });

  it("extracts stage name from object entries (overrides)", () => {
    const config = createThreeStageConfig();
    expect(resolveFlowStageNames("with_overrides", config)).toEqual(["planning", "work"]);
  });

  it("falls back to default pipeline for unknown flow", () => {
    const config = createThreeStageConfig();
    expect(resolveFlowStageNames("nonexistent", config)).toEqual(["planning", "work", "review"]);
  });
});

describe("nextStageInFlow", () => {
  it("returns the next stage name", () => {
    const config = createThreeStageConfig();
    expect(nextStageInFlow("planning", undefined, config)).toBe("work");
  });

  it("returns null for the last stage", () => {
    const config = createThreeStageConfig();
    expect(nextStageInFlow("review", undefined, config)).toBeNull();
  });

  it("returns null for an unknown current stage", () => {
    const config = createThreeStageConfig();
    expect(nextStageInFlow("unknown", undefined, config)).toBeNull();
  });

  it("respects flow stage ordering", () => {
    const config = createThreeStageConfig();
    expect(nextStageInFlow("work", "quick", config)).toBe("review");
    expect(nextStageInFlow("review", "quick", config)).toBeNull();
  });
});
