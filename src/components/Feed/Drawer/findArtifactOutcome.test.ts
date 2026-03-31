import { describe, expect, it } from "vitest";
import type { WorkflowArtifact, WorkflowTaskView } from "../../../types/workflow";
import { findArtifactOutcome } from "./findArtifactOutcome";

const makeTask = (
  iterations: Array<{ stage: string; iteration_number: number; outcome?: { type: string } }>,
) => ({ iterations }) as unknown as WorkflowTaskView;

const makeArtifact = (stage: string, iteration: number) =>
  ({ stage, iteration }) as unknown as WorkflowArtifact;

describe("findArtifactOutcome", () => {
  it("finds matching iteration outcome", () => {
    const task = makeTask([
      { stage: "review", iteration_number: 1, outcome: { type: "approved" } },
    ]);
    const result = findArtifactOutcome(task, makeArtifact("review", 1));
    expect(result).toEqual({ type: "approved" });
  });

  it("returns undefined when no matching stage", () => {
    const task = makeTask([{ stage: "work", iteration_number: 1, outcome: { type: "completed" } }]);
    const result = findArtifactOutcome(task, makeArtifact("review", 1));
    expect(result).toBeUndefined();
  });

  it("returns undefined when iteration number does not match", () => {
    const task = makeTask([
      { stage: "review", iteration_number: 2, outcome: { type: "approved" } },
    ]);
    const result = findArtifactOutcome(task, makeArtifact("review", 1));
    expect(result).toBeUndefined();
  });

  it("returns undefined when iteration has no outcome", () => {
    const task = makeTask([{ stage: "review", iteration_number: 1 }]);
    const result = findArtifactOutcome(task, makeArtifact("review", 1));
    expect(result).toBeUndefined();
  });

  it("prefers the last match when multiple iterations share stage and number", () => {
    const task = makeTask([
      { stage: "review", iteration_number: 1, outcome: { type: "rejected" } },
      { stage: "review", iteration_number: 1, outcome: { type: "approved" } },
    ]);
    const result = findArtifactOutcome(task, makeArtifact("review", 1));
    expect(result).toEqual({ type: "approved" });
  });
});
