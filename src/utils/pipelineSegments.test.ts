//! Unit tests for pipelineSegments.ts.

import { describe, expect, it } from "vitest";
import { createMockWorkflowConfig, createMockWorkflowTaskView } from "../test/mocks/fixtures";
import { computePipelineSegments } from "./pipelineSegments";

describe("computePipelineSegments", () => {
  const config = createMockWorkflowConfig();
  // config has stages: ["planning", "work"]

  describe("normal progression", () => {
    it("marks stages before current as done, current as active, after as pending", () => {
      const task = createMockWorkflowTaskView({
        state: { type: "agent_working", stage: "work" },
      });
      const segments = computePipelineSegments(task, config);
      expect(segments).toHaveLength(2);
      expect(segments[0]).toEqual({ stageName: "planning", state: "done" });
      expect(segments[1]).toEqual({ stageName: "work", state: "active" });
    });

    it("marks all pending when at first stage and idle", () => {
      const task = createMockWorkflowTaskView({
        state: { type: "queued", stage: "planning" },
      });
      const segments = computePipelineSegments(task, config);
      expect(segments[0]).toEqual({ stageName: "planning", state: "review" });
      expect(segments[1]).toEqual({ stageName: "work", state: "pending" });
    });
  });

  describe("failed state", () => {
    it("marks current as failed and stages after as dim", () => {
      const task = createMockWorkflowTaskView({
        state: { type: "agent_working", stage: "planning" },
        derived: { is_failed: true, current_stage: "planning" },
      });
      const segments = computePipelineSegments(task, config);
      expect(segments[0]).toEqual({ stageName: "planning", state: "failed" });
      expect(segments[1]).toEqual({ stageName: "work", state: "dim" });
    });
  });

  describe("review state", () => {
    it("marks current stage as review when awaiting_approval", () => {
      const task = createMockWorkflowTaskView({
        state: { type: "awaiting_approval", stage: "work" },
      });
      const segments = computePipelineSegments(task, config);
      expect(segments[0]).toEqual({ stageName: "planning", state: "done" });
      expect(segments[1]).toEqual({ stageName: "work", state: "review" });
    });

    it("marks current stage as review when has_questions", () => {
      const task = createMockWorkflowTaskView({
        state: { type: "awaiting_question_answer", stage: "planning" },
      });
      const segments = computePipelineSegments(task, config);
      expect(segments[0]).toEqual({ stageName: "planning", state: "review" });
    });
  });

  describe("done task", () => {
    it("marks all segments as done for done tasks", () => {
      const task = createMockWorkflowTaskView({ state: { type: "done" } });
      const segments = computePipelineSegments(task, config);
      expect(segments).toHaveLength(2);
      for (const seg of segments) {
        expect(seg.state).toBe("done");
      }
    });

    it("marks all segments as done for archived tasks", () => {
      const task = createMockWorkflowTaskView({ state: { type: "archived" } });
      const segments = computePipelineSegments(task, config);
      for (const seg of segments) {
        expect(seg.state).toBe("done");
      }
    });
  });

  describe("integrating task", () => {
    it("marks all stage segments as done and appends integration segment", () => {
      const task = createMockWorkflowTaskView({ state: { type: "integrating" } });
      const segments = computePipelineSegments(task, config);
      expect(segments).toHaveLength(3);
      expect(segments[0]).toEqual({ stageName: "planning", state: "done" });
      expect(segments[1]).toEqual({ stageName: "work", state: "done" });
      expect(segments[2]).toEqual({ stageName: "integration", state: "integration" });
    });
  });

  describe("flow-aware stage resolution", () => {
    it("uses flow stages when task has a flow", () => {
      const configWithFlow = {
        ...config,
        flows: {
          quick: {
            description: "Quick flow",
            stages: ["work"],
          },
        },
      };
      const task = createMockWorkflowTaskView({
        flow: "quick",
        state: { type: "agent_working", stage: "work" },
      });
      const segments = computePipelineSegments(task, configWithFlow);
      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({ stageName: "work", state: "active" });
    });

    it("falls back to global stages when flow does not exist in config", () => {
      const task = createMockWorkflowTaskView({
        flow: "nonexistent",
        state: { type: "agent_working", stage: "work" },
      });
      const segments = computePipelineSegments(task, config);
      expect(segments).toHaveLength(2);
    });
  });
});
