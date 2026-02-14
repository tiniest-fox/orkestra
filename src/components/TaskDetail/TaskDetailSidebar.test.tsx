import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockArtifact,
  createMockWorkflowConfig,
  createMockWorkflowTaskView,
} from "../../test/mocks/fixtures";
import { resetMocks } from "../../test/mocks/tauri";
import { TaskDetailSidebar } from "./TaskDetailSidebar";

// Create stable mock action functions
const mockApprove = vi.fn(() => Promise.resolve());
const mockReject = vi.fn(() => Promise.resolve());
const mockAnswerQuestions = vi.fn(() => Promise.resolve());
const mockRetry = vi.fn(() => Promise.resolve());
const mockRefetch = vi.fn(() => Promise.resolve());
const mockMergeTask = vi.fn(() => Promise.resolve());
const mockOpenPr = vi.fn(() => Promise.resolve());
const mockRetryPr = vi.fn(() => Promise.resolve());
const mockConfig = createMockWorkflowConfig();

// Mock the providers
const mockSetActivePoll = vi.fn();
vi.mock("../../providers", () => ({
  useWorkflowConfig: () => mockConfig,
  useTasks: () => ({
    tasks: [],
    loading: false,
    error: null,
    createTask: vi.fn(),
    createSubtask: vi.fn(),
    deleteTask: vi.fn(),
    refetch: mockRefetch,
  }),
  useDisplayContext: () => ({
    layout: { preset: "Board", isArchive: false, taskId: null, subtaskId: null, commitHash: null },
    activePreset: { content: "KanbanBoard", panel: null, secondaryPanel: null },
    showBoard: vi.fn(),
    showTask: vi.fn(),
    showSubtask: vi.fn(),
    showNewTask: vi.fn(),
    showTaskDiff: vi.fn(),
    showSubtaskDiff: vi.fn(),
    toggleGitHistory: vi.fn(),
    selectCommit: vi.fn(),
    deselectCommit: vi.fn(),
    toggleAssistant: vi.fn(),
    toggleAssistantHistory: vi.fn(),
    closeFocus: vi.fn(),
    closeSubtask: vi.fn(),
    closeDiff: vi.fn(),
    closeAssistantHistory: vi.fn(),
    switchToArchive: vi.fn(),
    switchToActive: vi.fn(),
    navigateToTask: vi.fn(),
  }),
  usePrStatus: () => ({
    getPrStatus: vi.fn(),
    isLoading: vi.fn().mockReturnValue(false),
    requestFetch: vi.fn(),
    setActivePoll: mockSetActivePoll,
  }),
}));

// Mock the useTaskDetail hook
vi.mock("../../hooks/useTaskDetail", () => ({
  useTaskDetail: () => ({
    currentStageDisplayName: "Planning",
    isSubmitting: false,
    approve: mockApprove,
    reject: mockReject,
    answerQuestions: mockAnswerQuestions,
    retry: mockRetry,
    setAutoMode: vi.fn(() => Promise.resolve()),
    interrupt: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    mergeTask: mockMergeTask,
    openPr: mockOpenPr,
    retryPr: mockRetryPr,
  }),
}));

describe("TaskDetailSidebar", () => {
  beforeEach(() => {
    resetMocks();
    mockMergeTask.mockClear();
    mockOpenPr.mockClear();
    mockRetryPr.mockClear();
  });

  it("renders task in planning stage", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "active", stage: "planning" },
      phase: "idle",
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    expect(screen.getByText("Test Task")).toBeInTheDocument();
    expect(screen.getByText("Planning")).toBeInTheDocument();
  });

  it("renders task awaiting review with approve button", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "active", stage: "planning" },
      phase: "awaiting_review",
      artifacts: { plan: createMockArtifact("plan", "Plan content") },
      derived: { needs_review: true, current_stage: "planning" },
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
  });

  it("renders done task with Done status", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "done" },
      phase: "idle",
      artifacts: {
        plan: createMockArtifact("plan", "Plan"),
        summary: createMockArtifact("summary", "Summary"),
      },
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    expect(screen.getByText("Test Task")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("renders failed task with error message", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "failed", error: "Something went wrong" },
      phase: "idle",
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders blocked task with reason", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "blocked", reason: "Waiting for dependencies" },
      phase: "idle",
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    expect(screen.getByText(/waiting for dependencies/i)).toBeInTheDocument();
    // "Blocked" appears in both status badge and section heading
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
  });

  it("renders artifact tabs when task has artifacts", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "active", stage: "work" },
      phase: "idle",
      artifacts: {
        plan: createMockArtifact("plan", "Plan content"),
      },
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    // Should have Details, Activity, Logs, Artifacts tabs
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Artifacts" })).toBeInTheDocument();
  });

  it("renders integration panel for Done+Idle task", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "done" },
      phase: "idle",
      derived: { is_done: true },
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    expect(screen.getByText("Integration")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /auto-merge/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open pr/i })).toBeInTheDocument();
  });

  it("hides integration panel for Done+Idle task with pr_url", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "done" },
      phase: "idle",
      pr_url: "https://github.com/test/repo/pull/42",
      derived: { is_done: true },
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    expect(screen.queryByText("Integration")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /auto-merge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open pr/i })).not.toBeInTheDocument();
  });

  it("calls mergeTask when Auto-merge is clicked", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "done" },
      phase: "idle",
      derived: { is_done: true },
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /auto-merge/i }));
    });

    expect(mockMergeTask).toHaveBeenCalled();
  });

  it("calls openPr when Open PR is clicked", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "done" },
      phase: "idle",
      derived: { is_done: true },
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /open pr/i }));
    });

    expect(mockOpenPr).toHaveBeenCalled();
  });

  it("renders retry panel for PR creation failure", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "failed", error: "PR creation failed: auth error" },
      phase: "idle",
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    expect(screen.getByText("PR Creation Failed")).toBeInTheDocument();
    // Error text appears in both DetailsTab and IntegrationPanel
    expect(screen.getAllByText("PR creation failed: auth error").length).toBeGreaterThan(0);
    // IntegrationPanel shows "Retry" button (distinct from DetailsTab's "Retry Task")
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument();
  });

  it("calls retryPr when Retry is clicked", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "failed", error: "PR creation failed: auth error" },
      phase: "idle",
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    // Click the IntegrationPanel's "Retry" button (exact match, not "Retry Task")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    });

    expect(mockRetryPr).toHaveBeenCalled();
  });

  describe("PR tab integration", () => {
    beforeEach(() => {
      mockSetActivePoll.mockClear();
    });

    it("shows PR tab for task with pr_url", async () => {
      const task = createMockWorkflowTaskView({
        status: { type: "done" },
        phase: "idle",
        pr_url: "https://github.com/test/repo/pull/1",
        derived: { is_done: true },
      });

      await act(async () => {
        render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
      });

      expect(screen.getByRole("button", { name: /^pr$/i })).toBeInTheDocument();
    });

    it("does not show PR tab for task without pr_url", async () => {
      const task = createMockWorkflowTaskView({
        status: { type: "done" },
        phase: "idle",
        derived: { is_done: true },
      });

      await act(async () => {
        render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
      });

      expect(screen.queryByRole("button", { name: /^pr$/i })).not.toBeInTheDocument();
    });

    it("defaults to PR tab for done task with pr_url", async () => {
      const task = createMockWorkflowTaskView({
        status: { type: "done" },
        phase: "idle",
        pr_url: "https://github.com/test/repo/pull/1",
        derived: { is_done: true },
      });

      await act(async () => {
        render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
      });

      // PR tab content should be visible (View on GitHub link)
      expect(screen.getByRole("link", { name: /view on github/i })).toBeInTheDocument();
    });

    it("defaults to PR tab for archived task with pr_url", async () => {
      const task = createMockWorkflowTaskView({
        status: { type: "archived" },
        phase: "idle",
        pr_url: "https://github.com/test/repo/pull/1",
        derived: { is_archived: true },
      });

      await act(async () => {
        render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
      });

      // PR tab content should be visible (View on GitHub link)
      expect(screen.getByRole("link", { name: /view on github/i })).toBeInTheDocument();
    });

    it("activates PR polling when PR tab is opened", async () => {
      const task = createMockWorkflowTaskView({
        status: { type: "done" },
        phase: "idle",
        pr_url: "https://github.com/test/repo/pull/1",
        derived: { is_done: true },
      });

      await act(async () => {
        render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
      });

      // Since done+pr_url defaults to PR tab, active polling should be set
      expect(mockSetActivePoll).toHaveBeenCalledWith(task.id);
    });

    it("clears active poll when switching away from PR tab", async () => {
      const task = createMockWorkflowTaskView({
        status: { type: "done" },
        phase: "idle",
        pr_url: "https://github.com/test/repo/pull/1",
        artifacts: { plan: createMockArtifact("plan", "content") },
        derived: { is_done: true },
      });

      await act(async () => {
        render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
      });

      // Verify PR tab is active initially and setActivePoll was called with task.id
      expect(mockSetActivePoll).toHaveBeenCalledWith(task.id);
      mockSetActivePoll.mockClear();

      // Click Details tab
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Details" }));
      });

      // Should clear active poll (call with null)
      expect(mockSetActivePoll).toHaveBeenCalledWith(null);
    });
  });
});
