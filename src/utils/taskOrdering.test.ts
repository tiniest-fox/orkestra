import { describe, expect, it } from "vitest";
import { createMockWorkflowTaskView } from "../test/mocks/fixtures";
import type { SubtaskProgress } from "../types/workflow";
import { compareByPriority, sortByPriority } from "./taskOrdering";

describe("taskOrdering", () => {
  describe("compareByPriority", () => {
    it("should sort all 8 tiers correctly (including done and archived)", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "archived-task",
          state: { type: "archived" },
          created_at: "2025-01-09T00:00:00Z",
          derived: { is_archived: true },
        }),
        createMockWorkflowTaskView({
          id: "idle-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-06T00:00:00Z",
          derived: {},
        }),
        createMockWorkflowTaskView({
          id: "working-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-05T00:00:00Z",
          derived: { is_working: true },
        }),
        createMockWorkflowTaskView({
          id: "review-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-04T00:00:00Z",
          derived: { needs_review: true },
        }),
        createMockWorkflowTaskView({
          id: "questions-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-03T00:00:00Z",
          derived: { has_questions: true },
        }),
        createMockWorkflowTaskView({
          id: "interrupted-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { is_interrupted: true },
        }),
        createMockWorkflowTaskView({
          id: "blocked-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { is_blocked: true },
        }),
        createMockWorkflowTaskView({
          id: "failed-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-07T00:00:00Z", // Newest, but should still be first
          derived: { is_failed: true },
        }),
        createMockWorkflowTaskView({
          id: "done-task",
          state: { type: "done" },
          created_at: "2025-01-08T00:00:00Z",
          derived: { is_done: true },
        }),
      ];

      const sorted = [...tasks].sort(compareByPriority);

      expect(sorted.map((t) => t.id)).toEqual([
        "failed-task", // Priority 0
        "blocked-task", // Priority 1
        "interrupted-task", // Priority 2
        "questions-task", // Priority 3
        "review-task", // Priority 4
        "working-task", // Priority 5
        "idle-task", // Priority 6
        "done-task", // Priority 7
        "archived-task", // Priority 8
      ]);
    });

    it("should sort done tasks after all active states", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "done-task",
          state: { type: "done" },
          created_at: "2025-01-01T00:00:00Z", // Oldest
          derived: { is_done: true },
        }),
        createMockWorkflowTaskView({
          id: "idle-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: {},
        }),
      ];

      const sorted = [...tasks].sort(compareByPriority);

      expect(sorted[0].id).toBe("idle-task");
      expect(sorted[1].id).toBe("done-task");
    });

    it("should sort archived tasks after done tasks", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "archived-task",
          state: { type: "archived" },
          created_at: "2025-01-01T00:00:00Z", // Oldest
          derived: { is_archived: true },
        }),
        createMockWorkflowTaskView({
          id: "done-task",
          state: { type: "done" },
          created_at: "2025-01-02T00:00:00Z",
          derived: { is_done: true },
        }),
      ];

      const sorted = [...tasks].sort(compareByPriority);

      expect(sorted[0].id).toBe("done-task");
      expect(sorted[1].id).toBe("archived-task");
    });

    describe("subtask progress aggregation", () => {
      it("should sort parent with failed subtasks as failed", () => {
        const subtaskProgress: SubtaskProgress = {
          total: 3,
          done: 0,
          failed: 1,
          blocked: 0,
          interrupted: 0,
          has_questions: 0,
          needs_review: 0,
          working: 1,
          waiting: 1,
        };

        const tasks = [
          createMockWorkflowTaskView({
            id: "blocked-task",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-01T00:00:00Z",
            derived: { is_blocked: true },
          }),
          createMockWorkflowTaskView({
            id: "parent-with-failed-subtask",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-02T00:00:00Z",
            derived: { subtask_progress: subtaskProgress },
          }),
        ];

        const sorted = [...tasks].sort(compareByPriority);

        expect(sorted[0].id).toBe("parent-with-failed-subtask");
        expect(sorted[1].id).toBe("blocked-task");
      });

      it("should sort parent with blocked subtasks as blocked", () => {
        const subtaskProgress: SubtaskProgress = {
          total: 2,
          done: 0,
          failed: 0,
          blocked: 1,
          interrupted: 0,
          has_questions: 0,
          needs_review: 0,
          working: 0,
          waiting: 1,
        };

        const tasks = [
          createMockWorkflowTaskView({
            id: "interrupted-task",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-01T00:00:00Z",
            derived: { is_interrupted: true },
          }),
          createMockWorkflowTaskView({
            id: "parent-with-blocked-subtask",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-02T00:00:00Z",
            derived: { subtask_progress: subtaskProgress },
          }),
        ];

        const sorted = [...tasks].sort(compareByPriority);

        expect(sorted[0].id).toBe("parent-with-blocked-subtask");
        expect(sorted[1].id).toBe("interrupted-task");
      });

      it("should sort parent with interrupted subtasks as interrupted", () => {
        const subtaskProgress: SubtaskProgress = {
          total: 2,
          done: 0,
          failed: 0,
          blocked: 0,
          interrupted: 1,
          has_questions: 0,
          needs_review: 0,
          working: 0,
          waiting: 1,
        };

        const tasks = [
          createMockWorkflowTaskView({
            id: "questions-task",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-01T00:00:00Z",
            derived: { has_questions: true },
          }),
          createMockWorkflowTaskView({
            id: "parent-with-interrupted-subtask",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-02T00:00:00Z",
            derived: { subtask_progress: subtaskProgress },
          }),
        ];

        const sorted = [...tasks].sort(compareByPriority);

        expect(sorted[0].id).toBe("parent-with-interrupted-subtask");
        expect(sorted[1].id).toBe("questions-task");
      });

      it("should sort parent with subtask questions as has_questions", () => {
        const subtaskProgress: SubtaskProgress = {
          total: 2,
          done: 0,
          failed: 0,
          blocked: 0,
          interrupted: 0,
          has_questions: 1,
          needs_review: 0,
          working: 0,
          waiting: 1,
        };

        const tasks = [
          createMockWorkflowTaskView({
            id: "review-task",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-01T00:00:00Z",
            derived: { needs_review: true },
          }),
          createMockWorkflowTaskView({
            id: "parent-with-question-subtask",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-02T00:00:00Z",
            derived: { subtask_progress: subtaskProgress },
          }),
        ];

        const sorted = [...tasks].sort(compareByPriority);

        expect(sorted[0].id).toBe("parent-with-question-subtask");
        expect(sorted[1].id).toBe("review-task");
      });

      it("should sort parent with subtask needing review as needs_review", () => {
        const subtaskProgress: SubtaskProgress = {
          total: 2,
          done: 0,
          failed: 0,
          blocked: 0,
          interrupted: 0,
          has_questions: 0,
          needs_review: 1,
          working: 0,
          waiting: 1,
        };

        const tasks = [
          createMockWorkflowTaskView({
            id: "working-task",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-01T00:00:00Z",
            derived: { is_working: true },
          }),
          createMockWorkflowTaskView({
            id: "parent-with-review-subtask",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-02T00:00:00Z",
            derived: { subtask_progress: subtaskProgress },
          }),
        ];

        const sorted = [...tasks].sort(compareByPriority);

        expect(sorted[0].id).toBe("parent-with-review-subtask");
        expect(sorted[1].id).toBe("working-task");
      });
    });

    describe("created_at tiebreaker", () => {
      it("should sort by created_at within the same priority tier (oldest first)", () => {
        const tasks = [
          createMockWorkflowTaskView({
            id: "newer-review",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-03T00:00:00Z",
            derived: { needs_review: true },
          }),
          createMockWorkflowTaskView({
            id: "oldest-review",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-01T00:00:00Z",
            derived: { needs_review: true },
          }),
          createMockWorkflowTaskView({
            id: "middle-review",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-02T00:00:00Z",
            derived: { needs_review: true },
          }),
        ];

        const sorted = [...tasks].sort(compareByPriority);

        expect(sorted.map((t) => t.id)).toEqual(["oldest-review", "middle-review", "newer-review"]);
      });

      it("should apply created_at tiebreaker across tiers including done and archived", () => {
        const tasks = [
          // Done tier
          createMockWorkflowTaskView({
            id: "newer-done",
            state: { type: "done" },
            created_at: "2025-01-06T00:00:00Z",
            derived: { is_done: true },
          }),
          createMockWorkflowTaskView({
            id: "older-done",
            state: { type: "done" },
            created_at: "2025-01-05T00:00:00Z",
            derived: { is_done: true },
          }),
          // Archived tier
          createMockWorkflowTaskView({
            id: "newer-archived",
            state: { type: "archived" },
            created_at: "2025-01-08T00:00:00Z",
            derived: { is_archived: true },
          }),
          createMockWorkflowTaskView({
            id: "older-archived",
            state: { type: "archived" },
            created_at: "2025-01-07T00:00:00Z",
            derived: { is_archived: true },
          }),
          // Idle tier (higher priority)
          createMockWorkflowTaskView({
            id: "newer-idle",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-04T00:00:00Z",
            derived: {},
          }),
          createMockWorkflowTaskView({
            id: "older-idle",
            state: { type: "queued", stage: "planning" },
            created_at: "2025-01-03T00:00:00Z",
            derived: {},
          }),
        ];

        const sorted = [...tasks].sort(compareByPriority);

        expect(sorted.map((t) => t.id)).toEqual([
          "older-idle", // Priority 6, oldest
          "newer-idle", // Priority 6, newer
          "older-done", // Priority 7, oldest
          "newer-done", // Priority 7, newer
          "older-archived", // Priority 8, oldest
          "newer-archived", // Priority 8, newer
        ]);
      });
    });
  });

  describe("sortByPriority", () => {
    it("should return a new sorted array without mutating the original", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "idle-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: {},
        }),
        createMockWorkflowTaskView({
          id: "failed-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { is_failed: true },
        }),
      ];

      const originalIds = tasks.map((t) => t.id);
      const sorted = sortByPriority(tasks);

      // Original should be unchanged
      expect(tasks.map((t) => t.id)).toEqual(originalIds);
      // Sorted should have new order
      expect(sorted.map((t) => t.id)).toEqual(["failed-task", "idle-task"]);
    });

    it("should produce the same result as compareByPriority", () => {
      const tasks = [
        createMockWorkflowTaskView({
          id: "archived-task",
          state: { type: "archived" },
          created_at: "2025-01-05T00:00:00Z",
          derived: { is_archived: true },
        }),
        createMockWorkflowTaskView({
          id: "working-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-03T00:00:00Z",
          derived: { is_working: true },
        }),
        createMockWorkflowTaskView({
          id: "done-task",
          state: { type: "done" },
          created_at: "2025-01-04T00:00:00Z",
          derived: { is_done: true },
        }),
        createMockWorkflowTaskView({
          id: "failed-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-01T00:00:00Z",
          derived: { is_failed: true },
        }),
        createMockWorkflowTaskView({
          id: "idle-task",
          state: { type: "queued", stage: "planning" },
          created_at: "2025-01-02T00:00:00Z",
          derived: {},
        }),
      ];

      const sortedManual = [...tasks].sort(compareByPriority);
      const sortedHelper = sortByPriority(tasks);

      expect(sortedHelper.map((t) => t.id)).toEqual(sortedManual.map((t) => t.id));
    });
  });
});
