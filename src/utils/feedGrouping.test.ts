//! Unit tests for feedGrouping.ts.

import { describe, expect, it } from "vitest";
import { createMockWorkflowTaskView } from "../test/mocks/fixtures";
import type { FeedSectionName } from "./feedGrouping";
import { groupTasksForFeed } from "./feedGrouping";

function sectionTasks(result: ReturnType<typeof groupTasksForFeed>, name: FeedSectionName) {
  return result.sections.find((s) => s.name === name)?.tasks ?? [];
}

describe("groupTasksForFeed", () => {
  describe("section classification", () => {
    it("maps awaiting_approval to needs_review", () => {
      const task = createMockWorkflowTaskView({
        state: { type: "awaiting_approval", stage: "work" },
      });
      const result = groupTasksForFeed([task]);
      expect(sectionTasks(result, "needs_review")).toContain(task);
      expect(sectionTasks(result, "in_progress")).toHaveLength(0);
    });

    it("maps awaiting_question_answer to needs_review", () => {
      const task = createMockWorkflowTaskView({
        state: { type: "awaiting_question_answer", stage: "planning" },
      });
      expect(sectionTasks(groupTasksForFeed([task]), "needs_review")).toContain(task);
    });

    it("maps awaiting_rejection_confirmation to needs_review", () => {
      const task = createMockWorkflowTaskView({
        derived: { needs_review: true },
      });
      expect(sectionTasks(groupTasksForFeed([task]), "needs_review")).toContain(task);
    });

    it("maps done to completed", () => {
      const task = createMockWorkflowTaskView({ state: { type: "done" } });
      expect(sectionTasks(groupTasksForFeed([task]), "completed")).toContain(task);
    });

    it("maps archived to completed", () => {
      const task = createMockWorkflowTaskView({ state: { type: "archived" } });
      expect(sectionTasks(groupTasksForFeed([task]), "completed")).toContain(task);
    });

    it("maps agent_working to in_progress", () => {
      const task = createMockWorkflowTaskView({
        state: { type: "agent_working", stage: "work" },
      });
      expect(sectionTasks(groupTasksForFeed([task]), "in_progress")).toContain(task);
    });

    it("maps failed to in_progress", () => {
      const task = createMockWorkflowTaskView({ state: { type: "failed" } });
      expect(sectionTasks(groupTasksForFeed([task]), "in_progress")).toContain(task);
    });

    it("maps blocked to in_progress", () => {
      const task = createMockWorkflowTaskView({ state: { type: "blocked" } });
      expect(sectionTasks(groupTasksForFeed([task]), "in_progress")).toContain(task);
    });

    it("maps interrupted to in_progress", () => {
      const task = createMockWorkflowTaskView({
        state: { type: "interrupted", stage: "work" },
      });
      expect(sectionTasks(groupTasksForFeed([task]), "in_progress")).toContain(task);
    });

    it("maps waiting_on_children to in_progress", () => {
      const task = createMockWorkflowTaskView({
        state: { type: "waiting_on_children", stage: "work" },
      });
      expect(sectionTasks(groupTasksForFeed([task]), "in_progress")).toContain(task);
    });

    it("maps queued to in_progress", () => {
      const task = createMockWorkflowTaskView({
        state: { type: "queued", stage: "planning" },
      });
      expect(sectionTasks(groupTasksForFeed([task]), "in_progress")).toContain(task);
    });
  });

  describe("subtask surfacing", () => {
    it("surfaces subtasks with is_failed into needs_review", () => {
      const subtask = createMockWorkflowTaskView({
        id: "sub-1",
        parent_id: "parent-1",
        state: { type: "failed" },
      });
      const { surfacedSubtasks } = groupTasksForFeed([subtask]);
      expect(surfacedSubtasks).toContain(subtask);
    });

    it("surfaces subtasks with needs_review into needs_review", () => {
      const subtask = createMockWorkflowTaskView({
        id: "sub-2",
        parent_id: "parent-1",
        state: { type: "awaiting_approval", stage: "work" },
      });
      const { surfacedSubtasks } = groupTasksForFeed([subtask]);
      expect(surfacedSubtasks).toContain(subtask);
    });

    it("surfaces subtasks with has_questions into needs_review", () => {
      const subtask = createMockWorkflowTaskView({
        id: "sub-3",
        parent_id: "parent-1",
        state: { type: "awaiting_question_answer", stage: "planning" },
      });
      const { surfacedSubtasks } = groupTasksForFeed([subtask]);
      expect(surfacedSubtasks).toContain(subtask);
    });

    it("does NOT surface subtasks that are working", () => {
      const subtask = createMockWorkflowTaskView({
        id: "sub-4",
        parent_id: "parent-1",
        state: { type: "agent_working", stage: "work" },
      });
      const { surfacedSubtasks } = groupTasksForFeed([subtask]);
      expect(surfacedSubtasks).not.toContain(subtask);
    });

    it("does NOT include subtasks in main sections", () => {
      const subtask = createMockWorkflowTaskView({
        id: "sub-5",
        parent_id: "parent-1",
        state: { type: "awaiting_approval", stage: "work" },
      });
      const { sections } = groupTasksForFeed([subtask]);
      for (const section of sections) {
        expect(section.tasks).not.toContain(subtask);
      }
    });
  });

  describe("sort order within sections", () => {
    it("sorts tasks within sections by priority (failed before working)", () => {
      const failed = createMockWorkflowTaskView({
        id: "task-failed",
        state: { type: "agent_working", stage: "work" },
        derived: { is_failed: true },
        created_at: "2025-01-02T00:00:00Z",
      });
      const working = createMockWorkflowTaskView({
        id: "task-working",
        state: { type: "agent_working", stage: "work" },
        created_at: "2025-01-01T00:00:00Z",
      });
      const inProgress = sectionTasks(groupTasksForFeed([working, failed]), "in_progress");
      expect(inProgress[0].id).toBe("task-failed");
      expect(inProgress[1].id).toBe("task-working");
    });

    it("sorts by created_at within the same priority tier (oldest first)", () => {
      const older = createMockWorkflowTaskView({
        id: "older",
        state: { type: "agent_working", stage: "work" },
        created_at: "2025-01-01T00:00:00Z",
      });
      const newer = createMockWorkflowTaskView({
        id: "newer",
        state: { type: "agent_working", stage: "work" },
        created_at: "2025-01-02T00:00:00Z",
      });
      const inProgress = sectionTasks(groupTasksForFeed([newer, older]), "in_progress");
      expect(inProgress[0].id).toBe("older");
    });
  });

  describe("return structure", () => {
    it("always returns all three sections", () => {
      const { sections } = groupTasksForFeed([]);
      expect(sections).toHaveLength(3);
      expect(sections.map((s) => s.name)).toEqual(["needs_review", "in_progress", "completed"]);
    });

    it("returns correct section labels", () => {
      const { sections } = groupTasksForFeed([]);
      expect(sections[0].label).toBe("NEEDS REVIEW");
      expect(sections[1].label).toBe("IN PROGRESS");
      expect(sections[2].label).toBe("COMPLETED");
    });
  });
});
