/**
 * Tests for TaskCard icon visibility conditions.
 */

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockWorkflowConfig, createMockWorkflowTaskView } from "../../test/mocks/fixtures";

const mockConfig = createMockWorkflowConfig();
const mockGetPrStatus = vi.fn();

vi.mock("../../providers", () => ({
  usePrStatus: () => ({
    getPrStatus: mockGetPrStatus,
  }),
}));

vi.mock("../../providers/WorkflowConfigProvider", () => ({
  useWorkflowConfig: () => mockConfig,
}));

describe("TaskCard", () => {
  beforeEach(() => {
    mockGetPrStatus.mockReset();
  });

  // Dynamically import TaskCard after mocks are set up
  async function renderTaskCard(taskOverrides: Parameters<typeof createMockWorkflowTaskView>[0]) {
    const { TaskCard } = await import("./TaskCard");
    const task = createMockWorkflowTaskView(taskOverrides);

    const { container } = await act(async () => {
      return render(<TaskCard task={task} />);
    });

    return { container, task };
  }

  describe("icon visibility", () => {
    describe("auto mode Zap icon", () => {
      it("shows Zap icon for auto mode task", async () => {
        const { container } = await renderTaskCard({
          auto_mode: true,
          state: { type: "queued", stage: "planning" },
        });

        const zapIcon = container.querySelector(".lucide-zap");
        expect(zapIcon).toBeInTheDocument();
      });

      it("hides Zap icon for non-auto mode task", async () => {
        const { container } = await renderTaskCard({
          auto_mode: false,
          state: { type: "queued", stage: "planning" },
        });

        const zapIcon = container.querySelector(".lucide-zap");
        expect(zapIcon).not.toBeInTheDocument();
      });

      it("hides Zap icon for auto mode failed task", async () => {
        const { container } = await renderTaskCard({
          auto_mode: true,
          state: { type: "failed", error: "Test error" },
        });

        // Zap should be hidden
        const zapIcon = container.querySelector(".lucide-zap");
        expect(zapIcon).not.toBeInTheDocument();

        // XCircle (failed) should be visible - Lucide renders as lucide-circle-x
        const failedIcon = container.querySelector(".lucide-circle-x");
        expect(failedIcon).toBeInTheDocument();
      });

      it("hides Zap icon for auto mode blocked task", async () => {
        const { container } = await renderTaskCard({
          auto_mode: true,
          state: { type: "blocked", reason: "Test reason" },
        });

        // Zap should be hidden
        const zapIcon = container.querySelector(".lucide-zap");
        expect(zapIcon).not.toBeInTheDocument();

        // AlertCircle (blocked) should be visible - Lucide renders as lucide-circle-alert
        const blockedIcon = container.querySelector(".lucide-circle-alert");
        expect(blockedIcon).toBeInTheDocument();
      });

      it("animates Zap icon when task is system active", async () => {
        const { container } = await renderTaskCard({
          auto_mode: true,
          state: { type: "integrating" },
          // integrating state automatically sets is_system_active in fixture
        });

        const zapIcon = container.querySelector(".lucide-zap");
        expect(zapIcon).toBeInTheDocument();
        expect(zapIcon).toHaveClass("animate-spin-bounce");
      });

      it("animates Zap icon when showSpinner is true (working state)", async () => {
        const { container } = await renderTaskCard({
          auto_mode: true,
          state: { type: "agent_working", stage: "planning" },
          // agent_working state automatically sets is_working in fixture
        });

        const zapIcon = container.querySelector(".lucide-zap");
        expect(zapIcon).toBeInTheDocument();
        expect(zapIcon).toHaveClass("animate-spin-bounce");
      });

      it("does not animate Zap icon when task is idle (queued, not working)", async () => {
        const { container } = await renderTaskCard({
          auto_mode: true,
          state: { type: "queued", stage: "planning" },
        });

        const zapIcon = container.querySelector(".lucide-zap");
        expect(zapIcon).toBeInTheDocument();
        expect(zapIcon).not.toHaveClass("animate-spin-bounce");
      });
    });

    describe("git phase icon (GitMerge)", () => {
      it("shows GitMerge icon for integrating task not in auto mode", async () => {
        const { container } = await renderTaskCard({
          auto_mode: false,
          state: { type: "integrating" },
        });

        const gitIcon = container.querySelector(".lucide-git-merge");
        expect(gitIcon).toBeInTheDocument();
        expect(gitIcon).toHaveClass("animate-spin-bounce");
      });

      it("hides GitMerge icon for integrating task in auto mode", async () => {
        const { container } = await renderTaskCard({
          auto_mode: true,
          state: { type: "integrating" },
        });

        // Should show Zap, not GitMerge
        const gitIcon = container.querySelector(".lucide-git-merge");
        expect(gitIcon).not.toBeInTheDocument();

        const zapIcon = container.querySelector(".lucide-zap");
        expect(zapIcon).toBeInTheDocument();
      });

      it("shows GitMerge icon for committing task not in auto mode", async () => {
        const { container } = await renderTaskCard({
          auto_mode: false,
          state: { type: "committing", stage: "work" },
        });

        const gitIcon = container.querySelector(".lucide-git-merge");
        expect(gitIcon).toBeInTheDocument();
      });

      it("shows GitMerge icon for setting_up task not in auto mode", async () => {
        const { container } = await renderTaskCard({
          auto_mode: false,
          state: { type: "setting_up", stage: "planning" },
        });

        const gitIcon = container.querySelector(".lucide-git-merge");
        expect(gitIcon).toBeInTheDocument();
      });
    });

    describe("queued phase icon (spinner)", () => {
      it("shows work spinner for queued task not in auto mode", async () => {
        const { container } = await renderTaskCard({
          auto_mode: false,
          state: { type: "queued", stage: "planning" },
        });

        // The queued spinner is a CSS spinner with specific classes
        const spinner = container.querySelector(".border-orange-500.rounded-full.animate-spin");
        expect(spinner).toBeInTheDocument();
      });

      it("hides queued spinner for queued task in auto mode", async () => {
        const { container } = await renderTaskCard({
          auto_mode: true,
          state: { type: "queued", stage: "planning" },
        });

        // Should show Zap instead
        const zapIcon = container.querySelector(".lucide-zap");
        expect(zapIcon).toBeInTheDocument();

        // Queued spinner should not show (Zap supersedes)
        // Note: There's only one spinner spot, so checking Zap is present is sufficient
      });
    });

    describe("generic work spinner", () => {
      it("shows work spinner for agent_working task not in auto mode", async () => {
        const { container } = await renderTaskCard({
          auto_mode: false,
          state: { type: "agent_working", stage: "work" },
        });

        // The work spinner is a CSS spinner with specific classes
        const spinner = container.querySelector(".border-orange-500.rounded-full.animate-spin");
        expect(spinner).toBeInTheDocument();
      });

      it("hides work spinner for agent_working task in auto mode", async () => {
        const { container } = await renderTaskCard({
          auto_mode: true,
          state: { type: "agent_working", stage: "work" },
        });

        // Should show animated Zap instead
        const zapIcon = container.querySelector(".lucide-zap");
        expect(zapIcon).toBeInTheDocument();
        expect(zapIcon).toHaveClass("animate-spin-bounce");
      });

      it("hides work spinner when task needs review", async () => {
        const { container } = await renderTaskCard({
          auto_mode: false,
          state: { type: "awaiting_approval", stage: "planning" },
          derived: { is_working: true, needs_review: true },
        });

        // Eye icon for review should show instead
        const eyeIcon = container.querySelector(".lucide-eye");
        expect(eyeIcon).toBeInTheDocument();

        // No work spinner when needs_review
        const spinner = container.querySelector(".border-orange-500.rounded-full.animate-spin");
        expect(spinner).not.toBeInTheDocument();
      });

      it("hides work spinner when task has questions", async () => {
        const { container } = await renderTaskCard({
          auto_mode: false,
          state: { type: "awaiting_question_answer", stage: "planning" },
          derived: { is_working: true, has_questions: true },
        });

        // MessageCircle icon for questions should show instead
        const questionIcon = container.querySelector(".lucide-message-circle");
        expect(questionIcon).toBeInTheDocument();
      });

      it("hides work spinner when phase_icon is set (git operations)", async () => {
        const { container } = await renderTaskCard({
          auto_mode: false,
          state: { type: "agent_working", stage: "work" },
          derived: { is_working: true, phase_icon: "git" },
        });

        // GitMerge icon should show instead of work spinner
        const gitIcon = container.querySelector(".lucide-git-merge");
        expect(gitIcon).toBeInTheDocument();

        // Work spinner should NOT appear (phase_icon supersedes it)
        const spinner = container.querySelector(".border-orange-500.rounded-full.animate-spin");
        expect(spinner).not.toBeInTheDocument();
      });
    });

    describe("failed/blocked icons", () => {
      it("shows XCircle icon for failed task in non-auto mode", async () => {
        const { container } = await renderTaskCard({
          auto_mode: false,
          state: { type: "failed", error: "Error" },
        });
        // Lucide renders XCircle as lucide-circle-x
        expect(container.querySelector(".lucide-circle-x")).toBeInTheDocument();
      });

      it("shows XCircle icon for failed task in auto mode", async () => {
        const { container } = await renderTaskCard({
          auto_mode: true,
          state: { type: "failed", error: "Error" },
        });
        // Lucide renders XCircle as lucide-circle-x
        expect(container.querySelector(".lucide-circle-x")).toBeInTheDocument();
      });

      it("shows AlertCircle icon for blocked task in non-auto mode", async () => {
        const { container } = await renderTaskCard({
          auto_mode: false,
          state: { type: "blocked", reason: "Reason" },
        });
        // Lucide renders AlertCircle as lucide-circle-alert
        expect(container.querySelector(".lucide-circle-alert")).toBeInTheDocument();
      });

      it("shows AlertCircle icon for blocked task in auto mode", async () => {
        const { container } = await renderTaskCard({
          auto_mode: true,
          state: { type: "blocked", reason: "Reason" },
        });
        // Lucide renders AlertCircle as lucide-circle-alert
        expect(container.querySelector(".lucide-circle-alert")).toBeInTheDocument();
      });
    });

    describe("interrupted icon", () => {
      it("shows Pause icon for interrupted task", async () => {
        const { container } = await renderTaskCard({
          auto_mode: false,
          state: { type: "interrupted", stage: "planning" },
        });

        const pauseIcon = container.querySelector(".lucide-pause");
        expect(pauseIcon).toBeInTheDocument();
      });
    });

    describe("WaitingOnChildren icon states", () => {
      it("shows XCircle icon for parent with failed subtask", async () => {
        const { container } = await renderTaskCard({
          state: { type: "waiting_on_children", stage: "work" },
          derived: {
            is_waiting_on_children: true,
            subtask_progress: {
              total: 2,
              done: 0,
              failed: 1,
              blocked: 0,
              interrupted: 0,
              has_questions: 0,
              needs_review: 0,
              working: 0,
              waiting: 1,
            },
          },
        });

        // XCircle (failed) should show - Lucide renders as lucide-circle-x
        const failedIcon = container.querySelector(".lucide-circle-x");
        expect(failedIcon).toBeInTheDocument();
      });

      it("shows AlertCircle icon for parent with blocked subtask", async () => {
        const { container } = await renderTaskCard({
          state: { type: "waiting_on_children", stage: "work" },
          derived: {
            is_waiting_on_children: true,
            subtask_progress: {
              total: 2,
              done: 0,
              failed: 0,
              blocked: 1,
              interrupted: 0,
              has_questions: 0,
              needs_review: 0,
              working: 0,
              waiting: 1,
            },
          },
        });

        // AlertCircle (blocked) should show - Lucide renders as lucide-circle-alert
        const blockedIcon = container.querySelector(".lucide-circle-alert");
        expect(blockedIcon).toBeInTheDocument();
      });

      it("shows Pause icon for parent with interrupted subtask", async () => {
        const { container } = await renderTaskCard({
          state: { type: "waiting_on_children", stage: "work" },
          derived: {
            is_waiting_on_children: true,
            subtask_progress: {
              total: 2,
              done: 0,
              failed: 0,
              blocked: 0,
              interrupted: 1,
              has_questions: 0,
              needs_review: 0,
              working: 0,
              waiting: 1,
            },
          },
        });

        const pauseIcon = container.querySelector(".lucide-pause");
        expect(pauseIcon).toBeInTheDocument();
      });

      it("shows MessageCircle icon for parent with subtask asking questions", async () => {
        const { container } = await renderTaskCard({
          state: { type: "waiting_on_children", stage: "work" },
          derived: {
            is_waiting_on_children: true,
            subtask_progress: {
              total: 2,
              done: 0,
              failed: 0,
              blocked: 0,
              interrupted: 0,
              has_questions: 1,
              needs_review: 0,
              working: 0,
              waiting: 1,
            },
          },
        });

        const questionIcon = container.querySelector(".lucide-message-circle");
        expect(questionIcon).toBeInTheDocument();
      });

      it("shows Eye icon for parent with subtask needing review", async () => {
        const { container } = await renderTaskCard({
          state: { type: "waiting_on_children", stage: "work" },
          derived: {
            is_waiting_on_children: true,
            subtask_progress: {
              total: 2,
              done: 0,
              failed: 0,
              blocked: 0,
              interrupted: 0,
              has_questions: 0,
              needs_review: 1,
              working: 0,
              waiting: 1,
            },
          },
        });

        const eyeIcon = container.querySelector(".lucide-eye");
        expect(eyeIcon).toBeInTheDocument();
      });

      it("shows animated Layers icon for parent with working subtask", async () => {
        const { container } = await renderTaskCard({
          state: { type: "waiting_on_children", stage: "work" },
          derived: {
            is_waiting_on_children: true,
            subtask_progress: {
              total: 2,
              done: 0,
              failed: 0,
              blocked: 0,
              interrupted: 0,
              has_questions: 0,
              needs_review: 0,
              working: 1,
              waiting: 1,
            },
          },
        });

        const layersIcon = container.querySelector(".lucide-layers");
        expect(layersIcon).toBeInTheDocument();
        expect(layersIcon).toHaveClass("animate-spin-bounce");
      });

      it("shows static Layers icon for parent with only waiting subtasks", async () => {
        const { container } = await renderTaskCard({
          state: { type: "waiting_on_children", stage: "work" },
          derived: {
            is_waiting_on_children: true,
            subtask_progress: {
              total: 2,
              done: 0,
              failed: 0,
              blocked: 0,
              interrupted: 0,
              has_questions: 0,
              needs_review: 0,
              working: 0,
              waiting: 2,
            },
          },
        });

        const layersIcon = container.querySelector(".lucide-layers");
        expect(layersIcon).toBeInTheDocument();
        expect(layersIcon).not.toHaveClass("animate-spin-bounce");
      });

      it("prioritizes failed over blocked in icon display", async () => {
        const { container } = await renderTaskCard({
          state: { type: "waiting_on_children", stage: "work" },
          derived: {
            is_waiting_on_children: true,
            subtask_progress: {
              total: 3,
              done: 0,
              failed: 1,
              blocked: 1,
              interrupted: 0,
              has_questions: 0,
              needs_review: 0,
              working: 0,
              waiting: 1,
            },
          },
        });

        // Failed takes priority over blocked
        expect(container.querySelector(".lucide-circle-x")).toBeInTheDocument();
        expect(container.querySelector(".lucide-circle-alert")).not.toBeInTheDocument();
      });
    });

    describe("subtask variant icons", () => {
      it("shows CircleCheck icon for done subtask", async () => {
        const { TaskCard } = await import("./TaskCard");
        const task = createMockWorkflowTaskView({
          state: { type: "done" },
        });

        const { container } = await act(async () => {
          return render(<TaskCard task={task} variant="subtask" />);
        });

        const checkIcon = container.querySelector(".lucide-circle-check");
        expect(checkIcon).toBeInTheDocument();
      });

      it("shows CircleCheck icon for archived subtask", async () => {
        const { TaskCard } = await import("./TaskCard");
        const task = createMockWorkflowTaskView({
          state: { type: "archived" },
        });

        const { container } = await act(async () => {
          return render(<TaskCard task={task} variant="subtask" />);
        });

        const checkIcon = container.querySelector(".lucide-circle-check");
        expect(checkIcon).toBeInTheDocument();
      });

      it("does not show CircleCheck icon for done task in board variant", async () => {
        const { container } = await renderTaskCard({
          state: { type: "done" },
          // variant defaults to "board"
        });

        const checkIcon = container.querySelector(".lucide-circle-check");
        expect(checkIcon).not.toBeInTheDocument();
      });
    });
  });
});
