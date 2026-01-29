import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockArtifact,
  createMockWorkflowConfig,
  createMockWorkflowTask,
} from "../../test/mocks/fixtures";
import { mockInvoke, resetMocks } from "../../test/mocks/tauri";
import { TaskDetailSidebar } from "./TaskDetailSidebar";

// Create stable mock functions outside the factory
const mockApprove = vi.fn(() => Promise.resolve());
const mockReject = vi.fn(() => Promise.resolve());
const mockAnswerQuestions = vi.fn(() => Promise.resolve());
const mockRetry = vi.fn(() => Promise.resolve());
const mockGetIterations = vi.fn(() => Promise.resolve([]));
const mockGetArtifact = vi.fn(() => Promise.resolve(null));
const mockGetPendingQuestions = vi.fn(() => Promise.resolve([]));
const mockGetCurrentStage = vi.fn(() => Promise.resolve(null));
const mockGetRejectionFeedback = vi.fn(() => Promise.resolve(null));
const mockGetLogs = vi.fn(() => Promise.resolve([]));
const mockGetStagesWithLogs = vi.fn(() => Promise.resolve([]));

// Mock the workflow hooks with stable references
vi.mock("../../hooks/useWorkflow", () => ({
  useWorkflowActions: () => ({
    approve: mockApprove,
    reject: mockReject,
    answerQuestions: mockAnswerQuestions,
    retry: mockRetry,
  }),
  useWorkflowQueries: () => ({
    getIterations: mockGetIterations,
    getArtifact: mockGetArtifact,
    getPendingQuestions: mockGetPendingQuestions,
    getCurrentStage: mockGetCurrentStage,
    getRejectionFeedback: mockGetRejectionFeedback,
    getLogs: mockGetLogs,
    getStagesWithLogs: mockGetStagesWithLogs,
  }),
}));

describe("TaskDetailSidebar", () => {
  const config = createMockWorkflowConfig();

  beforeEach(() => {
    resetMocks();
    // Default mock for iterations query
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "workflow_get_iterations") return Promise.resolve([]);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });
  });

  it("renders task in planning stage", async () => {
    const task = createMockWorkflowTask({
      status: { type: "active", stage: "planning" },
      phase: "idle",
    });

    await act(async () => {
      render(
        <TaskDetailSidebar
          task={task}
          config={config}
          onClose={() => {}}
          onDelete={() => {}}
          onTaskUpdated={() => {}}
        />,
      );
    });

    expect(screen.getByText("Test Task")).toBeInTheDocument();
    expect(screen.getByText("Planning")).toBeInTheDocument();
  });

  it("renders task awaiting review with approve button", async () => {
    const task = createMockWorkflowTask({
      status: { type: "active", stage: "planning" },
      phase: "awaiting_review",
      artifacts: { plan: createMockArtifact("plan", "Plan content") },
    });

    await act(async () => {
      render(
        <TaskDetailSidebar
          task={task}
          config={config}
          onClose={() => {}}
          onDelete={() => {}}
          onTaskUpdated={() => {}}
        />,
      );
    });

    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
  });

  it("renders done task with Done status", async () => {
    const task = createMockWorkflowTask({
      status: { type: "done" },
      phase: "idle",
      artifacts: {
        plan: createMockArtifact("plan", "Plan"),
        summary: createMockArtifact("summary", "Summary"),
      },
    });

    await act(async () => {
      render(
        <TaskDetailSidebar
          task={task}
          config={config}
          onClose={() => {}}
          onDelete={() => {}}
          onTaskUpdated={() => {}}
        />,
      );
    });

    expect(screen.getByText("Test Task")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("renders failed task with error message", async () => {
    const task = createMockWorkflowTask({
      status: { type: "failed", error: "Something went wrong" },
      phase: "idle",
    });

    await act(async () => {
      render(
        <TaskDetailSidebar
          task={task}
          config={config}
          onClose={() => {}}
          onDelete={() => {}}
          onTaskUpdated={() => {}}
        />,
      );
    });

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders blocked task with reason", async () => {
    const task = createMockWorkflowTask({
      status: { type: "blocked", reason: "Waiting for dependencies" },
      phase: "idle",
    });

    await act(async () => {
      render(
        <TaskDetailSidebar
          task={task}
          config={config}
          onClose={() => {}}
          onDelete={() => {}}
          onTaskUpdated={() => {}}
        />,
      );
    });

    expect(screen.getByText(/waiting for dependencies/i)).toBeInTheDocument();
    // "Blocked" appears in both status badge and section heading
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
  });

  it("renders artifact tabs when task has artifacts", async () => {
    const task = createMockWorkflowTask({
      status: { type: "active", stage: "work" },
      phase: "idle",
      artifacts: {
        plan: createMockArtifact("plan", "Plan content"),
      },
    });

    await act(async () => {
      render(
        <TaskDetailSidebar
          task={task}
          config={config}
          onClose={() => {}}
          onDelete={() => {}}
          onTaskUpdated={() => {}}
        />,
      );
    });

    // Should have Details, Activity, Logs, Artifacts tabs
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Artifacts" })).toBeInTheDocument();
  });
});
