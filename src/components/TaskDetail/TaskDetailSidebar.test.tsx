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
    expect(screen.getByText("PR creation failed: auth error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("calls retryPr when Retry is clicked", async () => {
    const task = createMockWorkflowTaskView({
      status: { type: "failed", error: "PR creation failed: auth error" },
      phase: "idle",
    });

    await act(async () => {
      render(<TaskDetailSidebar task={task} onClose={() => {}} onDelete={() => {}} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    });

    expect(mockRetryPr).toHaveBeenCalled();
  });
});
