import { describe, expect, it } from "vitest";
import type { WorkflowConfig } from "../types/workflow";
import { nextStageInFlow, resolveFlowStageNames } from "./workflowNavigation";

function createThreeStageConfig(): WorkflowConfig {
  return {
    version: 2,
    flows: {
      default: {
        description: "Default pipeline",
        stages: [
          {
            name: "planning",
            artifact: "plan",
            inputs: [],
            is_automated: true,
            is_optional: false,
            capabilities: { ask_questions: true },
          },
          {
            name: "work",
            artifact: "summary",
            inputs: [],
            is_automated: true,
            is_optional: false,
            capabilities: { ask_questions: true },
          },
          {
            name: "review",
            artifact: "verdict",
            inputs: [],
            is_automated: false,
            is_optional: false,
            capabilities: { ask_questions: false, approval: {} },
          },
        ],
        integration: { on_failure: "work" },
      },
      quick: {
        description: "Skip planning",
        stages: [
          {
            name: "work",
            artifact: "summary",
            inputs: [],
            is_automated: true,
            is_optional: false,
            capabilities: { ask_questions: true },
          },
          {
            name: "review",
            artifact: "verdict",
            inputs: [],
            is_automated: false,
            is_optional: false,
            capabilities: { ask_questions: false, approval: {} },
          },
        ],
        integration: { on_failure: "work" },
      },
    },
  };
}

describe("resolveFlowStageNames", () => {
  it("returns all stage names in order for default flow", () => {
    const config = createThreeStageConfig();
    expect(resolveFlowStageNames("default", config)).toEqual(["planning", "work", "review"]);
  });

  it("returns correct subset for quick flow", () => {
    const config = createThreeStageConfig();
    expect(resolveFlowStageNames("quick", config)).toEqual(["work", "review"]);
  });

  it("returns empty array for unknown flow", () => {
    const config = createThreeStageConfig();
    expect(resolveFlowStageNames("nonexistent", config)).toEqual([]);
  });
});

describe("nextStageInFlow", () => {
  it("returns the next stage name", () => {
    const config = createThreeStageConfig();
    expect(nextStageInFlow("planning", "default", config)).toBe("work");
  });

  it("returns null for the last stage", () => {
    const config = createThreeStageConfig();
    expect(nextStageInFlow("review", "default", config)).toBeNull();
  });

  it("returns null for an unknown current stage", () => {
    const config = createThreeStageConfig();
    expect(nextStageInFlow("unknown", "default", config)).toBeNull();
  });

  it("respects flow stage ordering", () => {
    const config = createThreeStageConfig();
    expect(nextStageInFlow("work", "quick", config)).toBe("review");
    expect(nextStageInFlow("review", "quick", config)).toBeNull();
  });
});
