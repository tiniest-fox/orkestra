import { describe, expect, it } from "vitest";
import { createMockWorkflowTaskView } from "../test/mocks/fixtures";
import type { SubtaskProgress } from "../types/workflow";
import { getTasksForColumn } from "./kanban";

describe("getTasksForColumn", () => {
  describe("task ordering", () => {
    it("should sort failed tasks before blocked tasks", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "blocked-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { is_blocked: true },
        }),
        createMockWorkflowTaskView({
          id: "failed-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z", // Newer
          derived: { is_failed: true },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted[0].id).toBe("failed-task");
      expect(sorted[1].id).toBe("blocked-task");
    });

    it("should sort blocked tasks before tasks with questions", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "questions-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { has_questions: true },
        }),
        createMockWorkflowTaskView({
          id: "blocked-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { is_blocked: true },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted[0].id).toBe("blocked-task");
      expect(sorted[1].id).toBe("questions-task");
    });

    it("should sort tasks with questions before tasks needing review", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "review-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { needs_review: true },
        }),
        createMockWorkflowTaskView({
          id: "questions-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { has_questions: true },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted[0].id).toBe("questions-task");
      expect(sorted[1].id).toBe("review-task");
    });

    it("should sort tasks needing review before working tasks", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "working-task",
          status: { type: "active", stage: "planning" },
          phase: "agent_working",
          created_at: "2025-01-01T00:00:00Z",
          derived: { is_working: true },
        }),
        createMockWorkflowTaskView({
          id: "review-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { needs_review: true },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted[0].id).toBe("review-task");
      expect(sorted[1].id).toBe("working-task");
    });

    it("should sort working tasks before idle tasks", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "idle-task",
          status: { type: "active", stage: "planning" },
          phase: "idle",
          created_at: "2025-01-01T00:00:00Z",
          derived: { is_working: false },
        }),
        createMockWorkflowTaskView({
          id: "working-task",
          status: { type: "active", stage: "planning" },
          phase: "agent_working",
          created_at: "2025-01-02T00:00:00Z",
          derived: { is_working: true },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted[0].id).toBe("working-task");
      expect(sorted[1].id).toBe("idle-task");
    });

    it("should sort all 5 tiers correctly", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "idle-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-05T00:00:00Z",
          derived: {},
        }),
        createMockWorkflowTaskView({
          id: "working-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-04T00:00:00Z",
          derived: { is_working: true },
        }),
        createMockWorkflowTaskView({
          id: "review-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-03T00:00:00Z",
          derived: { needs_review: true },
        }),
        createMockWorkflowTaskView({
          id: "questions-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { has_questions: true },
        }),
        createMockWorkflowTaskView({
          id: "blocked-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { is_blocked: true },
        }),
        createMockWorkflowTaskView({
          id: "failed-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-06T00:00:00Z", // Newest, but should still be first
          derived: { is_failed: true },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted.map((t) => t.id)).toEqual([
        "failed-task", // Priority 0
        "blocked-task", // Priority 1
        "questions-task", // Priority 2
        "review-task", // Priority 3
        "working-task", // Priority 4
        "idle-task", // Priority 5
      ]);
    });
  });

  describe("effective state from subtask progress", () => {
    it("should sort parent with failed subtasks as failed", () => {
      const subtaskProgress: SubtaskProgress = {
        total: 3,
        done: 0,
        failed: 1,
        blocked: 0,
        has_questions: 0,
        needs_review: 0,
        working: 1,
        waiting: 1,
      };

      const tasks = [
        createMockWorkflowTaskView({
          id: "blocked-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { is_blocked: true },
        }),
        createMockWorkflowTaskView({
          id: "parent-with-failed-subtask",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { subtask_progress: subtaskProgress },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted[0].id).toBe("parent-with-failed-subtask");
      expect(sorted[1].id).toBe("blocked-task");
    });

    it("should sort parent with blocked subtasks as blocked", () => {
      const subtaskProgress: SubtaskProgress = {
        total: 2,
        done: 0,
        failed: 0,
        blocked: 1,
        has_questions: 0,
        needs_review: 0,
        working: 0,
        waiting: 1,
      };

      const tasks = [
        createMockWorkflowTaskView({
          id: "questions-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { has_questions: true },
        }),
        createMockWorkflowTaskView({
          id: "parent-with-blocked-subtask",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { subtask_progress: subtaskProgress },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted[0].id).toBe("parent-with-blocked-subtask");
      expect(sorted[1].id).toBe("questions-task");
    });

    it("should sort parent with subtask questions as has_questions", () => {
      const subtaskProgress: SubtaskProgress = {
        total: 2,
        done: 0,
        failed: 0,
        blocked: 0,
        has_questions: 1,
        needs_review: 0,
        working: 0,
        waiting: 1,
      };

      const tasks = [
        createMockWorkflowTaskView({
          id: "review-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { needs_review: true },
        }),
        createMockWorkflowTaskView({
          id: "parent-with-question-subtask",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { subtask_progress: subtaskProgress },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted[0].id).toBe("parent-with-question-subtask");
      expect(sorted[1].id).toBe("review-task");
    });

    it("should sort parent with subtask needing review as needs_review", () => {
      const subtaskProgress: SubtaskProgress = {
        total: 2,
        done: 0,
        failed: 0,
        blocked: 0,
        has_questions: 0,
        needs_review: 1,
        working: 0,
        waiting: 1,
      };

      const tasks = [
        createMockWorkflowTaskView({
          id: "working-task",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { is_working: true },
        }),
        createMockWorkflowTaskView({
          id: "parent-with-review-subtask",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { subtask_progress: subtaskProgress },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted[0].id).toBe("parent-with-review-subtask");
      expect(sorted[1].id).toBe("working-task");
    });

    it("should prioritize parent effective states correctly", () => {
      const failedSubtask: SubtaskProgress = {
        total: 1,
        done: 0,
        failed: 1,
        blocked: 0,
        has_questions: 0,
        needs_review: 0,
        working: 0,
        waiting: 0,
      };

      const blockedSubtask: SubtaskProgress = {
        total: 1,
        done: 0,
        failed: 0,
        blocked: 1,
        has_questions: 0,
        needs_review: 0,
        working: 0,
        waiting: 0,
      };

      const tasks = [
        createMockWorkflowTaskView({
          id: "parent-blocked",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { subtask_progress: blockedSubtask },
        }),
        createMockWorkflowTaskView({
          id: "parent-failed",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { subtask_progress: failedSubtask },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted[0].id).toBe("parent-failed");
      expect(sorted[1].id).toBe("parent-blocked");
    });
  });

  describe("created_at tiebreaker", () => {
    it("should sort by created_at within the same priority tier (oldest first)", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "newer-review",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-03T00:00:00Z",
          derived: { needs_review: true },
        }),
        createMockWorkflowTaskView({
          id: "oldest-review",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { needs_review: true },
        }),
        createMockWorkflowTaskView({
          id: "middle-review",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { needs_review: true },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted.map((t) => t.id)).toEqual(["oldest-review", "middle-review", "newer-review"]);
    });

    it("should apply created_at tiebreaker within each priority tier", () => {
      const tasks = [
        // Working tier
        createMockWorkflowTaskView({
          id: "newer-working",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-04T00:00:00Z",
          derived: { is_working: true },
        }),
        createMockWorkflowTaskView({
          id: "older-working",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-03T00:00:00Z",
          derived: { is_working: true },
        }),
        // Review tier (higher priority)
        createMockWorkflowTaskView({
          id: "newer-review",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { needs_review: true },
        }),
        createMockWorkflowTaskView({
          id: "older-review",
          status: { type: "active", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { needs_review: true },
        }),
      ];

      const sorted = getTasksForColumn(tasks, "planning");

      expect(sorted.map((t) => t.id)).toEqual([
        "older-review", // Priority 3, oldest
        "newer-review", // Priority 3, newer
        "older-working", // Priority 4, oldest
        "newer-working", // Priority 4, newer
      ]);
    });
  });

  describe("column filtering", () => {
    it("should only return tasks matching the specified stage", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "planning-task",
          status: { type: "active", stage: "planning" },
          derived: { current_stage: "planning" },
        }),
        createMockWorkflowTaskView({
          id: "work-task",
          status: { type: "active", stage: "work" },
          derived: { current_stage: "work" },
        }),
      ];

      const planningTasks = getTasksForColumn(tasks, "planning");

      expect(planningTasks).toHaveLength(1);
      expect(planningTasks[0].id).toBe("planning-task");
    });

    it("should return failed tasks in failed column", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "failed-task",
          status: { type: "failed", error: "Something went wrong" },
          derived: { is_failed: true },
        }),
        createMockWorkflowTaskView({
          id: "active-task",
          status: { type: "active", stage: "planning" },
          derived: { current_stage: "planning" },
        }),
      ];

      const failedTasks = getTasksForColumn(tasks, "failed");

      expect(failedTasks).toHaveLength(1);
      expect(failedTasks[0].id).toBe("failed-task");
    });
  });
});
