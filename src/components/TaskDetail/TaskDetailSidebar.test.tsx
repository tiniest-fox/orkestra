import { act, render, screen } from "@testing-library/react";
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
  }),
}));

describe("TaskDetailSidebar", () => {
  beforeEach(() => {
    resetMocks();
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
});
